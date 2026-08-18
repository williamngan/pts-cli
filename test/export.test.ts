import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type RasterFormat,
  SkiaCanvasError,
  SkiaCanvasSpace,
} from "../src/index.js";
import { pixelAt, pngDimensions } from "./helpers/pixels.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "skia-pts-canvas-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("raster export", () => {
  it("exports PNG, JPEG, WebP, raw pixels, and data URLs", async () => {
    const space = new SkiaCanvasSpace(6, 4, {
      background: "#ff0000",
    });

    const [png, jpeg, webp, raw, url] = await Promise.all([
      space.toBuffer("png"),
      space.toBuffer("jpeg", { quality: 0.8 }),
      space.toBuffer("webp", { quality: 0.8 }),
      space.toBuffer("raw"),
      space.toURL("png"),
    ]);

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([...jpeg.subarray(0, 2)]).toEqual([255, 216]);
    expect(webp.subarray(0, 4).toString()).toBe("RIFF");
    expect(webp.subarray(8, 12).toString()).toBe("WEBP");
    expect(raw).toHaveLength(6 * 4 * 4);
    expect(pixelAt(raw, 6, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(space.isExporting).toBe(false);
  });

  it("uses density without changing logical dimensions", async () => {
    const space = new SkiaCanvasSpace(7, 5, {
      background: "#ffffff",
    });
    const png = await space.toBuffer("png", { density: 2 });

    expect(pngDimensions(png)).toEqual([14, 10]);
    expect(space.size.toArray()).toEqual([7, 5]);
  });

  it("does not invoke players during repeated exports", async () => {
    const space = new SkiaCanvasSpace(10, 10);
    let count = 0;
    space.add(() => {
      count += 1;
    });

    space.renderFrame();
    await space.toBuffer("png");
    await space.toBuffer("webp");
    await space.toURL("jpeg", { quality: 0.9 });

    expect(count).toBe(1);
  });

  it("blocks adapter canvas mutations while exports are pending", async () => {
    const space = new SkiaCanvasSpace(512, 512, {
      background: "#abcdef",
    });
    const pending = space.toBuffer("png", { density: 2 });

    expect(space.isExporting).toBe(true);
    expect(() => space.clear()).toThrowError(
      expect.objectContaining({ code: "EXPORT_IN_PROGRESS" }),
    );
    expect(() => space.renderFrame()).toThrow(SkiaCanvasError);
    expect(() => space.resize(10, 10)).toThrow(/export is pending/);
    expect(() => space.dispose()).toThrow(/export is pending/);

    await pending;
    expect(space.isExporting).toBe(false);
    expect(() => space.clear()).not.toThrow();
  });

  it("writes files by extension or explicit format", async () => {
    const directory = await temporaryDirectory();
    const space = new SkiaCanvasSpace(4, 3, {
      background: "#010203",
    });
    const pngPath = join(directory, "scene.png");
    const ambiguousPath = join(directory, "scene.bin");

    await space.toFile(pngPath);
    await space.toFile(ambiguousPath, { format: "webp" });

    const png = await readFile(pngPath);
    const webp = await readFile(ambiguousPath);
    expect(pngDimensions(png)).toEqual([4, 3]);
    expect(webp.subarray(8, 12).toString()).toBe("WEBP");
  });

  it("validates output formats and options", async () => {
    const space = new SkiaCanvasSpace();

    await expect(space.toBuffer("svg" as RasterFormat)).rejects.toThrow(
      /deferred/,
    );
    await expect(space.toBuffer("pdf" as RasterFormat)).rejects.toThrow(
      /deferred/,
    );
    await expect(space.toBuffer("png", { density: 1.5 })).rejects.toThrow(
      /density/,
    );
    await expect(space.toBuffer("png", { quality: 0.5 })).rejects.toThrow(
      /JPEG and WebP/,
    );
    await expect(space.toBuffer("webp", { quality: 2 })).rejects.toThrow(
      /between 0 and 1/,
    );
    await expect(space.toFile("scene.png", { format: "jpeg" })).rejects.toThrow(
      /conflicts/,
    );
    await expect(space.toFile("scene.unknown")).rejects.toThrow(
      /provide options.format/,
    );
    await expect(space.toURL("raw" as "png")).rejects.toThrow(/Raw pixels/);
  });
});
