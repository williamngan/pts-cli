import { CanvasForm } from "pts";
import type { RenderingContext2D } from "pts";
import type { CanvasRenderingContext2D as NativeContext2D } from "skia-canvas";

import { SkiaCanvasError } from "./errors.js";

type RevampCanvasFormConstructor = typeof CanvasForm & {
  resetStyleCache?: (context: object) => void;
};

type RevampCanvasFormPrototype = {
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
  const resetStyleCache = (CanvasForm as RevampCanvasFormConstructor)
    .resetStyleCache;
  const setStyle = (
    CanvasForm.prototype as unknown as RevampCanvasFormPrototype
  )._set;

  if (typeof resetStyleCache !== "function" || typeof setStyle !== "function") {
    throw new SkiaCanvasError(
      "INCOMPATIBLE_PTS",
      "pts-cli requires the Pts revamp CanvasForm API; the " +
        "npm-published pts@0.12.9 implementation is not compatible.",
    );
  }

  resetStyleCache.call(CanvasForm, context);
}
