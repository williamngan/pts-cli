import { CanvasForm, Font } from "pts";
import type { CanvasSpace, Img, PtLike, PtLikeIterable } from "pts";
import type { CanvasRenderingContext2D as NativeContext2D } from "skia-canvas";

import { resetPtsStyleCache } from "./compatibility.js";
import { UnsupportedOperationError } from "./errors.js";
import { isLegacyImageCarrier, LEGACY_IMAGE_SOURCE } from "./legacyImage.js";
import type { SkiaCanvasSpace } from "./SkiaCanvasSpace.js";
import type {
  SkiaCanvasContext2D,
  SkiaCanvasImageData,
  SkiaCanvasImageSource,
} from "./types.js";

export function fontToSkiaValue(font: Font): string {
  const prefix = [font.style, font.weight].filter((part): part is string =>
    Boolean(part?.trim()),
  );
  const face = font.face?.trim() || "sans-serif";

  return [
    ...prefix,
    String(font.size) + "px/" + String(font.lineHeight),
    face,
  ].join(" ");
}

function characterWidthEstimator(
  measure: (value: string) => number,
): (value: string) => number {
  const widths = new Map<string, number>();

  return (value: string): number => {
    let total = 0;
    for (const character of value) {
      let width = widths.get(character);
      if (width === undefined) {
        width = measure(character);
        widths.set(character, width);
      }
      total += width;
    }
    return total;
  };
}

/**
 * A Pts CanvasForm bound to a skia-canvas context.
 *
 * The revamp CanvasForm generic is constrained to MultiTouchSpace even though
 * custom renderers may use the backend-neutral Space base class. The `any`
 * bridge is isolated here; the public space accessor is narrowed immediately.
 */
export class SkiaCanvasForm extends CanvasForm<any> {
  readonly #skiaSpace: SkiaCanvasSpace;
  readonly #nativeContext: NativeContext2D;
  #fontWidthEstimateMode: "sample" | "char" | undefined;

  constructor(space: SkiaCanvasSpace, context: SkiaCanvasContext2D) {
    // The context-free constructor is Pts' custom-renderer extension point. It
    // also lets us normalize the default font before Skia sees it.
    super();

    this.#skiaSpace = space;
    this.#nativeContext = context as unknown as NativeContext2D;

    this._space = space as unknown as CanvasSpace;
    this._ctx = context;
    this._ready = true;
    this.reset();
  }

  get skiaSpace(): SkiaCanvasSpace {
    return this.#skiaSpace;
  }

  override get space(): SkiaCanvasSpace {
    return this.#skiaSpace;
  }

  get skiaCtx(): SkiaCanvasContext2D {
    return this._ctx;
  }

  override reset(): this {
    resetPtsStyleCache(this.#nativeContext);

    this.#writeStyle("fillStyle", this._style.fillStyle ?? "#f03");
    this.#writeStyle("strokeStyle", this._style.strokeStyle ?? "#fff");
    this.#writeStyle("lineWidth", this._style.lineWidth ?? 1);
    this.#writeStyle("lineJoin", this._style.lineJoin ?? "bevel");
    this.#writeStyle("lineCap", this._style.lineCap ?? "butt");
    this.#writeStyle("globalAlpha", this._style.globalAlpha ?? 1);
    this.#writeStyle("font", fontToSkiaValue(this._font));

    return this;
  }

  override font(
    sizeOrFont: number | Font,
    weight?: string,
    style?: string,
    lineHeight?: number,
    family?: string,
  ): this {
    if (typeof sizeOrFont === "number") {
      this._font.size = sizeOrFont;
      if (family) this._font.face = family;
      if (weight) this._font.weight = weight;
      if (style) this._font.style = style;
      if (lineHeight) this._font.lineHeight = lineHeight;
    } else {
      this._font = sizeOrFont;
    }

    this.#writeStyle("font", fontToSkiaValue(this._font));

    if (this.#fontWidthEstimateMode) {
      this.fontWidthEstimate(this.#fontWidthEstimateMode);
    } else if (typeof this._estimateTextWidth === "function") {
      // Compatibility with the first revamp cache revision, before estimator
      // modes were tracked explicitly.
      this.fontWidthEstimate(true);
    }
    return this;
  }

  override fontWidthEstimate(
    estimate: boolean | "sample" | "char" = true,
  ): this {
    this.#fontWidthEstimateMode = estimate
      ? estimate === true
        ? "sample"
        : estimate
      : undefined;

    // The latest revamp accepts the named modes. The boolean assertion keeps
    // this source buildable at the earliest reviewed revamp commit too; it does
    // not change the runtime value passed to Pts.
    super.fontWidthEstimate(estimate as boolean);

    const revampState = this as unknown as {
      _estimateMode?: "sample" | "char";
    };
    if (estimate === "char" && revampState._estimateMode !== "char") {
      // The first pushed revamp cache commit predates named estimator modes.
      // Match the latest revamp behavior until the locked baseline advances.
      this._estimateTextWidth = characterWidthEstimator(
        (value) => this._ctx.measureText(value).width,
      );
    }

    return this;
  }

  override image(
    ptOrRect: PtLike | PtLikeIterable,
    image: CanvasImageSource | Img | SkiaCanvasImageSource,
    original?: PtLikeIterable,
  ): this {
    const isLegacy = isLegacyImageCarrier(image);
    const legacySource = isLegacy ? image[LEGACY_IMAGE_SOURCE] : undefined;
    if (isLegacy && legacySource === undefined) return this;
    CanvasForm.image(
      this._ctx,
      ptOrRect,
      (legacySource ?? image) as CanvasImageSource | Img,
      original,
    );
    return this;
  }

  override imageData(
    ptOrRect: PtLike | PtLikeIterable,
    image: ImageData | SkiaCanvasImageData,
  ): this {
    CanvasForm.imageData(this._ctx, ptOrRect, image as ImageData);
    return this;
  }

  override useOffscreen(
    _off: boolean = true,
    _clear: boolean | string = false,
  ): this {
    throw new UnsupportedOperationError(
      "SkiaCanvasForm.useOffscreen()",
      "Use a second skia-canvas Canvas and draw it as an image.",
    );
  }

  override renderOffscreen(_offset?: PtLike): never {
    throw new UnsupportedOperationError(
      "SkiaCanvasForm.renderOffscreen()",
      "Use a second skia-canvas Canvas and draw it as an image.",
    );
  }

  #writeStyle(key: string, value: unknown): void {
    this._set(key, value);
  }
}
