import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execute } from "./execute.mjs";
const temporary = await mkdtemp(join(tmpdir(), "skia-pts-package-"));

try {
  // Start from source only: prepack must create every executable and export.
  const clean = join(temporary, "clean-source");
  await mkdir(clean);
  for (const name of [
    "src",
    "compatibility",
    "package.json",
    "tsconfig.json",
    "tsdown.config.mts",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]) {
    await cp(resolve(name), join(clean, name), { recursive: true });
  }
  await symlink(
    await realpath(resolve("node_modules")),
    join(clean, "node_modules"),
    "junction",
  );
  await execute("npm", ["pack", "--pack-destination", temporary], {
    cwd: clean,
  });

  const tarballName = (await readdir(temporary)).find((name) =>
    name.endsWith(".tgz"),
  );
  if (!tarballName) throw new Error("npm pack did not create a tarball");

  // Exercise npm peer resolution, native installation and executable linking.
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "pts-cli-consumer", private: true }),
  );
  await execute(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      ...(process.env.SANDBOX_OFFLINE === "1" ? ["--offline"] : []),
      join(temporary, tarballName),
    ],
    { cwd: consumer },
  );
  const modules = join(consumer, "node_modules");
  const lock = JSON.parse(
    await readFile(join(consumer, "package-lock.json"), "utf8"),
  );
  const installedPts = lock.packages["node_modules/pts"];
  if (
    !installedPts ||
    !installedPts.version.startsWith("1.") ||
    !installedPts.resolved?.startsWith("https://registry.npmjs.org/pts/-/pts-")
  ) {
    throw new Error(
      "The consumer did not resolve Pts from the npm 1.x release line",
    );
  }
  await execute("npm", ["ls", "pts"], { cwd: consumer });

  const scenePath = join(consumer, "packed-scene.mjs");
  await writeFile(
    scenePath,
    [
      "export default {",
      "  width: 8, height: 6, background: '#010203',",
      "  run({ space, form }) {",
      "    space.add(() => form.fillOnly('#ff0000').point([3, 2], 1, 'square'));",
      "  },",
      "};",
    ].join("\n"),
  );

  const dedupedScenePath = join(consumer, "deduped-scene.mjs");
  await writeFile(
    dedupedScenePath,
    [
      'import { Pt } from "pts";',
      "export default {",
      "  width: 8, height: 6,",
      "  run({ space, form }) {",
      "    space.add(() => form.fillOnly('#00ff00').point(new Pt(3, 2), 1, 'square'));",
      "  },",
      "};",
    ].join("\n"),
  );

  const foreignDirectory = join(temporary, "foreign-project");
  const foreignModules = join(foreignDirectory, "node_modules");
  await mkdir(foreignModules, { recursive: true });
  await cp(join(modules, "pts"), join(foreignModules, "pts"), {
    recursive: true,
  });
  const foreignScenePath = join(foreignDirectory, "foreign-scene.mjs");
  await writeFile(
    foreignScenePath,
    [
      'import { Pt } from "pts";',
      "export default {",
      "  width: 8, height: 6,",
      "  run({ space, form }) {",
      "    space.add(() => form.point(new Pt(1, 1)));",
      "  },",
      "};",
    ].join("\n"),
  );

  const esm = [
    'import("pts-cli").then(async ({ renderScene, SkiaCanvasSpace }) => {',
    '  const space = new SkiaCanvasSpace(3, 2, { background: "#010203" });',
    '  const output = await space.toBuffer("raw");',
    '  if (output.length !== 24) throw new Error("ESM raster size mismatch");',
    `  const rendered = await renderScene(${JSON.stringify(scenePath)}, { outputs: [{ format: "svg" }] });`,
    '  if (!rendered.outputs[0].buffer.toString().includes("<svg")) throw new Error("renderScene SVG mismatch");',
    `  const deduped = await renderScene(${JSON.stringify(dedupedScenePath)}, { outputs: [{ format: "png" }] });`,
    '  if (deduped.outputs[0].buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("deduped Pts render mismatch");',
    "  let mismatch;",
    `  try { await renderScene(${JSON.stringify(foreignScenePath)}, { outputs: [{ format: "png" }] }); } catch (error) { mismatch = error; }`,
    '  if (mismatch?.code !== "PTS_INSTANCE_MISMATCH") throw new Error("duplicate Pts was not rejected");',
    '  const sceneEntry = await import("pts-cli/scene");',
    '  if (sceneEntry.defineScene({ run() {} }).run === undefined) throw new Error("scene entry mismatch");',
    '  const browserEntry = await import("pts-cli/browser");',
    '  if (typeof browserEntry.mountScene !== "function") throw new Error("browser entry mismatch");',
    "});",
  ].join("\n");

  const commonjs = [
    'const { SkiaCanvasSpace } = require("pts-cli");',
    'const { mountScene } = require("pts-cli/browser");',
    "(async () => {",
    '  if (typeof mountScene !== "function") throw new Error("CJS browser entry mismatch");',
    '  const space = new SkiaCanvasSpace(4, 2, { background: "#010203" });',
    '  const output = await space.toBuffer("raw");',
    '  if (output.length !== 32) throw new Error("CJS raster size mismatch");',
    "})();",
  ].join("\n");

  await execute(process.execPath, ["--input-type=module", "--eval", esm], {
    cwd: consumer,
  });
  await execute(process.execPath, ["--eval", commonjs], {
    cwd: consumer,
  });

  const bin = join(modules, "pts-cli", "dist", "cli.mjs");
  if (process.platform !== "win32" && ((await stat(bin)).mode & 0o111) === 0) {
    throw new Error("ptsjs bin is not executable");
  }
  await stat(join(modules, "pts-cli", "compatibility", "pts-revamp.json"));
  const installedBin = join(
    modules,
    ".bin",
    process.platform === "win32" ? "ptsjs.cmd" : "ptsjs",
  );
  const version = await execute(installedBin, ["--version"], { cwd: consumer });
  const metadata = JSON.parse(
    await readFile(join(modules, "pts-cli", "package.json"), "utf8"),
  );
  if (version.stdout.trim() !== metadata.version)
    throw new Error(
      "Installed executable version does not match package metadata",
    );
  if (metadata.private) throw new Error("Release package is still private");
  const help = await execute(process.execPath, [bin, "--help"], {
    cwd: temporary,
  });
  if (!help.stdout.includes("ptsjs <source>")) {
    throw new Error("packed ptsjs help mismatch");
  }
  const generated = await execute(
    process.execPath,
    [bin, scenePath, "--json"],
    { cwd: temporary },
  );
  const generatedRecord = JSON.parse(generated.stdout);
  const generatedPath = generatedRecord.outputs?.[0]?.path;
  if (
    generatedRecord.renderId === undefined ||
    typeof generatedPath !== "string" ||
    !generatedPath.includes(generatedRecord.renderId) ||
    (await readFile(generatedPath)).readUInt32BE(0) !== 0x89504e47
  ) {
    throw new Error("packed ptsjs generated PNG mismatch");
  }
  const outputPath = join(temporary, "packed-output.png");
  await execute(
    process.execPath,
    [bin, "render", scenePath, "--out", outputPath, "--quiet"],
    { cwd: temporary },
  );
  const png = await readFile(outputPath);
  if (png.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("packed ptsjs PNG mismatch");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
