#!/usr/bin/env node

import { parseCLIArguments } from "./cliArguments.js";
import { PtsRenderError, serializePtsRenderError } from "./PtsRenderError.js";
import { renderScene } from "./renderScene.js";

const VERSION = "0.1.0";

const HELP = `Pts CLI ${VERSION}

Render portable scenes and compatible classic Pts demos to images and SVG.

Usage:
  ptsjs <source> [--out <destination>] [options]
  ptsjs render <source> [--out <destination>] [options]  (explicit form)
  ptsjs --help
  ptsjs --version

Output:
  -o, --out <path>                 File or trailing-slash directory; repeatable
                                      (- writes stdout; omit for generated PNG)
                                      (default: pts-output/<source>-<uuid>.png)
  --format <png|jpeg|webp|raw|svg> Generated/stdout/extensionless format
                                      (default for generated output: png)
  --density <integer>              Raster pixels per logical unit
  --quality <0..1>                 JPEG or WebP quality
  --matte <color>                  Raster background beneath transparency
  --text-mode <preserve|outline>   SVG text behavior
  --force                          Replace existing output files

Code and rendering:
  --loader <auto|scene|pts-demo>   Source loader (default: auto)
  --size <width>x<height>          Canvas size (default: file or 800x600)
  --background <color>             Canvas background (default: file or transparent)
  --pointer <x>,<y>                Initial pointer state
  --time <ms>                      Render one direct frame (default: 0)
  --frame <index>                  Simulate frames 0 through index
  --fps <number>                   Simulation rate (default: 60)
  --events <file.json>             Replay pointer/action/resize events
  --seed <string>                  Seed Pts and worker Math.random
  --params <file.json>             Base render parameters
  --param <key=value>              Override a parameter; repeatable
  --asset-root <path|URL>          Base for relative scene assets
  --allow-net                      Permit network asset loading
  --font <family=path>             Register a font; repeatable
  --renderer <cpu|auto|gpu>        Renderer policy (default: cpu)

Automation and safety:
  --timeout <ms>                   Hard worker deadline (default: 30000)
  --limit <name=value>             Override a resource limit; repeatable
  --json                           Emit one machine-readable JSON record
  --quiet                          Suppress human diagnostics
  --debug                          Include stacks in failure JSON
`;

function exitCode(error: PtsRenderError): number {
  if (error.code === "RENDER_TIMEOUT") return 124;
  if (error.code === "RENDER_ABORTED") return 130;
  if (
    error.code === "CLI_USAGE" ||
    error.code === "INPUT_TIMELINE_INVALID" ||
    error.code === "RESOURCE_LIMIT" ||
    error.code === "OUTPUT_OPTION_INVALID" ||
    error.code === "OUTPUT_TARGET_INVALID"
  ) {
    return 2;
  }
  if (
    error.code === "SOURCE_NOT_FOUND" ||
    error.code === "LOADER_AMBIGUOUS" ||
    error.code === "COMPAT_API_UNSUPPORTED" ||
    error.code === "SCENE_INVALID" ||
    error.code === "SCENE_API_UNSUPPORTED" ||
    error.code === "PTS_INCOMPATIBLE" ||
    error.code === "PTS_INSTANCE_MISMATCH"
  ) {
    return 3;
  }
  if (error.code === "SCENE_FAILED" && error.phase === "load") return 3;
  if (error.code === "SCENE_FAILED" && error.phase === "cleanup") return 4;
  if (error.code === "OUTPUT_EXISTS" || error.code === "OUTPUT_COMMIT_FAILED") {
    return 5;
  }
  if (
    error.code === "RENDERER_UNAVAILABLE" ||
    error.code === "WORKER_FAILED" ||
    (error.code === "NATIVE_RENDER_FAILED" && error.phase !== "export")
  ) {
    return 6;
  }
  if (
    error.phase === "setup" ||
    error.phase === "input" ||
    error.phase === "frame"
  ) {
    return 4;
  }
  if (error.phase === "export" || error.phase === "commit") return 5;
  return 6;
}

function normalizeError(error: unknown): PtsRenderError {
  return error instanceof PtsRenderError
    ? error
    : new PtsRenderError(
        "WORKER_FAILED",
        "load",
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
}

function writeStdout(value: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(value, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantsJson = argv.some(
    (argument) => argument === "--json" || argument.startsWith("--json="),
  );
  const wantsDebug = argv.includes("--debug");
  let renderId: string | undefined;

  try {
    const parsed = await parseCLIArguments(argv);
    if (parsed.command !== "render") {
      await writeStdout(parsed.command === "help" ? HELP : VERSION + "\n");
      return;
    }
    renderId = parsed.renderId;

    const controller = new AbortController();
    const interrupt = (): void => controller.abort();
    process.once("SIGINT", interrupt);
    let result;
    try {
      result = await renderScene(parsed.source, {
        ...parsed.options,
        signal: controller.signal,
      });
    } finally {
      process.removeListener("SIGINT", interrupt);
    }

    if (parsed.json) {
      await writeStdout(
        JSON.stringify({ ok: true, renderId: parsed.renderId, ...result }) +
          "\n",
      );
      return;
    }

    if (!parsed.quiet) {
      for (const warning of result.warnings) {
        process.stderr.write(
          "ptsjs: " + warning.code + ": " + warning.message + "\n",
        );
      }
      if (result.logs.stdout) process.stderr.write(result.logs.stdout);
      if (result.logs.stderr) process.stderr.write(result.logs.stderr);
    }
    const bufferOutput = result.outputs.find(
      (output): output is typeof output & { buffer: Buffer } =>
        output.buffer !== undefined,
    );
    if (bufferOutput) await writeStdout(bufferOutput.buffer);

    if (!parsed.quiet) {
      for (const output of result.outputs) {
        if (output.path) {
          process.stderr.write(
            "Rendered " +
              output.format.toUpperCase() +
              " (" +
              String(output.bytes) +
              " bytes): " +
              output.path +
              "\n",
          );
        }
      }
    }
  } catch (caught) {
    const error = normalizeError(caught);
    process.exitCode = exitCode(error);
    if (wantsJson) {
      await writeStdout(
        JSON.stringify({
          schemaVersion: 1,
          ok: false,
          ...(renderId === undefined ? {} : { renderId }),
          error: serializePtsRenderError(error, wantsDebug),
        }) + "\n",
      );
      return;
    }
    process.stderr.write("ptsjs: " + error.code + ": " + error.message + "\n");
    if (error.hint) process.stderr.write("Hint: " + error.hint + "\n");
  }
}

void main().catch((error: unknown) => {
  process.exitCode = 6;
  process.stderr.write(
    "ptsjs: WORKER_FAILED: " +
      (error instanceof Error ? error.message : String(error)) +
      "\n",
  );
});
