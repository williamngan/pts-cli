import { extname } from "node:path";
import { writeFile } from "node:fs/promises";

import {
  Bound,
  Pt,
  Space,
  type AnimateCallbackFn,
  type IPlayer,
  type PtLike,
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
  CanvasAllocationLimits,
  DataURLFormat,
  OutputFileOptions,
  OutputFormat,
  RasterExportOptions,
  RasterFileOptions,
  RasterFormat,
  RenderFrameOptions,
  RendererInfo,
  RendererPreference,
  SkiaCanvas,
  SkiaCanvasContext2D,
  SkiaCanvasSpaceOptions,
  SvgExportOptions,
  SyntheticPointerEvent,
  SyntheticPointerEventInit,
} from "./types.js";

let nextSpaceId = 0;

const defaultAllocationLimits: Required<CanvasAllocationLimits> = {
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxLogicalPixels: 64_000_000,
};

const rasterFormats = new Set<RasterFormat>([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "raw",
]);
const outputFormats = new Set<OutputFormat>([...rasterFormats, "svg"]);
const rendererPreferences = new Set<RendererPreference>(["cpu", "auto", "gpu"]);

type MutationKind = "action" | "frame" | "initialization" | "resize";
type LifecycleMode = "deferred" | "eager" | "initializing" | "runner";

interface PlayerRegistration {
  readonly key: string;
  readonly player: IPlayer;
  readonly serial: number;
}

type PtsActionEvent = Parameters<NonNullable<IPlayer["action"]>>[3];

interface RunnerLifecycleController {
  begin(): void;
  bound(): Bound;
  finish(): void;
}

const runnerLifecycleControllers = new WeakMap<
  SkiaCanvasSpace,
  RunnerLifecycleController
>();

/** @internal Used by the package runner; intentionally not re-exported. */
export function beginRunnerInitialization(space: SkiaCanvasSpace): void {
  const controller = runnerLifecycleControllers.get(space);
  if (!controller) throw new TypeError("Unknown SkiaCanvasSpace instance");
  controller.begin();
}

/** @internal Used by the package runner; intentionally not re-exported. */
export function finishRunnerInitialization(space: SkiaCanvasSpace): void {
  const controller = runnerLifecycleControllers.get(space);
  if (!controller) throw new TypeError("Unknown SkiaCanvasSpace instance");
  controller.finish();
}

/** @internal Returns the runner's live bound for compatibility callbacks. */
export function runnerLiveBound(space: SkiaCanvasSpace): Bound {
  const controller = runnerLifecycleControllers.get(space);
  if (!controller) throw new TypeError("Unknown SkiaCanvasSpace instance");
  return controller.bound();
}

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

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(name + " must be a positive safe integer");
  }
}

function resolveAllocationLimits(
  limits: CanvasAllocationLimits | undefined,
): Required<CanvasAllocationLimits> {
  const resolved = { ...defaultAllocationLimits, ...limits };
  assertPositiveSafeInteger(resolved.maxWidth, "limits.maxWidth");
  assertPositiveSafeInteger(resolved.maxHeight, "limits.maxHeight");
  assertPositiveSafeInteger(
    resolved.maxLogicalPixels,
    "limits.maxLogicalPixels",
  );
  return resolved;
}

function assertAllocationDimensions(
  width: number,
  height: number,
  limits: Required<CanvasAllocationLimits>,
): void {
  assertDimension(width, "width");
  assertDimension(height, "height");

  if (width > limits.maxWidth) {
    throw new RangeError(
      "width exceeds the allocation limit of " + String(limits.maxWidth),
    );
  }
  if (height > limits.maxHeight) {
    throw new RangeError(
      "height exceeds the allocation limit of " + String(limits.maxHeight),
    );
  }
  if (width > Math.floor(limits.maxLogicalPixels / height)) {
    throw new RangeError(
      "canvas area exceeds the allocation limit of " +
        String(limits.maxLogicalPixels) +
        " logical pixels",
    );
  }
}

function normalizeRenderer(value: unknown): RendererPreference {
  if (typeof value !== "string") {
    throw new TypeError("renderer must be a string");
  }
  const renderer = value.toLowerCase() as RendererPreference;
  if (!rendererPreferences.has(renderer)) {
    throw new RangeError('Unsupported renderer "' + value + '"');
  }
  return renderer;
}

function normalizeFormat(value: unknown): OutputFormat {
  if (typeof value !== "string") {
    throw new TypeError("Output format must be a string");
  }

  const format = value.toLowerCase() as OutputFormat;
  if (!outputFormats.has(format)) {
    throw new RangeError(
      'Unsupported output format "' +
        value +
        '". Use png, jpeg, webp, raw, or svg; PDF is not supported.',
    );
  }

  return format;
}

function canonicalFormat(format: OutputFormat): Exclude<OutputFormat, "jpg"> {
  return format === "jpg" ? "jpeg" : format;
}

function formatFromFilename(filename: string): OutputFormat | undefined {
  const extension = extname(filename).slice(1).toLowerCase();
  if (!extension) return undefined;
  if (outputFormats.has(extension as OutputFormat)) {
    return extension as OutputFormat;
  }
  if (extension === "pdf") {
    return normalizeFormat(extension);
  }
  return undefined;
}

function assertOptionsObject(value: object, name: string): void {
  if (value === null || Array.isArray(value)) {
    throw new TypeError(name + " must be an object");
  }
}

function assertOptionKeys(options: object, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new RangeError('Option "' + key + '" is not valid for this format');
    }
  }
}

const rasterOptionKeys = new Set([
  "density",
  "matte",
  "quality",
  "msaa",
  "downsample",
]);
const svgOptionKeys = new Set(["outline"]);

function validateRasterExportOptions(
  format: RasterFormat,
  options: RasterExportOptions,
): void {
  assertOptionsObject(options, "Raster export options");
  assertOptionKeys(options, rasterOptionKeys);
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

  if (options.matte !== undefined && typeof options.matte !== "string") {
    throw new TypeError("matte must be a string");
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
    options.downsample !== undefined &&
    typeof options.downsample !== "boolean"
  ) {
    throw new TypeError("downsample must be a boolean");
  }

  if (
    typeof options.msaa === "number" &&
    (!Number.isFinite(options.msaa) ||
      !Number.isInteger(options.msaa) ||
      options.msaa < 1)
  ) {
    throw new RangeError("numeric msaa must be a positive finite integer");
  }

  if (
    options.msaa !== undefined &&
    typeof options.msaa !== "boolean" &&
    typeof options.msaa !== "number"
  ) {
    throw new TypeError("msaa must be a number or boolean");
  }
}

function validateSvgExportOptions(options: SvgExportOptions): void {
  assertOptionsObject(options, "SVG export options");
  assertOptionKeys(options, svgOptionKeys);
  if (options.outline !== undefined && typeof options.outline !== "boolean") {
    throw new TypeError("outline must be a boolean");
  }
}

function validateExportOptions(
  format: OutputFormat,
  options: RasterExportOptions | SvgExportOptions,
): void {
  if (format === "svg") {
    validateSvgExportOptions(options as SvgExportOptions);
  } else {
    validateRasterExportOptions(format, options as RasterExportOptions);
  }
}

function toNativeExportOptions(
  options: RasterExportOptions | SvgExportOptions,
): NativeExportOptions {
  return { ...options };
}

function toPoint(value: PtLike | readonly number[], name: string): Pt {
  const point =
    value instanceof Pt
      ? value.clone()
      : new Pt(value as number[] | Float32Array);
  if (value instanceof Pt && typeof value.id === "string") point.id = value.id;
  assertFinite(point.x, name + ".x");
  assertFinite(point.y, name + ".y");
  return point;
}

class SyntheticPointerEventValue implements SyntheticPointerEvent {
  readonly altKey: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly ctrlKey: boolean;
  readonly isPrimary: boolean;
  readonly metaKey: boolean;
  readonly pageX: number;
  readonly pageY: number;
  readonly pointerType = "synthetic" as const;
  readonly shiftKey: boolean;
  readonly timeStamp: number;
  readonly type: string;
  readonly x: number;
  readonly y: number;

  #defaultPrevented = false;
  #propagationStopped = false;

  constructor(type: string, point: Pt, init: SyntheticPointerEventInit = {}) {
    assertOptionsObject(init, "Synthetic event options");
    assertOptionKeys(
      init,
      new Set([
        "timeStamp",
        "button",
        "buttons",
        "altKey",
        "ctrlKey",
        "metaKey",
        "shiftKey",
        "isPrimary",
      ]),
    );

    const timeStamp = init.timeStamp ?? 0;
    const button = init.button ?? 0;
    const buttons = init.buttons ?? 0;
    assertFinite(timeStamp, "event.timeStamp");
    if (!Number.isSafeInteger(button)) {
      throw new RangeError("event.button must be a safe integer");
    }
    if (!Number.isSafeInteger(buttons) || buttons < 0) {
      throw new RangeError("event.buttons must be a non-negative safe integer");
    }

    for (const [key, value] of Object.entries({
      altKey: init.altKey,
      ctrlKey: init.ctrlKey,
      metaKey: init.metaKey,
      shiftKey: init.shiftKey,
      isPrimary: init.isPrimary,
    })) {
      if (value !== undefined && typeof value !== "boolean") {
        throw new TypeError("event." + key + " must be a boolean");
      }
    }

    this.type = type;
    this.timeStamp = timeStamp;
    this.x = point.x;
    this.y = point.y;
    this.clientX = point.x;
    this.clientY = point.y;
    this.pageX = point.x;
    this.pageY = point.y;
    this.button = button;
    this.buttons = buttons;
    this.altKey = init.altKey ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.isPrimary = init.isPrimary ?? true;
  }

  get defaultPrevented(): boolean {
    return this.#defaultPrevented;
  }

  get propagationStopped(): boolean {
    return this.#propagationStopped;
  }

  preventDefault(): void {
    this.#defaultPrevented = true;
  }

  stopPropagation(): void {
    this.#propagationStopped = true;
  }
}

export class SkiaCanvasSpace extends Space {
  readonly #allocationLimits: Required<CanvasAllocationLimits>;
  readonly #canvas: NativeCanvas;
  readonly #nativeContext: NativeContext2D;
  readonly #forms = new Set<SkiaCanvasForm>();
  readonly #rendererInfo: RendererInfo;
  readonly #registrations = new Map<string, PlayerRegistration>();

  #activeMutation: MutationKind | undefined;
  #background: string;
  #disposed = false;
  #exportCount = 0;
  #hasRendered = false;
  #lifecycleMode: LifecycleMode = "eager";
  #nextRegistrationSerial = 0;
  #pointerExplicit = false;
  #refreshEnabled: boolean;
  #rendering = false;
  #svgRasterFallback = false;

  constructor(width = 300, height = 150, options: SkiaCanvasSpaceOptions = {}) {
    super();

    this.#allocationLimits = resolveAllocationLimits(options.limits);
    assertAllocationDimensions(width, height, this.#allocationLimits);

    this.id = options.id || "skia_canvas_" + String(nextSpaceId++);
    this.#background = options.background ?? "transparent";
    this.#refreshEnabled = options.refresh ?? true;

    const requestedRenderer = normalizeRenderer(options.renderer ?? "cpu");
    const nativeOptions = {
      gpu: requestedRenderer !== "cpu",
    } as unknown as ConstructorParameters<typeof NativeCanvas>[2];

    this.#canvas = new NativeCanvas(width, height, nativeOptions);
    const engine = this.#canvas.engine;
    const actualRenderer = engine.renderer === "GPU" ? "gpu" : "cpu";
    const rendererInfo: {
      requested: RendererPreference;
      renderer: "cpu" | "gpu";
      api?: string;
      device?: string;
      driver?: string;
      threads?: number;
      error?: string;
    } = {
      requested: requestedRenderer,
      renderer: actualRenderer,
    };
    if (typeof engine.api === "string") rendererInfo.api = engine.api;
    if (typeof engine.device === "string") rendererInfo.device = engine.device;
    if (typeof engine.driver === "string") rendererInfo.driver = engine.driver;
    if (typeof engine.threads === "number") {
      rendererInfo.threads = engine.threads;
    }
    if (typeof engine.error === "string") rendererInfo.error = engine.error;
    this.#rendererInfo = Object.freeze(rendererInfo);

    if (requestedRenderer === "gpu" && actualRenderer !== "gpu") {
      const reason = rendererInfo.error
        ? ": " + rendererInfo.error
        : ". The native backend fell back to CPU.";
      throw new SkiaCanvasError(
        "RENDERER_UNAVAILABLE",
        "GPU rendering was required but is unavailable" + reason,
      );
    }

    this.#nativeContext = this.#canvas.getContext("2d");
    // Skia's SVG encoder silently omits filtered drawing commands. Observe
    // accepted filter assignments on this context only, retaining native
    // accessors. Conservatively keep the flag for this canvas's lifetime.
    const filter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(this.#nativeContext) as object,
      "filter",
    );
    if (!filter?.get || !filter.set) {
      throw new SkiaCanvasError(
        "UNSUPPORTED_OPERATION",
        "The native canvas filter accessor is unavailable",
      );
    }
    const context = this.#nativeContext;
    Object.defineProperty(context, "filter", {
      configurable: true,
      get: () => filter.get?.call(context) as string,
      set: (value: string) => {
        filter.set?.call(context, value);
        if (context.filter !== "none") this.#svgRasterFallback = true;
      },
    });
    this._ctx = toPtsContext(this.#nativeContext);
    this.bound = new Bound(new Pt(0, 0), new Pt(width, height));
    this._pointer = this.center;
    this._isReady = true;

    runnerLifecycleControllers.set(this, {
      begin: () => this.#beginRunnerInitialization(),
      bound: () => this.bound,
      finish: () => this.#finishRunnerInitialization(),
    });

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
    const pointer = this._pointer.clone();
    if (typeof this._pointer.id === "string") pointer.id = this._pointer.id;
    return pointer;
  }

  get ready(): boolean {
    return this._isReady && !this.#disposed;
  }

  get isExporting(): boolean {
    return this.#exportCount > 0;
  }

  get renderer(): RendererInfo {
    return this.#rendererInfo;
  }

  /** SVG embeds a raster snapshot when this canvas has used a Canvas filter. */
  get svgRasterFallback(): boolean {
    return this.#svgRasterFallback;
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

    const { previous, registration } = this.#registerPlayer(player);
    if (
      this.#lifecycleMode === "deferred" ||
      this.#lifecycleMode === "initializing"
    ) {
      return this;
    }

    registration.player.resize?.(this.bound);

    if (
      this.#lifecycleMode === "eager" &&
      previous !== registration.player &&
      this.#isCurrent(registration)
    ) {
      registration.player.start?.(this.bound.clone(), this);
    }

    return this;
  }

  override remove(player: IPlayer): this {
    this.#assertUsable();
    const key = player.animateID;
    super.remove(player);
    if (typeof key === "string") this.#registrations.delete(key);
    return this;
  }

  override removeAll(): this {
    this.#assertUsable();
    super.removeAll();
    this.#registrations.clear();
    return this;
  }

  override getForm(): SkiaCanvasForm {
    this.#assertUsable();
    const form = new SkiaCanvasForm(this, toPtsContext(this.#nativeContext));
    this.#forms.add(form);
    return form;
  }

  setPointer(point: PtLike | readonly number[]): this {
    this.#assertCanvasMutationAllowed("set the pointer");
    this._pointer = toPoint(point, "pointer");
    this.#pointerExplicit = true;
    return this;
  }

  dispatchAction(
    type: string,
    point: PtLike | readonly number[],
    eventInit: SyntheticPointerEventInit = {},
  ): this {
    this.#assertCanvasMutationAllowed("dispatch an action");
    if (typeof type !== "string" || type.length === 0) {
      throw new TypeError("Action type must be a non-empty string");
    }

    const nextPointer = toPoint(point, "pointer");
    const event = new SyntheticPointerEventValue(type, nextPointer, eventInit);
    this.#activeMutation = "action";

    try {
      const playerSnapshot = Object.entries(this.players);
      for (const [key, player] of playerSnapshot) {
        if (this.players[key] !== player) continue;
        player.action?.(
          type,
          nextPointer.x,
          nextPointer.y,
          event as unknown as PtsActionEvent,
        );
      }

      this._pointer = nextPointer;
      this._pointer.id = type;
      this.#pointerExplicit = true;
      return this;
    } finally {
      this.#activeMutation = undefined;
    }
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
    this.#activeMutation = "frame";
    this._playing = true;

    let saved = false;
    let completed = false;

    try {
      this.#nativeContext.save();
      saved = true;

      if (options.clear ?? this.#refreshEnabled) this.#clearUnsafe();

      const playerSnapshot = Object.entries(this.players);
      for (const [key, player] of playerSnapshot) {
        if (this.players[key] !== player) continue;
        player.animate?.(time, delta, this);
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
      this.#activeMutation = undefined;
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

      assertAllocationDimensions(
        boundOrWidth,
        heightOrEvent,
        this.#allocationLimits,
      );
      nextBound = new Bound(new Pt(0, 0), new Pt(boundOrWidth, heightOrEvent));
    } else {
      assertAllocationDimensions(
        boundOrWidth.width,
        boundOrWidth.height,
        this.#allocationLimits,
      );
      nextBound = boundOrWidth.clone();
      event = typeof heightOrEvent === "object" ? heightOrEvent : undefined;
    }

    this.#activeMutation = "resize";
    try {
      this.#canvas.width = nextBound.width;
      this.#canvas.height = nextBound.height;
      this.bound = nextBound;
      this._ctx = toPtsContext(this.#nativeContext);
      if (!this.#pointerExplicit) this._pointer = this.center;

      resetPtsStyleCache(this.#nativeContext);
      for (const form of this.#forms) form.reset();
      this.#clearUnsafe();

      const playerSnapshot = Object.entries(this.players);
      for (const [key, player] of playerSnapshot) {
        if (this.players[key] !== player) continue;
        player.resize?.(this.bound, event);
      }
    } finally {
      this.#activeMutation = undefined;
    }

    return this;
  }

  toBuffer(format: "svg", options?: SvgExportOptions): Promise<Buffer>;
  toBuffer(
    format?: RasterFormat,
    options?: RasterExportOptions,
  ): Promise<Buffer>;
  async toBuffer(
    format: OutputFormat = "png",
    options: RasterExportOptions | SvgExportOptions = {},
  ): Promise<Buffer> {
    const normalized = normalizeFormat(format);
    validateExportOptions(normalized, options);

    return this.#export(() => this.#encode(normalized, options));
  }

  toFile(filename: string, options?: RasterFileOptions): Promise<void>;
  toFile(
    filename: string,
    options?: { format?: "svg" } & SvgExportOptions,
  ): Promise<void>;
  async toFile(
    filename: string,
    options: OutputFileOptions = {},
  ): Promise<void> {
    if (!filename) throw new TypeError("filename must not be empty");
    assertOptionsObject(options, "File export options");

    const inferred = formatFromFilename(filename);
    const requestedFormat = (options as { format?: unknown }).format;
    const explicit =
      requestedFormat === undefined
        ? undefined
        : normalizeFormat(requestedFormat);

    if (!inferred && !explicit) {
      throw new RangeError(
        "Cannot infer an output format from filename; provide options.format",
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
    if (!format) throw new RangeError("An output format is required");

    const { format: _ignored, ...exportOptions } = options;
    validateExportOptions(format, exportOptions);

    const nativeOptions: NativeSaveOptions = {
      ...toNativeExportOptions(exportOptions),
      format,
    };

    return this.#export(async () => {
      if (format === "svg" && this.#svgRasterFallback) {
        await writeFile(filename, await this.#encode(format, exportOptions));
      } else {
        await this.#canvas.toFile(filename, nativeOptions);
      }
    });
  }

  toURL(format: "svg", options?: SvgExportOptions): Promise<string>;
  toURL(
    format?: Exclude<RasterFormat, "raw">,
    options?: RasterExportOptions,
  ): Promise<string>;
  async toURL(
    format: DataURLFormat = "png",
    options: RasterExportOptions | SvgExportOptions = {},
  ): Promise<string> {
    const normalized = normalizeFormat(format);
    if (normalized === "raw") {
      throw new RangeError("Raw pixels cannot be exported as a data URL");
    }

    validateExportOptions(normalized, options);
    return this.#export(async () => {
      if (normalized === "svg" && this.#svgRasterFallback) {
        const buffer = await this.#encode(normalized, options);
        return "data:image/svg+xml;base64," + buffer.toString("base64");
      }
      return this.#canvas.toURL(normalized, toNativeExportOptions(options));
    });
  }

  dispose(): this {
    if (this.#disposed) return this;
    if (this.#activeMutation) {
      const active = this.#activeMutation;
      throw new SkiaCanvasError(
        active === "frame" ? "FRAME_IN_PROGRESS" : "MUTATION_IN_PROGRESS",
        "Cannot dispose while " + active + " is in progress",
      );
    }
    if (this.#exportCount > 0) {
      throw new SkiaCanvasError(
        "EXPORT_IN_PROGRESS",
        "Cannot dispose while an export is pending",
      );
    }

    super.removeAll();
    this.#registrations.clear();
    this.#forms.clear();
    runnerLifecycleControllers.delete(this);
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

  #registerPlayer(playerOrCallback: IPlayer | AnimateCallbackFn): {
    previous: IPlayer | undefined;
    registration: PlayerRegistration;
  } {
    const player: IPlayer =
      typeof playerOrCallback === "function"
        ? { animate: playerOrCallback }
        : playerOrCallback;
    const index = this.playerCount++;
    const key = player.animateID || this.id + String(index);
    const previous = this.players[key];
    const registration: PlayerRegistration = {
      key,
      player,
      serial: this.#nextRegistrationSerial++,
    };

    this.players[key] = player;
    player.animateID = key;
    this.#registrations.set(key, registration);
    return { previous, registration };
  }

  #isCurrent(registration: PlayerRegistration): boolean {
    return (
      this.players[registration.key] === registration.player &&
      this.#registrations.get(registration.key) === registration
    );
  }

  #beginRunnerInitialization(): void {
    this.#assertCanvasMutationAllowed("begin runner initialization");
    if (this.#lifecycleMode !== "eager") {
      throw new SkiaCanvasError(
        "MUTATION_IN_PROGRESS",
        "Runner initialization has already begun for this space",
      );
    }
    if (Object.keys(this.players).length > 0) {
      throw new SkiaCanvasError(
        "MUTATION_IN_PROGRESS",
        "Runner initialization must begin before players are added",
      );
    }
    this.#lifecycleMode = "deferred";
  }

  #finishRunnerInitialization(): void {
    this.#assertCanvasMutationAllowed("finish runner initialization");
    if (this.#lifecycleMode !== "deferred") {
      throw new SkiaCanvasError(
        "MUTATION_IN_PROGRESS",
        "Runner initialization is not awaiting completion",
      );
    }

    const resized = new Set<number>();
    const started = new Set<number>();
    this.#lifecycleMode = "initializing";
    this.#activeMutation = "initialization";

    try {
      while (true) {
        const batch = [...this.#registrations.values()].filter(
          (registration) =>
            this.#isCurrent(registration) &&
            (!resized.has(registration.serial) ||
              !started.has(registration.serial)),
        );
        if (batch.length === 0) break;

        for (const registration of batch) {
          if (resized.has(registration.serial)) continue;
          resized.add(registration.serial);
          if (!this.#isCurrent(registration)) continue;
          registration.player.resize?.(this.bound);
        }

        for (const registration of batch) {
          if (started.has(registration.serial)) continue;
          started.add(registration.serial);
          if (!this.#isCurrent(registration)) continue;
          registration.player.start?.(this.bound.clone(), this);
        }
      }
    } finally {
      this.#lifecycleMode = "runner";
      this.#activeMutation = undefined;
    }
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

    if (this.#activeMutation && !allowDuringFrame) {
      const active = this.#activeMutation;
      throw new SkiaCanvasError(
        active === "frame" ? "FRAME_IN_PROGRESS" : "MUTATION_IN_PROGRESS",
        "Cannot " + operation + " while " + active + " is in progress",
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

  async #encode(
    format: OutputFormat,
    options: RasterExportOptions | SvgExportOptions,
  ): Promise<Buffer> {
    if (format !== "svg" || !this.#svgRasterFallback) {
      return this.#canvas.toBuffer(format, toNativeExportOptions(options));
    }
    const png = await this.#canvas.toBuffer("png", { density: 1 });
    const width = String(this.#canvas.width);
    const height = String(this.#canvas.height);
    return Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' +
        width +
        '" height="' +
        height +
        '" viewBox="0 0 ' +
        width +
        " " +
        height +
        '">' +
        '<image width="' +
        width +
        '" height="' +
        height +
        '" xlink:href="data:image/png;base64,' +
        png.toString("base64") +
        '"/></svg>\n',
    );
  }

  async #export<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertUsable();

    if (this.#activeMutation) {
      const active = this.#activeMutation;
      throw new SkiaCanvasError(
        active === "frame" ? "FRAME_IN_PROGRESS" : "MUTATION_IN_PROGRESS",
        "Cannot export while " + active + " is in progress",
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
