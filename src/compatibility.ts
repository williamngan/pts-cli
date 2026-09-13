import { CanvasForm } from "pts";
import type { RenderingContext2D } from "pts";
import type { CanvasRenderingContext2D as NativeContext2D } from "skia-canvas";

import { SkiaCanvasError } from "./errors.js";

type CanvasFormConstructorHooks = typeof CanvasForm & {
  resetStyleCache?: (context: object) => void;
};

type CanvasFormPrototypeHooks = {
  _set?: (key: string, value: unknown) => void;
};

/**
 * Runtime bridge between two Canvas-compatible declarations.
 *
 * Pts uses DOM Canvas types while skia-canvas owns its Node implementation.
 * All context casts are kept in this module so callers never need one.
 */
export function toPtsContext(context: NativeContext2D): RenderingContext2D {
  return context as unknown as RenderingContext2D;
}

export function resetPtsStyleCache(context: object): void {
  const resetStyleCache = (CanvasForm as CanvasFormConstructorHooks)
    .resetStyleCache;
  const setStyle = (CanvasForm.prototype as unknown as CanvasFormPrototypeHooks)
    ._set;

  if (typeof resetStyleCache !== "function" || typeof setStyle !== "function") {
    throw new SkiaCanvasError(
      "INCOMPATIBLE_PTS",
      "pts-cli requires the Pts 1.x CanvasForm style-cache API; install pts@^1.0.0.",
    );
  }

  resetStyleCache.call(CanvasForm, context);
}
