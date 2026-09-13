import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

import { renderScene } from "../dist/index.mjs";

const cli = resolve("dist/cli.mjs");
const scene = resolve("test/fixtures/scenes/portable-card.mjs");
const functionScene = resolve("test/fixtures/scenes/portable-function.mjs");
const hangingScene = resolve("test/fixtures/scenes/hang.mjs");
const classicScene = resolve("test/fixtures/classic/quick-start.js");
const ambiguousScene = resolve("test/fixtures/classic/ambiguous.mjs");
const commonjsScene = resolve("test/fixtures/scenes/commonjs.cjs");
const commonjsDefaultScene = resolve(
  "test/fixtures/scenes/commonjs-default.cjs",
);
const namedOnlyScene = resolve("test/fixtures/scenes/named-only.mjs");
const imageScene = resolve("test/fixtures/scenes/portable-image.mjs");
const fontScene = resolve("test/fixtures/scenes/portable-font.mjs");
const failingScene = resolve("test/fixtures/scenes/failing.mjs");
const systemFont = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  join(process.env.SystemRoot ?? "C:\\Windows", "Fonts", "arial.ttf"),
].find((path) => existsSync(path));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, cwd, { closeStdout = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      ...(cwd === undefined ? {} : { cwd }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    // Simulate a consumer such as `head` that stops reading immediately.
    if (closeStdout) child.stdout.destroy();
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolveRun({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
  });
}

// Child processes resolve cwd symlinks, including macOS temporary directories.
// Use the same canonical path when checking their generated output locations.
const temporary = await realpath(
  await mkdtemp(join(tmpdir(), "pts-render-integration-")),
);

try {
  const brokenPipe = await run(
    ["render", scene, "--out", "-", "--format", "png"],
    undefined,
    { closeStdout: true },
  );
  assert(brokenPipe.code === 0, "closed stdout changed the exit status");
  assert(
    !brokenPipe.stderr.toString().includes("EPIPE"),
    "closed stdout leaked an EPIPE stack trace",
  );
  const brokenJsonPipe = await run(["render", scene, "--json"], undefined, {
    closeStdout: true,
  });
  assert(brokenJsonPipe.code === 0, "closed JSON stdout changed the exit");
  assert(
    !brokenJsonPipe.stderr.toString().includes("EPIPE"),
    "closed JSON stdout leaked an EPIPE stack trace",
  );

  const noArguments = await run([]);
  assert(
    noArguments.code === 2,
    "no-argument invocation must be a usage error",
  );
  assert(
    noArguments.stderr.toString().includes("--help"),
    "no-argument invocation must point at --help",
  );
  const help = await run(["--help"]);
  assert(help.code === 0, "--help failed");
  assert(
    help.stdout.toString().includes("pts-render <source>"),
    "help is incomplete",
  );
  assert(
    help.stdout.toString().includes("pts-output/<source>-<uuid>.png"),
    "help omits generated output behavior",
  );

  const generated = await run([scene, "--json"], temporary);
  assert(generated.code === 0, generated.stderr.toString());
  const generatedRecord = JSON.parse(generated.stdout.toString());
  assert(
    /^[0-9a-f-]{36}$/.test(generatedRecord.renderId),
    "generated render ID is missing",
  );
  assert(
    generatedRecord.outputs[0].format === "png" &&
      dirname(generatedRecord.outputs[0].path) ===
        join(temporary, "pts-output") &&
      basename(generatedRecord.outputs[0].path) ===
        "portable-card-" + generatedRecord.renderId + ".png",
    "default output path is unstable",
  );
  assert(
    (await readFile(generatedRecord.outputs[0].path)).readUInt32BE(0) ===
      0x89504e47,
    "generated PNG is invalid",
  );

  const defaultSize = await run([
    "render",
    functionScene,
    "--out",
    join(temporary, "default-size.png"),
    "--json",
  ]);
  assert(defaultSize.code === 0, defaultSize.stderr.toString());
  const defaultSizeRecord = JSON.parse(defaultSize.stdout.toString());
  assert(
    defaultSizeRecord.width === 800 && defaultSizeRecord.height === 600,
    "dimension-free render did not use the 800x600 default",
  );

  const overriddenSize = await run([
    "render",
    scene,
    "--size",
    "320x180",
    "--background",
    "#10283a",
    "--out",
    join(temporary, "overridden-size.png"),
    "--json",
  ]);
  assert(overriddenSize.code === 0, overriddenSize.stderr.toString());
  const overriddenSizeRecord = JSON.parse(overriddenSize.stdout.toString());
  assert(
    overriddenSizeRecord.width === 320 && overriddenSizeRecord.height === 180,
    "--size did not override the render file dimensions",
  );

  const overriddenBackground = await run([
    "render",
    functionScene,
    "--size",
    "4x3",
    "--background",
    "#10283a",
    "--out",
    "-",
    "--format",
    "raw",
    "--quiet",
  ]);
  assert(
    overriddenBackground.code === 0,
    overriddenBackground.stderr.toString(),
  );
  assert(
    overriddenBackground.stdout.length === 4 * 3 * 4 &&
      overriddenBackground.stdout
        .subarray(0, 4)
        .equals(Buffer.from([0x10, 0x28, 0x3a, 0xff])),
    "--background did not override the transparent default",
  );

  const generatedSvgDirectory = join(temporary, "generated-svg") + sep;
  const generatedSvg = await run(
    [
      "render",
      scene,
      "--out",
      generatedSvgDirectory,
      "--format",
      "svg",
      "--json",
    ],
    temporary,
  );
  assert(generatedSvg.code === 0, generatedSvg.stderr.toString());
  const generatedSvgRecord = JSON.parse(generatedSvg.stdout.toString());
  assert(
    dirname(generatedSvgRecord.outputs[0].path) ===
      generatedSvgDirectory.slice(0, -1) &&
      basename(generatedSvgRecord.outputs[0].path) ===
        "portable-card-" + generatedSvgRecord.renderId + ".svg",
    "directory output path is unstable",
  );
  assert(
    (await readFile(generatedSvgRecord.outputs[0].path, "utf8")).includes(
      "<svg",
    ),
    "generated directory SVG is invalid",
  );

  const pngPath = join(temporary, "created", "card.png");
  const svgPath = join(temporary, "created", "card.svg");
  const rendered = await run([
    "render",
    scene,
    "--pointer",
    "48,32",
    "--seed",
    "fixture",
    "--out",
    pngPath,
    "--out",
    svgPath,
    "--text-mode",
    "outline",
    "--json",
  ]);
  assert(rendered.code === 0, rendered.stderr.toString());
  const record = JSON.parse(rendered.stdout.toString());
  assert(
    record.ok === true && record.schemaVersion === 1,
    "invalid success JSON",
  );
  assert(/^[0-9a-f-]{36}$/.test(record.renderId), "render ID is missing");
  assert(record.outputs.length === 2, "missing CLI outputs");
  assert(
    (await stat(pngPath)).size === record.outputs[0].bytes,
    "PNG size mismatch",
  );
  assert(
    (await stat(svgPath)).size === record.outputs[1].bytes,
    "SVG size mismatch",
  );

  const classicPng = join(temporary, "classic.png");
  const classicSvg = join(temporary, "classic.svg");
  const classic = await run([
    "render",
    classicScene,
    "--size",
    "18x12",
    "--out",
    classicPng,
    "--out",
    classicSvg,
    "--json",
  ]);
  assert(classic.code === 0, classic.stderr.toString());
  const classicRecord = JSON.parse(classic.stdout.toString());
  assert(classicRecord.loader === "pts-demo", "classic auto-detection failed");
  assert(
    classicRecord.metadata.demoDescription === "Classic quickStart fixture",
    "classic metadata missing",
  );
  assert((await stat(classicPng)).size > 100, "classic PNG is empty");
  assert(
    (await readFile(classicSvg, "utf8")).includes("<svg"),
    "classic SVG is invalid",
  );

  const ambiguous = await run([
    "render",
    ambiguousScene,
    "--out",
    join(temporary, "ambiguous.png"),
    "--json",
  ]);
  const ambiguousRecord = JSON.parse(ambiguous.stdout.toString());
  assert(ambiguous.code === 3, "ambiguous loader used the wrong exit code");
  assert(
    ambiguousRecord.error.code === "LOADER_AMBIGUOUS",
    "ambiguous loader error is unstable",
  );

  for (const commonjsSource of [commonjsScene, commonjsDefaultScene]) {
    const commonjs = await renderScene(commonjsSource, {
      outputs: [{ format: "png" }],
    });
    assert(commonjs.loader === "scene", "CommonJS scene loader mismatch");
    assert(
      commonjs.width === 7 && commonjs.height === 5,
      "CommonJS size mismatch",
    );
  }

  let namedOnlyError;
  try {
    await renderScene(namedOnlyScene, { outputs: [{ format: "png" }] });
  } catch (error) {
    namedOnlyError = error;
  }
  assert(
    namedOnlyError?.code === "SCENE_INVALID",
    "a named-only module was accepted as a scene",
  );

  const imageResult = await renderScene(imageScene, {
    outputs: [{ format: "png" }, { format: "svg" }],
  });
  assert(
    imageResult.outputs[0].buffer?.readUInt32BE(0) === 0x89504e47,
    "portable image PNG is invalid",
  );
  assert(
    imageResult.outputs[1].buffer?.includes(Buffer.from("<svg")),
    "portable image SVG is invalid",
  );

  if (systemFont !== undefined) {
    const fontOutput = await run([
      "render",
      fontScene,
      "--font",
      "Pts Render Configured Font=" + systemFont,
      "--asset-root",
      resolve("test/fixtures/assets"),
      "--out",
      join(temporary, "font.svg"),
      "--text-mode",
      "outline",
      "--json",
    ]);
    assert(fontOutput.code === 0, fontOutput.stderr.toString());
    const fontRecord = JSON.parse(fontOutput.stdout.toString());
    assert(
      fontRecord.outputs[0].format === "svg",
      "configured font SVG is invalid",
    );
  }

  const collision = await run(["render", scene, "--out", pngPath, "--json"]);
  const collisionRecord = JSON.parse(collision.stdout.toString());
  assert(collision.code === 5, "no-clobber failure used the wrong exit code");
  assert(
    collisionRecord.error.code === "OUTPUT_EXISTS",
    "wrong collision code",
  );

  const directoryTarget = join(temporary, "directory-target.png");
  await mkdir(directoryTarget);
  const directoryOutput = await run([
    "render",
    scene,
    "--out",
    directoryTarget,
    "--json",
  ]);
  const directoryRecord = JSON.parse(directoryOutput.stdout.toString());
  assert(directoryOutput.code === 2, "directory target used the wrong exit");
  assert(
    directoryRecord.error.code === "OUTPUT_TARGET_INVALID",
    "directory target used the wrong error",
  );

  if (process.platform !== "win32") {
    const symlinkSource = join(temporary, "symlink-source.png");
    const symlinkTarget = join(temporary, "symlink-target.png");
    await writeFile(symlinkSource, "owned by fixture");
    await symlink(symlinkSource, symlinkTarget);
    const symlinkOutput = await run([
      "render",
      scene,
      "--out",
      symlinkTarget,
      "--force",
      "--json",
    ]);
    const symlinkRecord = JSON.parse(symlinkOutput.stdout.toString());
    assert(symlinkOutput.code === 2, "symlink target used the wrong exit");
    assert(
      symlinkRecord.error.code === "OUTPUT_TARGET_INVALID",
      "symlink target used the wrong error",
    );
    assert(
      (await lstat(symlinkTarget)).isSymbolicLink(),
      "symlink target was replaced",
    );

    const canonicalDirectory = join(temporary, "canonical-output");
    const aliasDirectory = join(temporary, "canonical-alias");
    await mkdir(canonicalDirectory);
    await symlink(canonicalDirectory, aliasDirectory);
    const duplicateCanonical = await run([
      "render",
      scene,
      "--out",
      join(canonicalDirectory, "same.png"),
      "--out",
      join(aliasDirectory, "same.png"),
      "--json",
    ]);
    const duplicateCanonicalRecord = JSON.parse(
      duplicateCanonical.stdout.toString(),
    );
    assert(
      duplicateCanonical.code === 2,
      "canonical duplicate used the wrong exit",
    );
    assert(
      duplicateCanonicalRecord.error.code === "OUTPUT_TARGET_INVALID",
      "canonical duplicate used the wrong error",
    );
  }

  const stdoutSvg = await run([
    "render",
    scene,
    "--out",
    "-",
    "--format",
    "svg",
    "--quiet",
  ]);
  assert(stdoutSvg.code === 0, stdoutSvg.stderr.toString());
  assert(
    stdoutSvg.stdout.toString().startsWith('<?xml version="1.0"'),
    "SVG stdout was contaminated",
  );

  const invalid = await run([
    "render",
    scene,
    "--out",
    join(temporary, "unused.png"),
    "--unknown",
    "--json",
  ]);
  const invalidRecord = JSON.parse(invalid.stdout.toString());
  assert(invalid.code === 2, "usage failure used the wrong exit code");
  assert(invalidRecord.error.code === "CLI_USAGE", "usage JSON is unstable");

  const failedScene = await run([
    "render",
    failingScene,
    "--out",
    join(temporary, "failed.png"),
    "--json",
  ]);
  const failedSceneRecord = JSON.parse(failedScene.stdout.toString());
  assert(failedScene.code === 4, "scene failure used the wrong exit code");
  assert(
    failedSceneRecord.error.code === "SCENE_FAILED" &&
      failedSceneRecord.error.phase === "setup",
    "scene failure classification is unstable",
  );
  assert(
    failedSceneRecord.error.cause?.message === "fixture scene exploded" &&
      failedSceneRecord.error.cause?.name === "TypeError",
    "scene failure lost its cause",
  );
  assert(
    failedSceneRecord.error.cause.stack === undefined,
    "non-debug JSON leaked a cause stack",
  );

  const debugFailure = await run([
    "render",
    failingScene,
    "--out",
    join(temporary, "debug-failed.png"),
    "--json",
    "--debug",
  ]);
  const debugFailureRecord = JSON.parse(debugFailure.stdout.toString());
  assert(debugFailure.code === 4, "debug failure used the wrong exit code");
  assert(
    debugFailureRecord.error.stack?.includes("Render function failed") &&
      debugFailureRecord.error.cause?.stack?.includes("fixture scene exploded"),
    "debug JSON omitted worker or cause stacks",
  );

  const timedOut = await run([
    "render",
    hangingScene,
    "--out",
    join(temporary, "hang.png"),
    "--timeout",
    "100",
    "--json",
  ]);
  const timeoutRecord = JSON.parse(timedOut.stdout.toString());
  assert(timedOut.code === 124, "timeout used the wrong exit code");
  assert(timeoutRecord.error.code === "RENDER_TIMEOUT", "wrong timeout code");

  const programmaticPath = join(temporary, "programmatic.svg");
  const programmatic = await renderScene(scene, {
    seed: "fixture",
    pointer: [48, 32],
    outputs: [
      { format: "png" },
      { path: programmaticPath, format: "svg", textMode: "preserve" },
    ],
  });
  assert(
    programmatic.outputs[0].buffer?.readUInt32BE(0) === 0x89504e47,
    "bad PNG Buffer",
  );
  assert(
    (await readFile(programmaticPath, "utf8")).includes("Pts Render"),
    "bad SVG file",
  );
  assert(
    programmatic.logs.stdout.includes("portable-card run"),
    "scene log missing",
  );

  const importFailure = join(temporary, "import-failure.mjs");
  await writeFile(
    importFailure,
    'import "./missing-module.mjs"; export default function run() {}',
  );
  const failedImport = await run([importFailure, "--json"], temporary);
  assert(failedImport.code === 3, "source import failure must exit 3");
  assert(
    JSON.parse(failedImport.stdout).error.phase === "load",
    "import failure lost its phase",
  );

  const cleanupFailure = join(temporary, "cleanup-failure.mjs");
  await writeFile(
    cleanupFailure,
    'export default function run() { return () => { throw new Error("cleanup exploded"); }; }',
  );
  const failedCleanup = await run([cleanupFailure, "--json"], temporary);
  assert(failedCleanup.code === 4, "scene cleanup failure must exit 4");
  assert(
    JSON.parse(failedCleanup.stdout).error.phase === "cleanup",
    "cleanup failure lost its phase",
  );

  for (const fixture of ["foreign-commonjs.cjs", "foreign-bundle.mjs"]) {
    const rejected = await run(
      [resolve("test/fixtures/scenes", fixture), "--seed", "fixture", "--json"],
      temporary,
    );
    const error = JSON.parse(rejected.stdout).error;
    assert(
      rejected.code === 3 && error.code === "PTS_INSTANCE_MISMATCH",
      fixture + " selected a second Pts implementation",
    );
    assert(
      error.hint.includes("Pts"),
      "mismatch error must include an alternative",
    );
  }
  let canonicalRandom;
  for (const [fixture, dynamicImport] of [
    ["random-esm.mjs", false],
    ["random-commonjs.cjs", false],
    ["random-commonjs.cjs", true],
  ]) {
    const samples = [];
    for (const noise of [false, true]) {
      const result = await renderScene(
        resolve("test/fixtures/scenes", fixture),
        {
          seed: "fixture",
          params: { noise, dynamicImport },
          outputs: [{ format: "png" }],
        },
      );
      samples.push(JSON.parse(result.logs.stdout));
      assert(
        result.runtime.ptsVersion === "1.0.0",
        "integration test is not using published Pts 1.0.0",
      );
    }
    assert(
      JSON.stringify(samples[0].pts) === JSON.stringify(samples[1].pts),
      "Math.random changed the Pts seeded stream",
    );
    assert(
      samples[0].math !== samples[1].math,
      "the Math stream did not advance",
    );
    canonicalRandom ??= samples[0].pts;
    assert(
      JSON.stringify(samples[0].pts) === JSON.stringify(canonicalRandom),
      "ESM/CommonJS seeded streams differ",
    );
  }

  const filteredScene = resolve("test/fixtures/scenes/filtered-image.mjs");
  const filtered = await renderScene(filteredScene, {
    outputs: [{ format: "png" }, { format: "svg" }],
  });
  assert(
    filtered.warnings.some((warning) => warning.code === "SVG_RASTER_FALLBACK"),
    "SVG fallback warning missing",
  );
  const embedded = /data:image\/png;base64,([^"\s]+)/.exec(
    filtered.outputs[1].buffer.toString(),
  )?.[1];
  assert(
    embedded &&
      Buffer.from(embedded, "base64").equals(filtered.outputs[0].buffer),
    "filtered SVG lost image content",
  );
  const humanFallback = await run([
    filteredScene,
    "--out",
    join(temporary, "filtered.svg"),
  ]);
  assert(
    humanFallback.code === 0 &&
      humanFallback.stderr.includes("SVG_RASTER_FALLBACK"),
    "human CLI hides SVG fallback",
  );
  const limitedFallback = await run([
    filteredScene,
    "--out",
    join(temporary, "limited.svg"),
    "--limit",
    "maxRasterPixelsPerOutput=1",
    "--json",
  ]);
  assert(
    limitedFallback.code === 2 &&
      JSON.parse(limitedFallback.stdout).error.code === "RESOURCE_LIMIT",
    "SVG fallback bypassed raster allocation limits",
  );
  assert(
    !existsSync(join(temporary, "limited.svg")),
    "failed SVG output was committed",
  );

  const timelineFile = join(temporary, "events.json");
  await writeFile(
    timelineFile,
    JSON.stringify({
      schemaVersion: 1,
      events: [
        { at: 50, type: "move", x: 4, y: 2 },
        { at: 0, type: "resize", width: 10, height: 6 },
        { at: 50, type: "down", x: 5, y: 3 },
        { at: 200, type: "move", x: 99, y: 99 },
      ],
    }),
  );
  for (const clock of [
    ["--frame", "2", "--fps", "20"],
    ["--time", "100"],
  ]) {
    const timeline = await run([
      resolve("test/fixtures/scenes/timeline.mjs"),
      ...clock,
      "--events",
      timelineFile,
      "--pointer",
      "1,1",
      "--out",
      join(temporary, clock[0] + ".png"),
      "--json",
    ]);
    assert(timeline.code === 0, timeline.stdout.toString());
    const record = JSON.parse(timeline.stdout);
    const calls = record.logs.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const frames = calls.filter((call) => call[0] === "frame");
    const expectedFrames =
      clock[0] === "--frame"
        ? [
            ["frame", 0, 0, 1, 1],
            ["frame", 50, 50, 5, 3],
            ["frame", 100, 50, 5, 3],
          ]
        : [["frame", 100, 0, 5, 3]];
    assert(
      JSON.stringify(frames) === JSON.stringify(expectedFrames),
      "CLI clock or input replay is incorrect",
    );
    assert(
      JSON.stringify(
        calls.filter((call) => ["move", "down"].includes(call[0])),
      ) ===
        JSON.stringify([
          ["move", 4, 2, 50],
          ["down", 5, 3, 50],
        ]),
      "event ordering or final-time cutoff is incorrect",
    );
    assert(
      record.width === 10 &&
        record.height === 6 &&
        calls.at(-1)[0] === "cleanup",
      "resize or cleanup result is incorrect",
    );
  }

  const overwritten = await run([
    scene,
    "--out",
    pngPath,
    "--background",
    "#ffffff",
    "--force",
    "--json",
  ]);
  assert(overwritten.code === 0, "--force did not replace a regular file");
  assert(
    JSON.parse(overwritten.stdout).outputs[0].sha256 !==
      record.outputs[0].sha256,
    "--force did not change output contents",
  );
  console.log("CLI integration and release regressions passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
