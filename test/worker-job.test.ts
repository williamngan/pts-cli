import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkerJob } from "../src/runWorkerJob.js";
import { DEFAULT_RENDER_RESOURCE_LIMITS } from "../src/renderTypes.js";
import type { RenderWorkerJob } from "../src/workerProtocol.js";

let directory: string;
const nativeRandom = Math.random;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pts-worker-test-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  Math.random = nativeRandom;
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

function job(
  fixture: string,
  overrides: Partial<RenderWorkerJob> = {},
): RenderWorkerJob {
  return {
    source: resolve("test/fixtures/scenes", fixture),
    loader: "scene",
    render: { mode: "direct", time: 0, framesInvoked: 1 },
    events: [],
    params: {},
    allowNet: false,
    fonts: [],
    renderer: "cpu",
    limits: { ...DEFAULT_RENDER_RESOURCE_LIMITS },
    outputs: [
      { request: { format: "png" }, artifactPath: join(directory, "out.png") },
    ],
    ...overrides,
  };
}

describe("worker render job", () => {
  it("evaluates classic mobile detection without a Node navigator global", async () => {
    const source = join(directory, "mobile.js");
    await writeFile(
      source,
      'Pts.quickStart("#pt"); if (Util.isMobile() || Pts.Util.isMobile()) throw new Error("Not a mobile browser"); space.add(() => form.fillOnly("#f00").point([2, 2], 2));',
    );
    vi.stubGlobal("navigator", undefined);
    try {
      const result = await runWorkerJob(
        job("unused", { source, loader: "pts-demo" }),
      );
      expect(result.loader).toBe("pts-demo");
      expect(result.outputs[0]?.bytes).toBeGreaterThan(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("loads a scene, applies seed and input, and encodes every output format", async () => {
    const formats = ["png", "jpeg", "webp", "raw", "svg"] as const;
    const result = await runWorkerJob(
      job("timeline.mjs", {
        seed: "unit",
        pointer: [1, 1],
        render: {
          mode: "frame",
          frame: 2,
          fps: 20,
          time: 100,
          framesInvoked: 3,
        },
        events: [
          { at: 0, type: "resize", width: 10, height: 6 },
          { at: 50, type: "move", x: 5, y: 3 },
        ],
        outputs: formats.map((format) => ({
          request: { format },
          artifactPath: join(directory, "out." + format),
        })),
      }),
    );
    expect([result.width, result.height]).toEqual([10, 6]);
    expect(result.random).toMatchObject({ seed: "unit", seedApplied: true });
    expect(result.outputs.map((output) => output.format)).toEqual(formats);
    expect(await readFile(join(directory, "out.raw"))).toHaveLength(10 * 6 * 4);
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify(["frame", 100, 50, 5, 3]),
    );
    expect(console.log).toHaveBeenLastCalledWith(JSON.stringify(["cleanup"]));
  });

  it("exports filtered SVG with visible content and an explicit fallback warning", async () => {
    const result = await runWorkerJob(
      job("filtered-image.mjs", {
        outputs: [
          {
            request: { format: "svg" },
            artifactPath: join(directory, "out.svg"),
          },
        ],
      }),
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "SVG_RASTER_FALLBACK" }),
    ]);
    expect(await readFile(join(directory, "out.svg"), "utf8")).toContain(
      "data:image/png;base64,",
    );
  });

  it.each([
    ["named-only.mjs", "SCENE_INVALID", "validate"],
    ["failing.mjs", "SCENE_FAILED", "setup"],
    ["foreign-commonjs.cjs", "PTS_INSTANCE_MISMATCH", "load"],
    ["foreign-bundle.mjs", "PTS_INSTANCE_MISMATCH", "load"],
    ["absent.mjs", "SOURCE_NOT_FOUND", "load"],
  ])("classifies %s before exporting", async (fixture, code, phase) => {
    await expect(runWorkerJob(job(fixture))).rejects.toMatchObject({
      code,
      phase,
    });
  });

  it.each([
    ["export default {run() {return 42}}", "SCENE_INVALID", "setup"],
    [
      'export default {run() {return () => {throw new Error("cleanup")}}}',
      "SCENE_FAILED",
      "cleanup",
    ],
    [
      'export default {run({space}) {space.add({start(){throw new Error("start")}})}}',
      "SCENE_FAILED",
      "setup",
    ],
    [
      'export default {run({space}) {space.add(() => {throw new Error("frame")})}}',
      "SCENE_FAILED",
      "frame",
    ],
    [
      'export default {run({space}) {space.add({action(){throw new Error("input")}})}}',
      "SCENE_FAILED",
      "input",
    ],
    [
      'throw new Error("import"); export default {run(){}}',
      "SCENE_FAILED",
      "load",
    ],
    [
      "export default {width: 20000, height: 1, run(){}}",
      "RESOURCE_LIMIT",
      "validate",
    ],
  ])("classifies lifecycle failures: %s", async (code, expectedCode, phase) => {
    const path = join(directory, "source.mjs");
    await writeFile(path, code);
    await expect(
      runWorkerJob(
        job("", {
          source: path,
          events: [{ at: 0, type: "move", x: 1, y: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: expectedCode, phase });
  });

  it.each([
    { maxMetadataBytes: 1 },
    { maxArtifactBytesTotal: 1 },
    { maxRasterPixelsPerOutput: 1 },
    { maxRasterPixelsTotal: 1 },
  ])("enforces export and metadata resource ceilings %j", async (limits) => {
    await expect(
      runWorkerJob(
        job("portable-card.mjs", {
          limits: { ...DEFAULT_RENDER_RESOURCE_LIMITS, ...limits },
        }),
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
  });

  it("retains the frame error when cleanup also fails", async () => {
    const path = join(directory, "source.mjs");
    await writeFile(
      path,
      'export default {run({space}) {space.add(() => {throw new Error("frame broke")}); return () => {throw new Error("cleanup broke")};}}',
    );
    await expect(runWorkerJob(job("", { source: path }))).rejects.toMatchObject(
      {
        code: "SCENE_FAILED",
        phase: "frame",
        details: { cleanupError: "cleanup broke" },
      },
    );
  });

  it("runs the classic loader with deterministic lifecycle", async () => {
    const result = await runWorkerJob(
      job("", {
        source: resolve("test/fixtures/classic/quick-start.js"),
        loader: "pts-demo",
        size: { width: 18, height: 12 },
        seed: "classic",
      }),
    );
    expect(result.loader).toBe("pts-demo");
    expect(result.metadata?.demoDescription).toBe("Classic quickStart fixture");
    expect(result.warnings[0]?.code).toBe("CLASSIC_DEMO_COMPATIBILITY");
  });

  it.each([
    "guide.image_load.js",
    "guide.image_load2.js",
    "guide.image_pattern.js",
  ])("loads and exports the release's %s", async (name) => {
    const result = await runWorkerJob(
      job("", {
        source: resolve("test/fixtures/pts-1.0.0/demo", name),
        loader: "pts-demo",
        size: { width: 64, height: 40 },
        assetRoot: new URL("./fixtures/pts-1.0.0/", import.meta.url).href,
        outputs: [
          {
            request: { format: "svg" },
            artifactPath: join(directory, "out.svg"),
          },
        ],
      }),
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "CLASSIC_IMAGE_BRIDGE",
    );
    expect(await readFile(join(directory, "out.svg"), "utf8")).toContain(
      "<image",
    );
  });
});
