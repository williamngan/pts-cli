import { CanvasForm, Font, Pt } from "pts";
import { Canvas, ImageData as NativeImageData } from "skia-canvas";
import { describe, expect, it, vi } from "vitest";

import {
  fontToSkiaValue,
  SkiaCanvasError,
  SkiaCanvasForm,
  SkiaCanvasSpace,
  UnsupportedOperationError,
} from "../src/index.js";
import { resetPtsStyleCache } from "../src/compatibility.js";
import { pixelAt } from "./helpers/pixels.js";

describe("SkiaCanvasForm", () => {
  it("fails clearly when the required revamp form hooks are absent", () => {
    const constructor = CanvasForm as unknown as {
      resetStyleCache: ((context: object) => void) | undefined;
    };
    const prototype = CanvasForm.prototype as unknown as {
      _set: ((key: string, value: unknown) => void) | undefined;
    };
    const resetStyleCache = constructor.resetStyleCache;
    const setStyle = prototype._set;

    const expectCompatibilityError = () => {
      expect(() => resetPtsStyleCache({})).toThrowError(
        expect.objectContaining<Partial<SkiaCanvasError>>({
          code: "INCOMPATIBLE_PTS",
        }),
      );
    };

    try {
      constructor.resetStyleCache = undefined;
      expectCompatibilityError();
      constructor.resetStyleCache = resetStyleCache;

      prototype._set = undefined;
      expectCompatibilityError();
    } finally {
      constructor.resetStyleCache = resetStyleCache;
      prototype._set = setStyle;
    }
  });

  it("binds a Pts form to the Node space", () => {
    const space = new SkiaCanvasSpace();
    const form = space.getForm();

    expect(form).toBeInstanceOf(SkiaCanvasForm);
    expect(form.ready).toBe(true);
    expect(form.skiaSpace).toBe(space);
    expect(form.space as unknown).toBe(space);
    expect(form.skiaCtx).toBe(space.skiaCtx);
  });

  it("normalizes Pts font fields without leading empty tokens", () => {
    expect(fontToSkiaValue(new Font(14, "sans-serif"))).toBe(
      "14px/1.5 sans-serif",
    );
    expect(
      fontToSkiaValue(
        new Font(18, '"Example Font", sans-serif', "bold", "italic", 1.2),
      ),
    ).toBe('italic bold 18px/1.2 "Example Font", sans-serif');
  });

  it("applies default and custom fonts accepted by Skia", () => {
    const space = new SkiaCanvasSpace();
    const form = space.getForm();

    expect(form.skiaCtx.font).toContain("14px");
    form.font(20, "bold", "italic", 1.25, "sans-serif");

    expect(form.currentFont.size).toBe(20);
    expect(form.currentFont.weight).toBe("bold");
    expect(form.currentFont.style).toBe("italic");
    expect(form.skiaCtx.font).toContain("20px");
    expect(form.skiaCtx.font).not.toBe("10px sans-serif");
  });

  it("preserves the revamp text-width estimator mode across font changes", () => {
    const estimator = vi.spyOn(CanvasForm.prototype, "fontWidthEstimate");
    const form = new SkiaCanvasSpace().getForm();

    try {
      form.fontWidthEstimate("char");
      form.font(20, "bold");

      expect(estimator).toHaveBeenLastCalledWith("char");
      const text = "iiiiWW😀";
      const expected = Array.from(text).reduce(
        (width, character) => width + form.skiaCtx.measureText(character).width,
        0,
      );
      expect(form.getTextWidth(text)).toBeCloseTo(expected);
    } finally {
      estimator.mockRestore();
    }
  });

  it("renders Pts primitives, gradients, and text", async () => {
    const space = new SkiaCanvasSpace(60, 30);
    const form = space.getForm();

    space.add(() => {
      const gradient = form.gradient(["#ff0000", "#0000ff"]);
      form.fillOnly(gradient([new Pt(0, 0), new Pt(30, 0)])).rect([
        [0, 0],
        [30, 30],
      ]);
      form
        .fillOnly("#00ff00")
        .circle([
          [45, 15],
          [7, 7],
        ])
        .fillOnly("#ffffff")
        .font(10, "bold")
        .text([2, 13], "Pts");
    });

    space.renderFrame();
    const raw = await space.toBuffer("raw");

    expect(pixelAt(raw, 60, 1, 25)[3]).toBe(255);
    expect(pixelAt(raw, 60, 45, 15)).toEqual([0, 255, 0, 255]);

    let textPixels = 0;
    for (let y = 2; y < 15; y += 1) {
      for (let x = 2; x < 22; x += 1) {
        const [red, green, blue] = pixelAt(raw, 60, x, y);
        if (red > 200 && green > 200 && blue > 200) textPixels += 1;
      }
    }
    expect(textPixels).toBeGreaterThan(0);
  });

  it("keeps shared revamp style caching coherent across multiple forms", async () => {
    const space = new SkiaCanvasSpace(9, 3);
    const first = space.getForm();
    const second = space.getForm();

    space.add(() => {
      first.fillOnly("#ff0000").point([1, 1], 1, "square");
      second.fillOnly("#00ff00").point([4, 1], 1, "square");
      first.fillOnly("#ff0000").point([7, 1], 1, "square");
    });

    space.renderFrame();
    const raw = await space.toBuffer("raw");

    expect(pixelAt(raw, 9, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(raw, 9, 4, 1)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(raw, 9, 7, 1)).toEqual([255, 0, 0, 255]);
  });

  it("renders line, polygon, ellipse, arc, and dash expressions", async () => {
    const space = new SkiaCanvasSpace(80, 40);
    const form = space.getForm();

    space.add(() => {
      form
        .strokeOnly("#ff0000", 3)
        .line([new Pt(2, 5), new Pt(30, 5)])
        .fillOnly("#00ff00")
        .ellipse([15, 22], [7, 5])
        .fillOnly("#0000ff")
        .polygon([new Pt(34, 30), new Pt(44, 12), new Pt(54, 30)])
        .strokeOnly("#ffff00", 3)
        .arc([65, 20], 8, 0, Math.PI * 2)
        .dash([4, 4])
        .line([new Pt(2, 36), new Pt(30, 36)])
        .dash(false);
    });

    space.renderFrame();
    const raw = await space.toBuffer("raw");

    expect(pixelAt(raw, 80, 10, 5)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(raw, 80, 15, 22)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(raw, 80, 44, 22)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(raw, 80, 73, 20)).toEqual([255, 255, 0, 255]);
    expect(pixelAt(raw, 80, 4, 36)).toEqual([255, 255, 0, 255]);
  });

  it("draws a skia-canvas Canvas image through CanvasForm coordinates", async () => {
    const source = new Canvas(4, 4);
    const sourceContext = source.getContext("2d");
    sourceContext.fillStyle = "#00ff00";
    sourceContext.fillRect(0, 0, 4, 4);

    const space = new SkiaCanvasSpace(10, 10);
    const form = space.getForm();
    space.add(() => form.image([3, 2], source));
    space.renderFrame();

    const raw = await space.toBuffer("raw");
    expect(pixelAt(raw, 10, 3, 2)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(raw, 10, 6, 5)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(raw, 10, 2, 2)[3]).toBe(0);
  });

  it("draws native ImageData", async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const image = new NativeImageData(pixels, 2, 1);
    const space = new SkiaCanvasSpace(5, 3);
    const form = space.getForm();

    space.add(() => form.imageData([1, 1], image));
    space.renderFrame();

    const raw = await space.toBuffer("raw");
    expect(pixelAt(raw, 5, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(raw, 5, 2, 1)).toEqual([0, 0, 255, 255]);
  });

  it("fails clearly for browser-only offscreen methods", () => {
    const form = new SkiaCanvasSpace().getForm();

    expect(() => form.useOffscreen()).toThrow(UnsupportedOperationError);
    expect(() => form.renderOffscreen()).toThrow(/second skia-canvas Canvas/);
  });
});
