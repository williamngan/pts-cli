import { extname } from "node:path";

import {
  Bound,
  Pt,
  Space,
  type AnimateCallbackFn,
  type IPlayer,
  type RenderingContext2D,
} from "pts";
import {
  Canvas as NativeCanvas,
  type CanvasRenderingContext2D as NativeContext2D,
  type ExportOptions as NativeExportOptions,
  type SaveOptions as NativeSaveOptions,
} from "skia-canvas";

import { resetPtsStyleCache, toPtsContext } from "./compatibility.js";
import { SkiaCanvasError, UnsupportedOperationError } from "./errors.js";
import { SkiaCanvasForm } from "./SkiaCanvasForm.js";
import type {
  EncodedRasterFormat,
  RasterExportOptions,
  RasterFileOptions,
  RasterFormat,
  RenderFrameOptions,
  SkiaCanvas,
  SkiaCanvasContext2D,
  SkiaCanvasSpaceOptions,
} from "./types.js";

let nextSpaceId = 0;

const rasterFormats = new Set<RasterFormat>([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "raw",
]);

function assertDimension(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(name + " must be a positive finite integer");
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(name + " must be a finite number");
  }
}

function normalizeFormat(value: unknown): RasterFormat {
  if (typeof value !== "string") {
    throw new TypeError("Raster format must be a string");
  }

  const format = value.toLowerCase() as RasterFormat;
  if (!rasterFormats.has(format)) {
    throw new RangeError(
      'Unsupported raster format "' +
        value +
        '". Use png, jpeg, webp, or raw; SVG and PDF are deferred.',
    );
  }

  return format;
}

function canonicalFormat(format: RasterFormat): Exclude<RasterFormat, "jpg"> {
  return format === "jpg" ? "jpeg" : format;
}

function formatFromFilename(filename: string): RasterFormat | undefined {
  const extension = extname(filename).slice(1).toLowerCase();
  if (!extension) return undefined;
  if (rasterFormats.has(extension as RasterFormat)) {
    return extension as RasterFormat;
  }
  if (extension === "svg" || extension === "pdf") {
    return normalizeFormat(extension);
  }
  return undefined;
}

function validateExportOptions(
  format: RasterFormat,
  options: RasterExportOptions,
): void {
  const canonical = canonicalFormat(format);

  if (options.density !== undefined) {
    if (
      !Number.isFinite(options.density) ||
      !Number.isInteger(options.density) ||
      options.density < 1
    ) {
      throw new RangeError("density must be a positive finite integer");
    }
  }

  if (options.quality !== undefined) {
    if (
      !Number.isFinite(options.quality) ||
      options.quality < 0 ||
      options.quality > 1
    ) {
      throw new RangeError("quality must be between 0 and 1");
    }

    if (canonical !== "jpeg" && canonical !== "webp") {
      throw new RangeError("quality is supported only for JPEG and WebP");
    }
  }

  if (options.downsample !== undefined && canonical !== "jpeg") {
    throw new RangeError("downsample is supported only for JPEG");
  }

  if (
    typeof options.msaa === "number" &&
    (!Number.isFinite(options.msaa) ||
      !Number.isInteger(options.msaa) ||
      options.msaa < 1)
  ) {
    throw new RangeError("numeric msaa must be a positive finite integer");
  }
}

function toNativeExportOptions(
  options: RasterExportOptions,
): NativeExportOptions {
  return { ...options };
}

export class SkiaCanvasSpace extends Space {
  readonly #canvas: NativeCanvas;
  readonly #nativeContext: NativeContext2D;
  readonly #forms = new Set<SkiaCanvasForm>();

  #background: string;
  #disposed = false;
  #exportCount = 0;
  #hasRendered = false;
  #refreshEnabled: boolean;
  #rendering = false;

  constructor(width = 300, height = 150, options: SkiaCanvasSpaceOptions = {}) {
    super();

    assertDimension(width, "width");
    assertDimension(height, "height");

    this.id = options.id || "skia_canvas_" + String(nextSpaceId++);
    this.#background = options.background ?? "transparent";
    this.#refreshEnabled = options.refresh ?? true;

    this.#canvas = new NativeCanvas(width, height);
    this.#nativeContext = this.#canvas.getContext("2d");
    this._ctx = toPtsContext(this.#nativeContext);
    this.bound = new Bound(new Pt(0, 0), new Pt(width, height));
    this._pointer = this.center;
    this._isReady = true;

    this.#clearUnsafe();
  }

  get canvas(): SkiaCanvas {
    return this.#canvas as unknown as SkiaCanvas;
  }

  get skiaCtx(): SkiaCanvasContext2D {
    return this._ctx as RenderingContext2D;
  }

  get ctx(): SkiaCanvasContext2D {
    return this.skiaCtx;
  }

  get pointer(): Pt {
    return this._pointer.clone();
  }

  get ready(): boolean {
    return this._isReady && !this.#disposed;
  }

  get isExporting(): boolean {
    return this.#exportCount > 0;
  }

  get background(): string {
    return this.#background;
  }

  set background(value: string) {
    this.#assertUsable();
    this.#background = value;
  }

  override refresh(enabled: boolean): this {
    this.#assertUsable();
    this.#refreshEnabled = enabled;
    return this;
  }

  override add(player: IPlayer | AnimateCallbackFn): this {
    this.#assertUsable();

    const before = new Map(
      Object.entries(this.players).map(([key, value]) => [key, value]),
    );

    super.add(player);

    for (const [key, value] of Object.entries(this.players)) {
      if (before.get(key) !== value) {
        value.start?.(this.bound.clone(), this);
      }
    }

    return this;
  }

  override remove(player: IPlayer): this {
    this.#assertUsable();
    return super.remove(player);
  }

  override removeAll(): this {
    this.#assertUsable();
    return super.removeAll();
  }

  override getForm(): SkiaCanvasForm {
    this.#assertUsable();
    const form = new SkiaCanvasForm(this, toPtsContext(this.#nativeContext));
    this.#forms.add(form);
    return form;
  }

  renderFrame(time = 0, options: RenderFrameOptions = {}): this {
    this.#assertCanvasMutationAllowed("render a frame");
    assertFinite(time, "time");

    if (options.delta !== undefined) {
      assertFinite(options.delta, "delta");
    }

    if (this.#rendering) {
      throw new SkiaCanvasError(
        "FRAME_IN_PROGRESS",
        "renderFrame() is not reentrant",
      );
    }

    const previousTime = this._time.prev;
    const previousDelta = this._time.diff;
    const previousHasRendered = this.#hasRendered;
    const delta =
      options.delta ?? (this.#hasRendered ? time - this._time.prev : 0);

    this._time.prev = time;
    this._time.diff = delta;
    this.#rendering = true;
    this._playing = true;

    let saved = false;
    let completed = false;

    try {
      this.#nativeContext.save();
      saved = true;

      if (options.clear ?? this.#refreshEnabled) this.#clearUnsafe();

      const playerKeys = Object.keys(this.players);
      for (const key of playerKeys) {
        this.players[key]?.animate?.(time, delta, this);
      }

      if (saved) {
        this.#nativeContext.restore();
        saved = false;
        resetPtsStyleCache(this.#nativeContext);
      }

      this.render(this.#nativeContext);
      this.#hasRendered = true;
      completed = true;
      return this;
    } finally {
      if (saved) {
        this.#nativeContext.restore();
        resetPtsStyleCache(this.#nativeContext);
      }

      if (!completed) {
        this._time.prev = previousTime;
        this._time.diff = previousDelta;
        this.#hasRendered = previousHasRendered;
      }

      this._playing = false;
      this.#rendering = false;
    }
  }

  override clear(background?: string): this {
    this.#assertCanvasMutationAllowed("clear the canvas", true);

    if (background !== undefined) this.#background = background;
    this.#clearUnsafe();
    return this;
  }

  override resize(bound: Bound, event?: Event): this;
  resize(width: number, height: number): this;
  override resize(
    boundOrWidth: Bound | number,
    heightOrEvent?: number | Event,
  ): this {
    this.#assertCanvasMutationAllowed("resize the canvas");

    let nextBound: Bound;
    let event: Event | undefined;

    if (typeof boundOrWidth === "number") {
      if (typeof heightOrEvent !== "number") {
        throw new TypeError("resize(width, height) requires a numeric height");
      }

      assertDimension(boundOrWidth, "width");
      assertDimension(heightOrEvent, "height");
      nextBound = new Bound(new Pt(0, 0), new Pt(boundOrWidth, heightOrEvent));
    } else {
      assertDimension(boundOrWidth.width, "bound width");
      assertDimension(boundOrWidth.height, "bound height");
      nextBound = boundOrWidth.clone();
      event = typeof heightOrEvent === "object" ? heightOrEvent : undefined;
    }

    this.#canvas.width = nextBound.width;
    this.#canvas.height = nextBound.height;
    this.bound = nextBound;
    this._ctx = toPtsContext(this.#nativeContext);
    this._pointer = this.center;

    resetPtsStyleCache(this.#nativeContext);
    for (const form of this.#forms) form.reset();
    this.#clearUnsafe();

    for (const key of Object.keys(this.players)) {
      this.players[key]?.resize?.(this.bound.clone(), event);
    }

    return this;
  }

  async toBuffer(
    format: RasterFormat = "png",
    options: RasterExportOptions = {},
  ): Promise<Buffer> {
    const normalized = normalizeFormat(format);
    validateExportOptions(normalized, options);

    return this.#export(() =>
      this.#canvas.toBuffer(normalized, toNativeExportOptions(options)),
    );
  }

  async toFile(
    filename: string,
    options: RasterFileOptions = {},
  ): Promise<void> {
    if (!filename) throw new TypeError("filename must not be empty");

    const inferred = formatFromFilename(filename);
    const explicit =
      options.format === undefined
        ? undefined
        : normalizeFormat(options.format);

    if (!inferred && !explicit) {
      throw new RangeError(
        "Cannot infer a raster format from filename; provide options.format",
      );
    }

    if (
      inferred &&
      explicit &&
      canonicalFormat(inferred) !== canonicalFormat(explicit)
    ) {
      throw new RangeError(
        "Filename format " +
          inferred +
          " conflicts with options.format " +
          explicit,
      );
    }

    const format = explicit ?? inferred;
    if (!format) throw new RangeError("A raster format is required");

    const { format: _ignored, ...exportOptions } = options;
    validateExportOptions(format, exportOptions);

    const nativeOptions: NativeSaveOptions = {
      ...toNativeExportOptions(exportOptions),
      format,
    };

    return this.#export(() => this.#canvas.toFile(filename, nativeOptions));
  }

  async toURL(
    format: EncodedRasterFormat = "png",
    options: RasterExportOptions = {},
  ): Promise<string> {
    const normalized = normalizeFormat(format);
    if (normalized === "raw") {
      throw new RangeError("Raw pixels cannot be exported as a data URL");
    }

    validateExportOptions(normalized, options);
    return this.#export(() =>
      this.#canvas.toURL(normalized, toNativeExportOptions(options)),
    );
  }

  dispose(): this {
    if (this.#disposed) return this;
    if (this.#rendering) {
      throw new SkiaCanvasError(
        "FRAME_IN_PROGRESS",
        "Cannot dispose while a frame is rendering",
      );
    }
    if (this.#exportCount > 0) {
      throw new SkiaCanvasError(
        "EXPORT_IN_PROGRESS",
        "Cannot dispose while an export is pending",
      );
    }

    super.removeAll();
    this.#forms.clear();
    this._isReady = false;
    this.#disposed = true;
    return this;
  }

  override play(_time = 0): this {
    throw this.#schedulerError("play()");
  }

  override playOnce(_duration = 0): this {
    throw this.#schedulerError("playOnce()");
  }

  override replay(): never {
    throw this.#schedulerError("replay()");
  }

  override pause(_toggle = false): this {
    throw this.#schedulerError("pause()");
  }

  override resume(): this {
    throw this.#schedulerError("resume()");
  }

  override stop(_time = 0): this {
    throw this.#schedulerError("stop()");
  }

  override minFrameTime(_milliseconds = 0): never {
    throw this.#schedulerError("minFrameTime()");
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new SkiaCanvasError(
        "DISPOSED",
        "SkiaCanvasSpace has been disposed",
      );
    }
  }

  #assertCanvasMutationAllowed(
    operation: string,
    allowDuringFrame = false,
  ): void {
    this.#assertUsable();

    if (this.#rendering && !allowDuringFrame) {
      throw new SkiaCanvasError(
        "FRAME_IN_PROGRESS",
        "Cannot " + operation + " while a frame is rendering",
      );
    }

    if (this.#exportCount > 0) {
      throw new SkiaCanvasError(
        "EXPORT_IN_PROGRESS",
        "Cannot " + operation + " while an export is pending",
      );
    }
  }

  #clearUnsafe(): void {
    const context = this.#nativeContext;
    context.save();

    try {
      context.resetTransform();
      context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);

      if (this.#background && this.#background !== "transparent") {
        context.fillStyle = this.#background;
        context.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
      }
    } finally {
      context.restore();
      resetPtsStyleCache(context);
    }
  }

  async #export<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertUsable();

    if (this.#rendering) {
      throw new SkiaCanvasError(
        "FRAME_IN_PROGRESS",
        "Cannot export while a frame is rendering",
      );
    }

    this.#exportCount += 1;
    try {
      return await operation();
    } finally {
      this.#exportCount -= 1;
    }
  }

  #schedulerError(operation: string): UnsupportedOperationError {
    return new UnsupportedOperationError(
      operation,
      "Call renderFrame(time) explicitly in Node.js.",
    );
  }
}
