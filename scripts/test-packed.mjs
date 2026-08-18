import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), "skia-pts-package-"));

try {
  await execute("pnpm", ["pack", "--pack-destination", temporary], {
    cwd: resolve("."),
  });

  const tarballName = (await readdir(temporary)).find((name) =>
    name.endsWith(".tgz"),
  );
  if (!tarballName) throw new Error("pnpm pack did not create a tarball");

  const modules = join(temporary, "node_modules");
  await mkdir(modules);
  await execute("tar", ["-xzf", join(temporary, tarballName), "-C", modules], {
    cwd: temporary,
  });
  await rename(join(modules, "package"), join(modules, "skia-pts-canvas"));

  for (const dependency of ["pts", "skia-canvas"]) {
    const target = await realpath(resolve("node_modules", dependency));
    await symlink(target, join(modules, dependency), "junction");
  }

  const esm = [
    'import("skia-pts-canvas").then(async ({ SkiaCanvasSpace }) => {',
    '  const space = new SkiaCanvasSpace(3, 2, { background: "#010203" });',
    '  const output = await space.toBuffer("raw");',
    '  if (output.length !== 24) throw new Error("ESM raster size mismatch");',
    "});",
  ].join("\n");

  const commonjs = [
    'const { SkiaCanvasSpace } = require("skia-pts-canvas");',
    "(async () => {",
    '  const space = new SkiaCanvasSpace(4, 2, { background: "#010203" });',
    '  const output = await space.toBuffer("raw");',
    '  if (output.length !== 32) throw new Error("CJS raster size mismatch");',
    "})();",
  ].join("\n");

  await execute(process.execPath, ["--input-type=module", "--eval", esm], {
    cwd: temporary,
  });
  await execute(process.execPath, ["--eval", commonjs], {
    cwd: temporary,
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
