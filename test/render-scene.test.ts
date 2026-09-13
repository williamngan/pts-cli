import { fork } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderScene } from "../src/renderScene.js";

// Source-level coverage for the parent, with a real built worker subprocess.
// Only redirect its module path from src/worker.mjs to dist/worker.mjs.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: vi.fn((_path, args, options) =>
      actual.fork(
        fileURLToPath(new URL("../dist/worker.mjs", import.meta.url)),
        args,
        options,
      ),
    ),
  };
});

let directory: string;
const fixture = resolve("test/fixtures/scenes/portable-card.mjs");
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pts-render-test-"));
  vi.mocked(fork).mockClear();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function source(code: string): Promise<string> {
  const path = join(directory, "scene.mjs");
  await writeFile(path, code);
  return path;
}

describe("renderScene worker and artifact lifecycle", () => {
  it("returns verified buffers and commits multiple formats from the same frame", async () => {
    const path = join(directory, "nested", "card.svg");
    const result = await renderScene(fixture, {
      outputs: [{ format: "png" }, { format: "svg", path }],
      seed: "test",
    });
    expect(result.runtime.ptsVersion).toBe("1.0.0");
    expect(result.outputs[0]?.buffer?.readUInt32BE(0)).toBe(0x89504e47);
    expect(await readFile(path, "utf8")).toContain("Pts Render");
    expect(result.logs.stdout).toContain("portable-card run");
    expect(result.outputs.map((output) => output.sha256)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(await readdir(join(directory, "nested"))).toEqual(["card.svg"]);
  });

  it("protects existing files before starting the worker and permits explicit overwrite", async () => {
    const path = join(directory, "card.png");
    await writeFile(path, "original");
    await expect(
      renderScene(fixture, { outputs: [{ format: "png", path }] }),
    ).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect(fork).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe("original");
    await renderScene(fixture, {
      outputs: [{ format: "png", path }],
      overwrite: true,
    });
    expect((await readFile(path)).readUInt32BE(0)).toBe(0x89504e47);
  });

  it("rejects directories and invalid parents before execution", async () => {
    const folder = join(directory, "folder.png");
    const file = join(directory, "file");
    await mkdir(folder);
    await writeFile(file, "original");
    for (const path of [folder, join(file, "out.png")]) {
      await expect(
        renderScene(fixture, {
          outputs: [{ format: "png", path }],
          overwrite: true,
        }),
      ).rejects.toMatchObject({ code: "OUTPUT_TARGET_INVALID" });
    }
    expect(fork).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks and canonical output aliases",
    async () => {
      const folder = join(directory, "real");
      const alias = join(directory, "alias");
      await mkdir(folder);
      await symlink(folder, alias);
      const path = join(folder, "out.png");
      await expect(
        renderScene(fixture, {
          outputs: [
            { format: "png", path },
            { format: "png", path: join(alias, "out.png") },
          ],
        }),
      ).rejects.toMatchObject({ code: "OUTPUT_TARGET_INVALID" });
      await symlink(join(directory, "absent.png"), path);
      await expect(
        renderScene(fixture, {
          outputs: [{ format: "png", path }],
          overwrite: true,
        }),
      ).rejects.toMatchObject({ code: "OUTPUT_TARGET_INVALID" });
      expect(fork).not.toHaveBeenCalled();
    },
  );

  it("checks all buffer limits before committing any path output", async () => {
    const path = join(directory, "card.png");
    await expect(
      renderScene(fixture, {
        outputs: [{ format: "png", path }, { format: "png" }],
        limits: { maxBufferResultBytes: 1 },
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT", phase: "commit" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("preserves scene errors and removes temporary artifacts", async () => {
    const path = join(directory, "bad.png");
    await expect(
      renderScene(resolve("test/fixtures/scenes/failing.mjs"), {
        outputs: [{ format: "png", path }],
      }),
    ).rejects.toMatchObject({
      code: "SCENE_FAILED",
      phase: "setup",
      cause: { message: "fixture scene exploded" },
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("reports which outputs committed if another destination appears during rendering", async () => {
    const first = join(directory, "first.png");
    const second = join(directory, "second.png");
    const scene = await source(
      'import { writeFileSync } from "node:fs"; export default function run({params}) {writeFileSync(params.destination, "racing writer");}',
    );
    await expect(
      renderScene(scene, {
        params: { destination: second },
        outputs: [
          { format: "png", path: first },
          { format: "png", path: second },
        ],
      }),
    ).rejects.toMatchObject({
      code: "OUTPUT_EXISTS",
      phase: "commit",
      details: { committed: [first] },
    });
    expect((await readFile(first)).readUInt32BE(0)).toBe(0x89504e47);
    expect(await readFile(second, "utf8")).toBe("racing writer");
    expect(
      (await readdir(directory)).some((name) => name.endsWith(".tmp")),
    ).toBe(false);
  });

  it("bounds combined worker logs", async () => {
    const scene = await source(
      'export default function run() { console.log("A".repeat(100)); console.error("B".repeat(100)); }',
    );
    const result = await renderScene(scene, {
      outputs: [{ format: "png" }],
      limits: { maxCapturedLogBytes: 12 },
    });
    expect(Buffer.byteLength(result.logs.stdout + result.logs.stderr)).toBe(12);
    expect(result.logs.truncated).toBe(true);
  });

  it("rejects a pre-aborted request without creating outputs", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderScene(fixture, {
        outputs: [{ format: "png", path: join(directory, "out.png") }],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "RENDER_ABORTED" });
    expect(fork).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it("kills a stuck worker on timeout and on cancellation", async () => {
    const controller = new AbortController();
    const path = join(directory, "out.png");
    await expect(
      renderScene(resolve("test/fixtures/scenes/hang.mjs"), {
        outputs: [{ format: "png", path }],
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "RENDER_TIMEOUT" });
    const render = renderScene(resolve("test/fixtures/scenes/hang.mjs"), {
      outputs: [{ format: "png", path }],
      signal: controller.signal,
    });
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await expect(render).rejects.toMatchObject({ code: "RENDER_ABORTED" });
    } finally {
      clearTimeout(timer);
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it("classifies a worker that exits without sending a response", async () => {
    const scene = await source(
      "process.exit(1); export default function run() {}",
    );
    await expect(
      renderScene(scene, { outputs: [{ format: "png" }] }),
    ).rejects.toMatchObject({ code: "WORKER_FAILED", details: { code: 1 } });
  });
});
