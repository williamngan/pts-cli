import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import * as Pts from "pts";
import { DOMMatrix, DOMPoint, DOMRect, ImageData, Path2D } from "skia-canvas";

import {
  executeClassicDemo,
  loadClassicDemo,
  type ClassicDemoExecution,
} from "./classicDemo.js";
import { SkiaCanvasError } from "./errors.js";
import { NodeSceneAssets } from "./NodeSceneAssets.js";
import { PtsRenderError } from "./PtsRenderError.js";
import { applyRandomSeed } from "./random.js";
import type {
  PtsSceneEvent,
  RenderOutputRequest,
  RuntimeFacts,
} from "./renderTypes.js";
import type {
  JsonValue,
  PtsScene,
  RenderWarning,
  SceneCleanup,
} from "./scene.js";
import { validateScene } from "./sceneValidation.js";
import { analyzeJavaScriptSource } from "./sourceAnalysis.js";
import {
  beginRunnerInitialization,
  finishRunnerInitialization,
  SkiaCanvasSpace,
} from "./SkiaCanvasSpace.js";
import type { RasterExportOptions } from "./types.js";
import type {
  RenderWorkerJob,
  WorkerOutputResult,
  WorkerRenderResult,
} from "./workerProtocol.js";

const require = createRequire(import.meta.url);

function installCanvasGlobals(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.DOMMatrix ??= DOMMatrix;
  globals.DOMPoint ??= DOMPoint;
  globals.DOMRect ??= DOMRect;
  globals.ImageData ??= ImageData;
  globals.Path2D ??= Path2D;
}

interface PackageFacts {
  readonly version: string;
  readonly gitHead?: string;
}

function packageFacts(name: string): PackageFacts {
  let directory = dirname(require.resolve(name));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, "package.json");
    try {
      const value = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: unknown;
        version?: unknown;
        gitHead?: unknown;
      };
      if (value.name === name && typeof value.version === "string") {
        return {
          version: value.version,
          ...(typeof value.gitHead === "string"
            ? { gitHead: value.gitHead }
            : {}),
        };
      }
    } catch {
      // Continue walking toward node_modules.
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { version: "unknown" };
}

async function preflightPortableSource(source: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(source, "utf8");
  } catch (error) {
    throw new PtsRenderError(
      "SOURCE_NOT_FOUND",
      "load",
      "Unable to read scene module: " + source,
      { cause: error, details: { source } },
    );
  }
  const analysis = analyzeJavaScriptSource(text, source);
  if (analysis.ptsRuntimeReferences.length === 0) return;

  try {
    const sceneRequire = createRequire(pathToFileURL(source));
    const canonicalRoot = await realpath(
      dirname(require.resolve("pts/package.json")),
    );
    const sceneRoot = await realpath(
      dirname(sceneRequire.resolve("pts/package.json")),
    );
    if (sceneRoot !== canonicalRoot) {
      throw new PtsRenderError(
        "PTS_INSTANCE_MISMATCH",
        "load",
        "Scene runtime imports resolve to a different Pts installation",
        {
          details: {
            source,
            specifiers: analysis.ptsRuntimeReferences,
            runnerPts: canonicalRoot,
            scenePts: sceneRoot,
          },
          hint: "Use context.Pts in portable scenes or deduplicate the Pts peer dependency.",
        },
      );
    }
  } catch (error) {
    if (error instanceof PtsRenderError) throw error;
    throw new PtsRenderError(
      "PTS_INSTANCE_MISMATCH",
      "load",
      "Could not verify the Pts installation imported by the scene",
      {
        cause: error,
        details: {
          source,
          specifiers: analysis.ptsRuntimeReferences,
        },
      },
    );
  }
}

async function loadPortableScene(source: string): Promise<PtsScene> {
  await preflightPortableSource(source);
  let namespace: Record<string, unknown>;
  try {
    namespace = (await import(pathToFileURL(source).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    throw new PtsRenderError(
      "SCENE_FAILED",
      "load",
      "Scene module failed while loading: " + source,
      { cause: error, details: { source } },
    );
  }

  if (!Object.hasOwn(namespace, "default")) {
    throw new PtsRenderError(
      "SCENE_INVALID",
      "validate",
      "Scene module must provide a default export",
      { details: { source } },
    );
  }
  let candidate: unknown = namespace.default;
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    typeof (candidate as { setup?: unknown }).setup !== "function" &&
    "default" in candidate
  ) {
    candidate = (candidate as { default?: unknown }).default;
  }
  try {
    return validateScene(candidate);
  } catch (error) {
    throw new PtsRenderError(
      "SCENE_INVALID",
      "validate",
      error instanceof Error ? error.message : "Scene module is invalid",
      { cause: error, details: { source } },
    );
  }
}

function sceneAssetBase(
  scene: PtsScene | undefined,
  source: string,
  assetRoot: string | undefined,
): URL {
  if (assetRoot !== undefined) {
    const root = new URL(assetRoot);
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    return root;
  }
  const sourceURL = pathToFileURL(source);
  if (scene?.assetBaseURL === undefined) return sourceURL;
  return scene.assetBaseURL instanceof URL
    ? new URL(scene.assetBaseURL.href)
    : new URL(scene.assetBaseURL, sourceURL);
}

function metadataSize(scene: PtsScene): number {
  return scene.metadata === undefined
    ? 0
    : Buffer.byteLength(JSON.stringify(scene.metadata), "utf8");
}

function runtimeFacts(space: SkiaCanvasSpace): RuntimeFacts {
  const pts = packageFacts("pts");
  const skia = packageFacts("skia-canvas");
  return {
    node: process.versions.node,
    ptsVersion: pts.version,
    ...(pts.gitHead === undefined ? {} : { ptsRevision: pts.gitHead }),
    skiaCanvas: skia.version,
    requestedRenderer: space.renderer.requested,
    renderer: space.renderer.renderer,
    ...(space.renderer.api === undefined ? {} : { api: space.renderer.api }),
    ...(space.renderer.device === undefined
      ? {}
      : { device: space.renderer.device }),
    ...(space.renderer.driver === undefined
      ? {}
      : { driver: space.renderer.driver }),
    ...(space.renderer.error === undefined
      ? {}
      : { rendererError: space.renderer.error }),
  };
}

function createRenderSpace(
  width: number,
  height: number,
  job: RenderWorkerJob,
  background: string,
): SkiaCanvasSpace {
  try {
    return new SkiaCanvasSpace(width, height, {
      background,
      renderer: job.renderer,
      limits: {
        maxWidth: job.limits.maxWidth,
        maxHeight: job.limits.maxHeight,
        maxLogicalPixels: job.limits.maxLogicalPixels,
      },
    });
  } catch (error) {
    if (error instanceof SkiaCanvasError) {
      if (error.code === "RENDERER_UNAVAILABLE") {
        throw new PtsRenderError(
          "RENDERER_UNAVAILABLE",
          "setup",
          error.message,
          { cause: error },
        );
      }
      if (error.code === "INCOMPATIBLE_PTS") {
        throw new PtsRenderError("PTS_INCOMPATIBLE", "load", error.message, {
          cause: error,
        });
      }
    }
    throw new PtsRenderError(
      "NATIVE_RENDER_FAILED",
      "setup",
      "Unable to initialize the Skia canvas",
      { cause: error },
    );
  }
}

function validateLogicalSize(
  width: number,
  height: number,
  job: RenderWorkerJob,
): void {
  if (width > job.limits.maxWidth || height > job.limits.maxHeight) {
    throw new PtsRenderError(
      "RESOURCE_LIMIT",
      "validate",
      "Logical canvas dimensions exceed the configured width or height limit",
      {
        details: {
          width,
          height,
          maxWidth: job.limits.maxWidth,
          maxHeight: job.limits.maxHeight,
        },
      },
    );
  }
  if (width > Math.floor(job.limits.maxLogicalPixels / height)) {
    throw new PtsRenderError(
      "RESOURCE_LIMIT",
      "validate",
      "Logical canvas area exceeds limits.maxLogicalPixels",
      { details: { width, height, limit: job.limits.maxLogicalPixels } },
    );
  }
}

function applyEvent(space: SkiaCanvasSpace, event: PtsSceneEvent): void {
  if (event.type === "resize") {
    space.resize(event.width, event.height);
    return;
  }
  space.dispatchAction(event.type, [event.x, event.y], {
    timeStamp: event.at,
    ...(event.button === undefined ? {} : { button: event.button }),
    ...(event.buttons === undefined ? {} : { buttons: event.buttons }),
    ...(event.altKey === undefined ? {} : { altKey: event.altKey }),
    ...(event.ctrlKey === undefined ? {} : { ctrlKey: event.ctrlKey }),
    ...(event.metaKey === undefined ? {} : { metaKey: event.metaKey }),
    ...(event.shiftKey === undefined ? {} : { shiftKey: event.shiftKey }),
  });
}

function renderFrames(space: SkiaCanvasSpace, job: RenderWorkerJob): void {
  const events = job.events as unknown as readonly PtsSceneEvent[];
  let eventIndex = 0;

  const applyThrough = (time: number): void => {
    try {
      while (
        eventIndex < events.length &&
        (events[eventIndex]?.at ?? 0) <= time
      ) {
        const event = events[eventIndex];
        eventIndex += 1;
        if (event) applyEvent(space, event);
      }
    } catch (error) {
      if (error instanceof PtsRenderError) throw error;
      throw new PtsRenderError(
        "SCENE_FAILED",
        "input",
        "Scene failed while applying an input event",
        { cause: error },
      );
    }
  };

  const frame = (time: number, delta: number): void => {
    try {
      space.renderFrame(time, { delta });
    } catch (error) {
      if (error instanceof PtsRenderError) throw error;
      throw new PtsRenderError(
        "SCENE_FAILED",
        "frame",
        "Scene failed while rendering a frame",
        { cause: error, details: { time, delta } },
      );
    }
  };

  if (job.render.mode === "direct") {
    applyThrough(job.render.time);
    frame(job.render.time, 0);
    return;
  }

  const delta = 1000 / job.render.fps;
  for (let frameIndex = 0; frameIndex <= job.render.frame; frameIndex += 1) {
    const time = (frameIndex * 1000) / job.render.fps;
    applyThrough(time);
    frame(time, frameIndex === 0 ? 0 : delta);
  }
}

function validateFinalRasterLimits(
  space: SkiaCanvasSpace,
  job: RenderWorkerJob,
): void {
  let total = 0;
  for (const output of job.outputs) {
    const request = output.request as unknown as Record<string, unknown>;
    if (request.format === "svg") continue;
    const density = typeof request.density === "number" ? request.density : 1;
    const logicalPixels = space.width * space.height;
    if (
      logicalPixels >
      Math.floor(job.limits.maxRasterPixelsPerOutput / density / density)
    ) {
      throw new PtsRenderError(
        "RESOURCE_LIMIT",
        "export",
        "Raster output exceeds limits.maxRasterPixelsPerOutput",
      );
    }
    const pixels = logicalPixels * density * density;
    if (total > job.limits.maxRasterPixelsTotal - pixels) {
      throw new PtsRenderError(
        "RESOURCE_LIMIT",
        "export",
        "Raster outputs exceed limits.maxRasterPixelsTotal",
      );
    }
    total += pixels;
  }
}

async function exportOutputs(
  space: SkiaCanvasSpace,
  job: RenderWorkerJob,
): Promise<readonly WorkerOutputResult[]> {
  validateFinalRasterLimits(space, job);
  const results: WorkerOutputResult[] = [];
  let artifactBytes = 0;

  for (const output of job.outputs) {
    const request = output.request as unknown as Record<string, unknown>;
    const format = request.format as RenderOutputRequest["format"];
    let buffer: Buffer;
    try {
      if (format === "svg") {
        buffer = await space.toBuffer("svg", {
          outline: request.textMode === "outline",
        });
      } else {
        const options: RasterExportOptions = {
          ...(typeof request.density === "number"
            ? { density: request.density }
            : {}),
          ...(typeof request.matte === "string"
            ? { matte: request.matte }
            : {}),
          ...(typeof request.msaa === "number" ||
          typeof request.msaa === "boolean"
            ? { msaa: request.msaa }
            : {}),
          ...(typeof request.quality === "number"
            ? { quality: request.quality }
            : {}),
          ...(typeof request.downsample === "boolean"
            ? { downsample: request.downsample }
            : {}),
        };
        buffer = await space.toBuffer(format, options);
      }
    } catch (error) {
      if (error instanceof PtsRenderError) throw error;
      throw new PtsRenderError(
        "NATIVE_RENDER_FAILED",
        "export",
        "Failed to export " + String(format).toUpperCase(),
        { cause: error },
      );
    }

    if (artifactBytes > job.limits.maxArtifactBytesTotal - buffer.length) {
      throw new PtsRenderError(
        "RESOURCE_LIMIT",
        "export",
        "Encoded outputs exceed limits.maxArtifactBytesTotal",
      );
    }
    artifactBytes += buffer.length;
    try {
      await writeFile(output.artifactPath, buffer, { flag: "wx" });
    } catch (error) {
      throw new PtsRenderError(
        "OUTPUT_TARGET_INVALID",
        "export",
        "Could not create the render artifact",
        { cause: error, details: { artifactPath: output.artifactPath } },
      );
    }
    results.push({
      artifactPath: output.artifactPath,
      format: format === "jpg" ? "jpeg" : format,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    });
  }
  return results;
}

function withCleanupFailure(primary: unknown, cleanup: unknown): unknown {
  if (!(primary instanceof PtsRenderError)) return primary;
  return new PtsRenderError(primary.code, primary.phase, primary.message, {
    cause: primary,
    details: {
      ...primary.details,
      cleanupError:
        cleanup instanceof Error ? cleanup.message : String(cleanup),
    },
    ...(primary.hint === undefined ? {} : { hint: primary.hint }),
  });
}

export async function runWorkerJob(
  job: RenderWorkerJob,
): Promise<WorkerRenderResult> {
  const started = process.hrtime.bigint();
  installCanvasGlobals();
  const random = applyRandomSeed(Pts, job.seed);
  const scene =
    job.loader === "scene" ? await loadPortableScene(job.source) : undefined;
  const loadedClassic =
    job.loader === "pts-demo" ? await loadClassicDemo(job.source) : undefined;
  if (
    scene !== undefined &&
    metadataSize(scene) > job.limits.maxMetadataBytes
  ) {
    throw new PtsRenderError(
      "RESOURCE_LIMIT",
      "validate",
      "Scene metadata exceeds limits.maxMetadataBytes",
    );
  }
  let metadata: Readonly<Record<string, JsonValue>> | undefined =
    scene?.metadata === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(scene.metadata)) as NonNullable<
          PtsScene["metadata"]
        >);

  const width = job.size?.width ?? scene?.width ?? 800;
  const height = job.size?.height ?? scene?.height ?? 600;
  const background = job.background ?? scene?.background ?? "transparent";
  validateLogicalSize(width, height, job);
  const abortController = new AbortController();
  const space = createRenderSpace(width, height, job, background);
  let form: ReturnType<SkiaCanvasSpace["getForm"]>;
  try {
    form = space.getForm();
  } catch (error) {
    space.dispose();
    if (error instanceof SkiaCanvasError && error.code === "INCOMPATIBLE_PTS") {
      throw new PtsRenderError("PTS_INCOMPATIBLE", "load", error.message, {
        cause: error,
      });
    }
    throw new PtsRenderError(
      "NATIVE_RENDER_FAILED",
      "setup",
      "Unable to initialize the Pts canvas form",
      { cause: error },
    );
  }
  const assets = new NodeSceneAssets({
    baseURL: sceneAssetBase(scene, job.source, job.assetRoot),
    ...(job.assetRoot === undefined
      ? {}
      : { rootURL: sceneAssetBase(undefined, job.source, job.assetRoot) }),
    allowNet: job.allowNet,
    limits: job.limits,
    signal: abortController.signal,
  });

  beginRunnerInitialization(space);
  if (job.pointer) space.setPointer(job.pointer);

  let cleanup: SceneCleanup | undefined;
  let classic: ClassicDemoExecution | undefined;
  let primaryError: unknown;
  let outputs: readonly WorkerOutputResult[] | undefined;
  let warnings: readonly RenderWarning[] = [];
  try {
    for (const font of job.fonts) {
      await assets.configuredFont({
        family: font.family,
        sources: font.sources,
      });
    }

    if (scene) {
      let setupResult: void | SceneCleanup;
      try {
        setupResult = await scene.setup({
          Pts,
          space,
          form,
          assets,
          params: job.params,
          signal: abortController.signal,
        });
      } catch (error) {
        throw new PtsRenderError(
          "SCENE_FAILED",
          "setup",
          "Scene setup failed",
          {
            cause: error,
            details: { source: job.source },
          },
        );
      }
      if (setupResult !== undefined && typeof setupResult !== "function") {
        throw new PtsRenderError(
          "SCENE_INVALID",
          "setup",
          "scene.setup must return undefined or a cleanup function",
        );
      }
      if (typeof setupResult === "function") cleanup = setupResult;
    } else {
      if (loadedClassic === undefined) {
        throw new PtsRenderError(
          "WORKER_FAILED",
          "load",
          "Classic loader was selected without a compiled script",
        );
      }
      classic = await executeClassicDemo(loadedClassic, {
        space,
        form,
        assets,
        assetRootProvided: job.assetRoot !== undefined,
        backgroundOverridden: job.background !== undefined,
        ...(job.seed === undefined ? {} : { seed: job.seed }),
      });
      metadata = classic.metadata;
      warnings = classic.warnings;
    }
    if (
      metadata !== undefined &&
      Buffer.byteLength(JSON.stringify(metadata), "utf8") >
        job.limits.maxMetadataBytes
    ) {
      throw new PtsRenderError(
        "RESOURCE_LIMIT",
        "validate",
        "Scene metadata exceeds limits.maxMetadataBytes",
      );
    }
    await assets.settle();

    try {
      finishRunnerInitialization(space);
    } catch (error) {
      if (error instanceof PtsRenderError) throw error;
      throw new PtsRenderError(
        "SCENE_FAILED",
        "setup",
        "A player failed during initial resize or start",
        { cause: error },
      );
    }
    classic?.invokeReadyCallbacks();
    renderFrames(space, job);
    outputs = await exportOutputs(space, job);
  } catch (error) {
    primaryError = error;
  } finally {
    abortController.abort();
    if (cleanup) {
      try {
        await cleanup();
      } catch (error) {
        primaryError =
          primaryError === undefined
            ? new PtsRenderError(
                "SCENE_FAILED",
                "cleanup",
                "Scene cleanup failed",
                { cause: error },
              )
            : withCleanupFailure(primaryError, error);
      }
    }
    try {
      await assets.dispose();
    } catch (error) {
      primaryError ??= new PtsRenderError(
        "SCENE_FAILED",
        "cleanup",
        "Asset cleanup failed",
        { cause: error },
      );
    }
    try {
      space.dispose();
    } catch (error) {
      primaryError ??= new PtsRenderError(
        "SCENE_FAILED",
        "cleanup",
        "Space disposal failed",
        { cause: error },
      );
    }
  }

  if (primaryError !== undefined) throw primaryError;
  if (outputs === undefined) {
    throw new PtsRenderError(
      "WORKER_FAILED",
      "export",
      "Render completed without output artifacts",
    );
  }
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    source: job.source,
    loader: job.loader,
    width: space.width,
    height: space.height,
    render: job.render,
    random,
    runtime: runtimeFacts(space),
    outputs,
    warnings,
    ...(metadata === undefined ? {} : { metadata }),
    durationMs,
  };
}
