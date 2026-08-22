import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { PtsSceneAssets } from "../src/scene.js";
import { executeClassicDemo, loadClassicDemo } from "../src/classicDemo.js";
import {
  beginRunnerInitialization,
  finishRunnerInitialization,
  SkiaCanvasSpace,
} from "../src/SkiaCanvasSpace.js";
import { pixelAt } from "./helpers/pixels.js";

const unusedAssets: PtsSceneAssets = {
  resolve(specifier) {
    return new URL(String(specifier), "file:///unused/");
  },
  image() {
    return Promise.reject(new Error("Images are not used by this fixture"));
  },
  font() {
    return Promise.reject(new Error("Fonts are not used by this fixture"));
  },
};

async function executeFixture(name: string): Promise<{
  readonly execution: Awaited<ReturnType<typeof executeClassicDemo>>;
  readonly space: SkiaCanvasSpace;
}> {
  const source = resolve("test/fixtures/classic", name);
  const loaded = await loadClassicDemo(source);
  const space = new SkiaCanvasSpace(18, 12);
  beginRunnerInitialization(space);
  const execution = await executeClassicDemo(loaded, {
    space,
    form: space.getForm(),
    assets: unusedAssets,
    assetRootProvided: false,
    backgroundOverridden: false,
    seed: "fixture",
  });
  finishRunnerInitialization(space);
  execution.invokeReadyCallbacks();
  space.renderFrame(0);
  return { execution, space };
}

describe("classic Pts demo compatibility", () => {
  it("loads without evaluation, then maps quickStart lifecycle and metadata", async () => {
    const loaded = await loadClassicDemo(
      resolve("test/fixtures/classic/quick-start.js"),
    );
    expect(loaded.source).toMatch(/quick-start\.js$/);

    const space = new SkiaCanvasSpace(18, 12, { background: "#ffffff" });
    expect(space.background).toBe("#ffffff");
    beginRunnerInitialization(space);
    const execution = await executeClassicDemo(loaded, {
      space,
      form: space.getForm(),
      assets: unusedAssets,
      assetRootProvided: false,
      backgroundOverridden: false,
    });
    expect(space.background).toBe("#112233");
    expect(execution.metadata).toEqual({
      demoDescription: "Classic quickStart fixture",
    });

    finishRunnerInitialization(space);
    execution.invokeReadyCallbacks();
    space.renderFrame(0);
    const raw = await space.toBuffer("raw");
    expect(pixelAt(raw, 18, 4, 4)).toEqual([0, 255, 0, 255]);
    space.dispose();
  });

  it("supports direct CanvasSpace construction and ready ordering", async () => {
    const { execution, space } = await executeFixture("advanced-space.js");
    const raw = await space.toBuffer("raw");

    expect(execution.metadata).toEqual({
      demoDescription: "Classic advanced CanvasSpace fixture",
    });
    expect(pixelAt(raw, 18, 4, 4)).toEqual([0, 0, 255, 255]);
    space.dispose();
  });

  it("awaits an async IIFE completion value before initialization", async () => {
    const { space } = await executeFixture("async-completion.js");
    const raw = await space.toBuffer("raw");

    expect(pixelAt(raw, 18, 4, 4)).toEqual([255, 255, 0, 255]);
    space.dispose();
  });

  it("fails browser-only APIs with a stable compatibility code", async () => {
    const source = resolve("test/fixtures/classic/unsupported-svg.js");
    const loaded = await loadClassicDemo(source);
    const space = new SkiaCanvasSpace(18, 12);
    beginRunnerInitialization(space);

    await expect(
      executeClassicDemo(loaded, {
        space,
        form: space.getForm(),
        assets: unusedAssets,
        assetRootProvided: false,
        backgroundOverridden: false,
      }),
    ).rejects.toMatchObject({
      code: "COMPAT_API_UNSUPPORTED",
      phase: "setup",
    });
    space.dispose();
  });
});
