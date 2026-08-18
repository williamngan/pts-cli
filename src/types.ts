import type { RenderingContext2D } from "pts";

export type RasterFormat = "png" | "jpg" | "jpeg" | "webp" | "raw";
export type EncodedRasterFormat = Exclude<RasterFormat, "raw">;

export interface RasterExportOptions {
  /**
   * Number of output pixels per logical canvas unit. Must be a positive
   * integer. Defaults to 1.
   */
  density?: number;

  /** Background drawn beneath transparent pixels during export. */
  matte?: string;

  /** Lossy encoding quality from 0 through 1 (JPEG and WebP only). */
  quality?: number;

  /** Multisample anti-aliasing setting delegated to skia-canvas. */
  msaa?: number | boolean;

  /** Enable JPEG 4:2:0 chroma subsampling. */
  downsample?: boolean;
}

export interface RasterFileOptions extends RasterExportOptions {
  /** Explicit output format. Required when the filename has no known suffix. */
  format?: RasterFormat;
}

export interface SkiaCanvasSpaceOptions {
  /** Color used by clear and before the first export. Defaults to transparent. */
  background?: string;

  /** Optional Pts space identifier. */
  id?: string;

  /** Clear before each frame. Defaults to true. */
  refresh?: boolean;
}

export interface RenderFrameOptions {
  /** Explicit frame delta in milliseconds. Otherwise derived from time. */
  delta?: number;

  /** Override refresh for this frame without changing the persistent setting. */
  clear?: boolean;
}

/**
 * The standard Canvas 2D surface used by Pts. skia-canvas implements this
 * surface at runtime. The adapter keeps the alias independent of
 * skia-canvas's optional Sharp declarations.
 */
export type SkiaCanvasContext2D = RenderingContext2D;

/**
 * Narrow, dependency-safe view of the owned skia-canvas Canvas.
 *
 * It intentionally includes the native operations needed by this adapter.
 * Consumers that need Skia-specific experimental APIs can cast this handle to
 * skia-canvas's Canvas type after installing that package's optional types.
 */
export interface SkiaCanvas {
  width: number;
  height: number;
  getContext(type?: "2d"): SkiaCanvasContext2D;
  toBuffer(
    format: RasterFormat,
    options?: RasterExportOptions,
  ): Promise<Buffer>;
  toFile(filename: string, options?: RasterFileOptions): Promise<void>;
  toURL(
    format: EncodedRasterFormat,
    options?: RasterExportOptions,
  ): Promise<string>;
}

/**
 * Structural image source accepted by skia-canvas drawImage.
 * Canvas, Image, and ImageData instances from skia-canvas satisfy this shape.
 */
export interface SkiaCanvasImageSource {
  readonly width: number;
  readonly height: number;
}

/** Structural ImageData source accepted by skia-canvas putImageData. */
export interface SkiaCanvasImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}
