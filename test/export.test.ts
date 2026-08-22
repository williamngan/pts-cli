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

describe("canvas export", () => {
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
    const svgPath = join(directory, "scene.svg");
    const ambiguousPath = join(directory, "scene.bin");

    await space.toFile(pngPath);
    await space.toFile(svgPath, { outline: false });
    await space.toFile(ambiguousPath, { format: "webp" });

    const png = await readFile(pngPath);
    const svg = await readFile(svgPath, "utf8");
    const webp = await readFile(ambiguousPath);
    expect(pngDimensions(png)).toEqual([4, 3]);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="4" height="3"');
    expect(webp.subarray(8, 12).toString()).toBe("WEBP");
  });

  it("exports vector geometry and both SVG text modes", async () => {
    const space = new SkiaCanvasSpace(80, 40);
    const form = space.getForm();
    space.add(() => {
      form
        .fillOnly("#ff0000")
        .rect([
          [2, 2],
          [20, 20],
        ])
        .fillOnly("#111111")
        .font(12, "bold")
        .text([25, 18], "Pts SVG");
    });
    space.renderFrame();

    const [preserved, outlined, url] = await Promise.all([
      space.toBuffer("svg", { outline: false }),
      space.toBuffer("svg", { outline: true }),
      space.toURL("svg", { outline: false }),
    ]);
    const preservedText = preserved.toString("utf8");
    const outlinedText = outlined.toString("utf8");

    expect(preservedText).toContain('width="80" height="40"');
    expect(preservedText).toContain("Pts SVG");
    expect(preservedText).toMatch(/<(path|rect)\b/);
    expect(outlinedText).not.toContain("Pts SVG");
    expect(outlinedText).toContain("<path");
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("exports the same retained scene independent of output order", async () => {
    const space = new SkiaCanvasSpace(12, 8, { background: "#abcdef" });
    const firstPng = await space.toBuffer("png");
    const firstSvg = await space.toBuffer("svg");
    const secondSvg = await space.toBuffer("svg");
    const secondPng = await space.toBuffer("png");

    expect(secondPng).toEqual(firstPng);
    expect(secondSvg).toEqual(firstSvg);
  });

  it("validates output formats and options", async () => {
    const space = new SkiaCanvasSpace();

    await expect(space.toBuffer("pdf" as RasterFormat)).rejects.toThrow(
      /not supported/,
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
    await expect(
      space.toBuffer("svg", { quality: 0.5 } as { outline?: boolean }),
    ).rejects.toThrow(/not valid/);
    await expect(
      space.toBuffer("png", { outline: true } as { density?: number }),
    ).rejects.toThrow(/not valid/);
    await expect(space.toURL("raw" as "png")).rejects.toThrow(/Raw pixels/);
  });
});
