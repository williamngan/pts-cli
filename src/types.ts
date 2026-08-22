import type { PtLike, RenderingContext2D } from "pts";

export type RasterFormat = "png" | "jpg" | "jpeg" | "webp" | "raw";
export type EncodedRasterFormat = Exclude<RasterFormat, "raw">;
export type VectorFormat = "svg";
export type OutputFormat = RasterFormat | VectorFormat;
export type DataURLFormat = EncodedRasterFormat | VectorFormat;

export type RendererPreference = "cpu" | "auto" | "gpu";
export type RendererKind = "cpu" | "gpu";

export interface CanvasAllocationLimits {
  /** Maximum logical width accepted before native canvas allocation. */
  maxWidth?: number;

  /** Maximum logical height accepted before native canvas allocation. */
  maxHeight?: number;

  /** Maximum width multiplied by height accepted before allocation. */
  maxLogicalPixels?: number;
}

export interface RendererInfo {
  readonly requested: RendererPreference;
  readonly renderer: RendererKind;
  readonly api?: string;
  readonly device?: string;
  readonly driver?: string;
  readonly threads?: number;
  readonly error?: string;
}

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

export interface SvgExportOptions {
  /** Convert text glyphs to vector paths. Defaults to false. */
  outline?: boolean;
}

export interface SvgFileOptions extends SvgExportOptions {
  /** Explicit output format. Required when the filename has no known suffix. */
  format?: "svg";
}

export type OutputFileOptions = RasterFileOptions | SvgFileOptions;

export interface SkiaCanvasSpaceOptions {
  /** Color used by clear and before the first export. Defaults to transparent. */
  background?: string;

  /** Optional Pts space identifier. */
  id?: string;

  /** Clear before each frame. Defaults to true. */
  refresh?: boolean;

  /** Native renderer policy. CPU is the deterministic default. */
  renderer?: RendererPreference;

  /** Optional allocation ceilings checked before constructing Skia. */
  limits?: CanvasAllocationLimits;
}

export interface RenderFrameOptions {
  /** Explicit frame delta in milliseconds. Otherwise derived from time. */
  delta?: number;

  /** Override refresh for this frame without changing the persistent setting. */
  clear?: boolean;
}

export interface SyntheticPointerEventInit {
  /** Event timestamp in milliseconds. Defaults to 0. */
  timeStamp?: number;
  button?: number;
  buttons?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isPrimary?: boolean;
}

/**
 * Minimal, deterministic event object supplied to synthetic action callbacks.
 * It is intentionally not advertised as a DOM MouseEvent or PointerEvent.
 */
export interface SyntheticPointerEvent {
  readonly type: string;
  readonly timeStamp: number;
  readonly x: number;
  readonly y: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly button: number;
  readonly buttons: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly pointerType: "synthetic";
  readonly isPrimary: boolean;
  readonly defaultPrevented: boolean;
  readonly propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export type SyntheticActionPoint = PtLike | readonly number[];

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
  readonly gpu: boolean;
  readonly engine: {
    readonly renderer: "CPU" | "GPU";
    readonly api?: string;
    readonly device?: string;
    readonly driver?: string;
    readonly threads?: number;
    readonly error?: string;
  };
  getContext(type?: "2d"): SkiaCanvasContext2D;
  toBuffer(format: "svg", options?: SvgExportOptions): Promise<Buffer>;
  toBuffer(
    format?: RasterFormat,
    options?: RasterExportOptions,
  ): Promise<Buffer>;
  toFile(filename: string, options?: OutputFileOptions): Promise<void>;
  toURL(format: "svg", options?: SvgExportOptions): Promise<string>;
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
