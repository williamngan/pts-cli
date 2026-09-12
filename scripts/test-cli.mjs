import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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

function run(args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      ...(cwd === undefined ? {} : { cwd }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
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

const temporary = await mkdtemp(join(tmpdir(), "pts-cli-integration-"));

try {
  const help = await run(["--help"]);
  assert(help.code === 0, "--help failed");
  assert(
    help.stdout.toString().includes("ptsjs <source>"),
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
      "Pts CLI Configured Font=" + systemFont,
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
    (await readFile(programmaticPath, "utf8")).includes("Pts CLI"),
    "bad SVG file",
  );
  assert(
    programmatic.logs.stdout.includes("portable-card run"),
    "scene log missing",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
