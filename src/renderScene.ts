import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { deserializePtsRenderError, PtsRenderError } from "./PtsRenderError.js";
import type {
  RenderOutputResult,
  RenderSceneOptions,
  RenderSceneResult,
} from "./renderTypes.js";
import {
  prepareRenderRequest,
  type PreparedRenderRequest,
} from "./renderValidation.js";
import type {
  RenderWorkerJob,
  WorkerRenderResult,
  WorkerToParentMessage,
} from "./workerProtocol.js";

interface ArtifactPlan {
  readonly artifactPath: string;
  readonly destination?: string;
}

interface CapturedLogs {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

function elapsedMilliseconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function throwIfCancelled(
  request: PreparedRenderRequest,
  started: bigint,
  committed: readonly string[] = [],
): void {
  if (request.signal?.aborted) {
    throw new PtsRenderError(
      "RENDER_ABORTED",
      committed.length === 0 ? "arguments" : "commit",
      "Render was aborted",
      committed.length === 0 ? {} : { details: { committed } },
    );
  }
  if (elapsedMilliseconds(started) >= request.timeoutMs) {
    throw new PtsRenderError(
      "RENDER_TIMEOUT",
      committed.length === 0 ? "arguments" : "commit",
      "Render exceeded its " + String(request.timeoutMs) + "ms timeout",
      committed.length === 0 ? {} : { details: { committed } },
    );
  }
}

async function prepareArtifacts(
  request: PreparedRenderRequest,
): Promise<{ readonly plans: readonly ArtifactPlan[]; readonly temp: string }> {
  const temp = await mkdtemp(join(tmpdir(), "pts-cli-render-"));
  const plans: ArtifactPlan[] = [];
  const canonicalDestinations = new Set<string>();

  try {
    for (const [index, output] of request.outputs.entries()) {
      if (output.destination === undefined) {
        plans.push({
          artifactPath: join(
            temp,
            String(index) + "-" + randomUUID() + ".artifact",
          ),
        });
        continue;
      }

      const parent = dirname(output.destination);
      let parentStat;
      let canonicalParent: string;
      try {
        await mkdir(parent, { recursive: true });
        parentStat = await stat(parent);
        canonicalParent = await realpath(parent);
      } catch (error) {
        throw new PtsRenderError(
          "OUTPUT_TARGET_INVALID",
          "arguments",
          "Unable to prepare output directory: " + parent,
          { cause: error, details: { path: output.destination } },
        );
      }
      if (!parentStat.isDirectory()) {
        throw new PtsRenderError(
          "OUTPUT_TARGET_INVALID",
          "arguments",
          "Output parent is not a directory: " + parent,
        );
      }

      const canonicalDestination = join(
        canonicalParent,
        basename(output.destination),
      );
      const destinationKey =
        process.platform === "win32"
          ? canonicalDestination.toLowerCase()
          : canonicalDestination;
      if (canonicalDestinations.has(destinationKey)) {
        throw new PtsRenderError(
          "OUTPUT_TARGET_INVALID",
          "arguments",
          "Two outputs resolve to the same canonical destination: " +
            output.destination,
        );
      }
      canonicalDestinations.add(destinationKey);

      try {
        const destinationStat = await lstat(output.destination);
        if (destinationStat.isDirectory()) {
          throw new PtsRenderError(
            "OUTPUT_TARGET_INVALID",
            "arguments",
            "Output target is a directory: " + output.destination,
          );
        }
        if (!destinationStat.isFile()) {
          throw new PtsRenderError(
            "OUTPUT_TARGET_INVALID",
            "arguments",
            "Output target must be a regular file: " + output.destination,
          );
        }
        if (!request.overwrite) {
          throw new PtsRenderError(
            "OUTPUT_EXISTS",
            "arguments",
            "Output already exists: " + output.destination,
          );
        }
      } catch (error) {
        if (error instanceof PtsRenderError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new PtsRenderError(
            "OUTPUT_TARGET_INVALID",
            "arguments",
            "Unable to inspect output target: " + output.destination,
            { cause: error, details: { path: output.destination } },
          );
        }
      }

      plans.push({
        destination: output.destination,
        artifactPath: join(
          parent,
          "." +
            basename(output.destination) +
            ".ptsjs-" +
            randomUUID() +
            ".tmp",
        ),
      });
    }
    return { plans, temp };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

function createWorkerJob(
  request: PreparedRenderRequest,
  plans: readonly ArtifactPlan[],
): RenderWorkerJob {
  return {
    source: request.source,
    loader: request.loader,
    ...(request.size === undefined ? {} : { size: request.size }),
    ...(request.background === undefined
      ? {}
      : { background: request.background }),
    ...(request.pointer === undefined ? {} : { pointer: request.pointer }),
    render: request.render,
    events: request.events as unknown as readonly Record<string, unknown>[],
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    params: request.params,
    ...(request.assetRoot === undefined
      ? {}
      : { assetRoot: request.assetRoot }),
    allowNet: request.allowNet,
    fonts: request.fonts,
    renderer: request.renderer,
    limits: request.limits,
    outputs: request.outputs.map((output, index) => ({
      request: output.request,
      artifactPath: plans[index]?.artifactPath ?? "",
    })),
  };
}

function captureChildLogs(
  child: ChildProcess,
  limit: number,
): { finish(): CapturedLogs } {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let remaining = limit;
  let truncated = false;

  const capture =
    (target: Buffer[]) =>
    (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.length > remaining) truncated = true;
      if (remaining > 0) {
        const accepted = buffer.subarray(0, remaining);
        target.push(accepted);
        remaining -= accepted.length;
      }
    };
  child.stdout?.on("data", capture(stdout));
  child.stderr?.on("data", capture(stderr));

  return {
    finish: () => ({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      truncated,
    }),
  };
}

function workerModulePath(): string {
  return fileURLToPath(new URL("./worker.mjs", import.meta.url));
}

async function executeWorker(
  job: RenderWorkerJob,
  request: PreparedRenderRequest,
  started: bigint,
): Promise<{
  readonly result: WorkerRenderResult;
  readonly logs: CapturedLogs;
}> {
  throwIfCancelled(request, started);
  const child = fork(workerModulePath(), [], {
    execArgv: [],
    serialization: "advanced",
    silent: true,
  });
  const capture = captureChildLogs(child, request.limits.maxCapturedLogBytes);

  return new Promise((resolve, reject) => {
    let response: WorkerToParentMessage | undefined;
    let terminalError: PtsRenderError | undefined;
    const remaining = Math.max(
      1,
      request.timeoutMs - elapsedMilliseconds(started),
    );
    const timeout = setTimeout(() => {
      terminalError = new PtsRenderError(
        "RENDER_TIMEOUT",
        "frame",
        "Render exceeded its " + String(request.timeoutMs) + "ms timeout",
      );
      child.kill("SIGKILL");
    }, remaining);

    const abort = (): void => {
      terminalError ??= new PtsRenderError(
        "RENDER_ABORTED",
        "frame",
        "Render was aborted",
      );
      child.kill("SIGKILL");
    };
    request.signal?.addEventListener("abort", abort, { once: true });

    child.on("message", (message: unknown) => {
      if (
        message !== null &&
        typeof message === "object" &&
        ((message as { type?: unknown }).type === "success" ||
          (message as { type?: unknown }).type === "failure")
      ) {
        response = message as WorkerToParentMessage;
      }
    });
    child.on("error", (error) => {
      terminalError ??= new PtsRenderError(
        "WORKER_FAILED",
        "load",
        "Could not start the render worker",
        { cause: error },
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
      const logs = capture.finish();
      if (terminalError) {
        reject(terminalError);
        return;
      }
      if (!response) {
        reject(
          new PtsRenderError(
            "WORKER_FAILED",
            "frame",
            "Render worker exited without a result",
            { details: { code, signal, stderr: logs.stderr } },
          ),
        );
        return;
      }
      if (response.type === "failure") {
        reject(deserializePtsRenderError(response.error));
        return;
      }
      if (code !== 0) {
        reject(
          new PtsRenderError(
            "WORKER_FAILED",
            "frame",
            "Render worker reported success but exited with code " +
              String(code),
          ),
        );
        return;
      }
      resolve({ result: response.result, logs });
    });

    child.send({ type: "render", job }, (error) => {
      if (!error) return;
      terminalError ??= new PtsRenderError(
        "WORKER_FAILED",
        "load",
        "Could not send the render job to the worker",
        { cause: error },
      );
      child.kill("SIGKILL");
    });
  });
}

async function hashFile(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function verifyAndCommit(
  worker: WorkerRenderResult,
  request: PreparedRenderRequest,
  plans: readonly ArtifactPlan[],
  started: bigint,
): Promise<readonly RenderOutputResult[]> {
  if (worker.outputs.length !== plans.length) {
    throw new PtsRenderError(
      "WORKER_FAILED",
      "commit",
      "Render worker returned an unexpected number of artifacts",
    );
  }
  const verified: Array<{ bytes: number; sha256: string }> = [];
  let total = 0;
  for (const [index, output] of worker.outputs.entries()) {
    const plan = plans[index];
    if (!plan || output.artifactPath !== plan.artifactPath) {
      throw new PtsRenderError(
        "WORKER_FAILED",
        "commit",
        "Render worker returned an unknown artifact path",
      );
    }
    let artifactStat;
    try {
      artifactStat = await stat(plan.artifactPath);
    } catch (error) {
      throw new PtsRenderError(
        "WORKER_FAILED",
        "commit",
        "Unable to inspect a render artifact returned by the worker",
        { cause: error, details: { index } },
      );
    }
    if (!artifactStat.isFile()) {
      throw new PtsRenderError(
        "WORKER_FAILED",
        "commit",
        "Render artifact is not a regular file",
      );
    }
    let facts: { bytes: number; sha256: string };
    try {
      facts = await hashFile(plan.artifactPath);
    } catch (error) {
      throw new PtsRenderError(
        "WORKER_FAILED",
        "commit",
        "Unable to read a render artifact returned by the worker",
        { cause: error, details: { index } },
      );
    }
    if (facts.bytes !== output.bytes || facts.sha256 !== output.sha256) {
      throw new PtsRenderError(
        "WORKER_FAILED",
        "commit",
        "Render artifact metadata did not verify",
      );
    }
    if (total > request.limits.maxArtifactBytesTotal - facts.bytes) {
      throw new PtsRenderError(
        "RESOURCE_LIMIT",
        "commit",
        "Artifacts exceed limits.maxArtifactBytesTotal",
      );
    }
    total += facts.bytes;
    if (
      plan.destination === undefined &&
      facts.bytes > request.limits.maxBufferResultBytes
    ) {
      throw new PtsRenderError(
        "RESOURCE_LIMIT",
        "commit",
        "Buffer output exceeds limits.maxBufferResultBytes",
      );
    }
    verified.push(facts);
  }

  const committed: string[] = [];
  const results: RenderOutputResult[] = [];
  for (const [index, plan] of plans.entries()) {
    throwIfCancelled(request, started, committed);
    const output = worker.outputs[index];
    const facts = verified[index];
    if (!output || !facts) {
      throw new PtsRenderError(
        "WORKER_FAILED",
        "commit",
        "Missing verified output metadata",
      );
    }

    if (plan.destination === undefined) {
      let buffer: Buffer;
      try {
        buffer = await readFile(plan.artifactPath);
      } catch (error) {
        throw new PtsRenderError(
          "WORKER_FAILED",
          "commit",
          "Unable to materialize a verified render artifact",
          { cause: error, details: { index } },
        );
      }
      results.push({
        format: output.format,
        bytes: facts.bytes,
        sha256: facts.sha256,
        buffer,
      });
      continue;
    }

    try {
      if (request.overwrite) {
        await rename(plan.artifactPath, plan.destination);
      } else {
        await link(plan.artifactPath, plan.destination);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new PtsRenderError(
        code === "EEXIST" ? "OUTPUT_EXISTS" : "OUTPUT_COMMIT_FAILED",
        "commit",
        code === "EEXIST"
          ? "Output appeared before commit: " + plan.destination
          : "Could not commit output: " + plan.destination,
        {
          cause: error,
          details: { path: plan.destination, committed: [...committed] },
        },
      );
    }
    committed.push(plan.destination);
    results.push({
      format: output.format,
      bytes: facts.bytes,
      sha256: facts.sha256,
      path: plan.destination,
    });
  }
  return results;
}

async function cleanupArtifacts(
  plans: readonly ArtifactPlan[],
  temp: string,
): Promise<void> {
  await Promise.all(
    plans.map((plan) =>
      rm(plan.artifactPath, { force: true }).catch(() => undefined),
    ),
  );
  await rm(temp, { recursive: true, force: true });
}

export async function renderScene(
  source: string | URL,
  options: RenderSceneOptions,
): Promise<RenderSceneResult> {
  const started = process.hrtime.bigint();
  const request = await prepareRenderRequest(source, options);
  throwIfCancelled(request, started);
  const { plans, temp } = await prepareArtifacts(request);

  try {
    const job = createWorkerJob(request, plans);
    const { result: worker, logs } = await executeWorker(job, request, started);
    const outputs = await verifyAndCommit(worker, request, plans, started);
    return {
      schemaVersion: 1,
      source: worker.source,
      loader: worker.loader,
      width: worker.width,
      height: worker.height,
      render: worker.render,
      random: worker.random,
      runtime: worker.runtime,
      outputs,
      warnings: worker.warnings,
      ...(worker.metadata === undefined ? {} : { metadata: worker.metadata }),
      logs,
      durationMs: elapsedMilliseconds(started),
    };
  } finally {
    await cleanupArtifacts(plans, temp);
  }
}
