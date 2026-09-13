import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isURLReference,
  prepareRenderRequest,
} from "../src/renderValidation.js";

const source = resolve("test/fixtures/scenes/portable-card.mjs");

describe("render request validation", () => {
  it.each([
    "C:\\project\\scene.mjs",
    "C:/project/scene.mjs",
    "D:scene.mjs",
    "\\\\server\\share\\scene.mjs",
    "./scene.mjs",
  ])("recognizes filesystem path %s", (path) => {
    expect(isURLReference(path)).toBe(false);
  });

  it.each([
    "file:///C:/project/scene.mjs",
    "https://example.com/assets/",
    "data:image/png;base64,AA==",
  ])("recognizes URL %s", (url) => {
    expect(isURLReference(url)).toBe(true);
  });

  it("resolves native absolute source, output, asset and font paths", async () => {
    const assetRoot = resolve("test/fixtures/assets");
    const font = resolve("test/fixtures/assets/font.ttf");
    const output = resolve("out/card.png");
    const request = await prepareRenderRequest(source, {
      assetRoot,
      fonts: [{ family: "Fixture", sources: [font] }],
      outputs: [{ path: output, format: "png" }],
    });
    expect(request.source).toBe(source);
    expect(request.assetRoot).toBe(pathToFileURL(assetRoot).href);
    expect(request.fonts[0]?.sources).toEqual([pathToFileURL(font).href]);
    expect(request.outputs[0]?.destination).toBe(output);
  });
  it("snapshots defaults, params, events, and canonical formats", async () => {
    const params = { radius: 10 };
    const request = await prepareRenderRequest(source, {
      params,
      render: { mode: "frame", frame: 2, fps: 20 },
      events: [
        { at: 50, type: "move", x: 4, y: 5 },
        { at: 0, type: "resize", width: 100, height: 80 },
      ],
      outputs: [{ format: "jpg", quality: 0.8 }],
    });
    params.radius = 99;

    expect(request.loader).toBe("scene");
    expect(request.renderer).toBe("cpu");
    expect(request.render).toEqual({
      mode: "frame",
      frame: 2,
      fps: 20,
      time: 100,
      framesInvoked: 3,
    });
    expect(request.events.map((event) => event.at)).toEqual([0, 50]);
    expect(request.params).toEqual({ radius: 10 });
    expect(request.outputs[0]?.request.format).toBe("jpeg");
  });

  it("rejects malformed timelines and format-specific options", async () => {
    await expect(
      prepareRenderRequest(source, {
        events: [{ at: 0, type: "keydown", x: 1, y: 2 } as never],
        outputs: [{ format: "png" }],
      }),
    ).rejects.toMatchObject({
      code: "CLI_USAGE",
      phase: "arguments",
    });

    await expect(
      prepareRenderRequest(source, {
        outputs: [{ format: "svg", quality: 0.5 } as never],
      }),
    ).rejects.toThrow(/quality is not supported/);
  });

  it("rejects duplicate destinations before scene execution", async () => {
    await expect(
      prepareRenderRequest(source, {
        outputs: [
          { path: "same.png", format: "png" },
          { path: "same.png", format: "png" },
        ],
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_TARGET_INVALID" });
  });

  it("enforces resource limits before starting a worker", async () => {
    await expect(
      prepareRenderRequest(source, {
        render: { mode: "frame", frame: 10 },
        limits: { maxFramesInvoked: 10 },
        outputs: [{ format: "png" }],
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });

    await expect(
      prepareRenderRequest(source, {
        size: { width: 11, height: 5 },
        limits: { maxWidth: 10 },
        outputs: [{ format: "png" }],
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });

    await expect(
      prepareRenderRequest(source, {
        events: [{ at: 0, type: "resize", width: 11, height: 5 }],
        limits: { maxWidth: 10 },
        outputs: [{ format: "png" }],
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });

    await expect(
      prepareRenderRequest(source, {
        events: [{ at: 0, type: "move", x: 1, y: 2 }],
        limits: { maxInputBytes: 1 },
        outputs: [{ format: "png" }],
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
  });

  it("rejects accessors and invalid signals without invoking scene options", async () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "outputs", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [{ format: "png" }];
      },
    });
    await expect(
      prepareRenderRequest(source, accessor as never),
    ).rejects.toMatchObject({ code: "CLI_USAGE" });
    expect(getterCalls).toBe(0);

    await expect(
      prepareRenderRequest(source, {
        signal: {} as AbortSignal,
        outputs: [{ format: "png" }],
      }),
    ).rejects.toMatchObject({ code: "CLI_USAGE" });
  });

  it("normalizes hostile option proxies into a usage error", async () => {
    const options = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("prototype trap");
        },
      },
    );

    await expect(
      prepareRenderRequest(source, options as never),
    ).rejects.toMatchObject({
      code: "CLI_USAGE",
      phase: "arguments",
      details: { reason: "prototype trap" },
    });
  });
});
