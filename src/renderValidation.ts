import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extname, resolve } from "node:path";

import { PtsRenderError } from "./PtsRenderError.js";
import { snapshotJsonObject } from "./sceneValidation.js";
import { selectAutomaticLoader } from "./sourceAnalysis.js";
import {
  DEFAULT_RENDER_RESOURCE_LIMITS,
  type PtsSceneEvent,
  type RenderFacts,
  type RenderOutputRequest,
  type RenderResourceLimits,
  type RenderSceneOptions,
} from "./renderTypes.js";

const optionKeys = new Set([
  "loader",
  "size",
  "background",
  "pointer",
  "render",
  "events",
  "seed",
  "params",
  "assetRoot",
  "allowNet",
  "fonts",
  "renderer",
  "limits",
  "outputs",
  "signal",
  "timeoutMs",
  "overwrite",
]);

const limitKeys = new Set(Object.keys(DEFAULT_RENDER_RESOURCE_LIMITS));
const pointerEventTypes = new Set([
  "up",
  "down",
  "move",
  "drag",
  "uidrag",
  "drop",
  "uidrop",
  "over",
  "out",
  "enter",
  "leave",
  "click",
  "pointerdown",
  "pointerup",
  "contextmenu",
]);

export interface PreparedOutputRequest {
  readonly request: Omit<RenderOutputRequest, "path">;
  readonly destination?: string;
}

export interface PreparedRenderRequest {
  readonly source: string;
  readonly loader: "scene" | "pts-demo";
  readonly size?: { readonly width: number; readonly height: number };
  readonly background?: string;
  readonly pointer?: readonly [number, number];
  readonly render: RenderFacts;
  readonly events: readonly PtsSceneEvent[];
  readonly seed?: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly assetRoot?: string;
  readonly allowNet: boolean;
  readonly fonts: readonly {
    readonly family: string;
    readonly sources: readonly string[];
  }[];
  readonly renderer: "cpu" | "auto" | "gpu";
  readonly limits: RenderResourceLimits;
  readonly outputs: readonly PreparedOutputRequest[];
  readonly timeoutMs: number;
  readonly overwrite: boolean;
  readonly signal?: AbortSignal;
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new PtsRenderError("CLI_USAGE", "arguments", message, {
    ...(details === undefined ? {} : { details }),
  });
}

function resourceLimit(message: string): never {
  throw new PtsRenderError("RESOURCE_LIMIT", "arguments", message);
}

function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(name + " must be an object");
  }
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    invalid(name + " could not be inspected", {
      reason: thrownReason(error),
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(name + " must be a plain object");
  }
  const copy: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string")
      invalid(name + " must not contain symbol keys");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      invalid(name + "." + key + " must be an own data property");
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function thrownReason(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "Uninspectable error";
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(name + "." + key + " is not supported");
  }
}

function assertFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(name + " must be a finite number");
  }
  return value;
}

function assertPositiveSafeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalid(name + " must be a positive safe integer");
  }
  return value;
}

function assertNonNegativeSafeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(name + " must be a non-negative safe integer");
  }
  return value;
}

/** A drive letter is a filesystem prefix, even though it resembles a URL scheme. */
export function isURLReference(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) && !/^[a-zA-Z]:/.test(value);
}

function toFilePath(value: string | URL, cwd: string, name: string): string {
  if (value instanceof URL) {
    if (value.protocol !== "file:")
      invalid(name + " must be a file URL or path");
    return fileURLToPath(value);
  }
  if (typeof value !== "string" || value.length === 0) {
    invalid(name + " must be a non-empty path or file URL");
  }
  if (isURLReference(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      invalid(name + " is not a valid URL");
    }
    if (url.protocol !== "file:") invalid(name + " must be a file URL or path");
    return fileURLToPath(url);
  }
  return resolve(cwd, value);
}

function toAssetURL(value: string | URL, cwd: string, name: string): string {
  if (value instanceof URL) return value.href;
  if (typeof value !== "string" || value.length === 0) {
    invalid(name + " must be a non-empty URL or path");
  }
  if (isURLReference(value)) {
    try {
      return new URL(value).href;
    } catch {
      invalid(name + " is not a valid URL");
    }
  }
  return pathToFileURL(resolve(cwd, value)).href;
}

function normalizeRenderClock(value: unknown): RenderFacts {
  if (value === undefined) {
    return { mode: "direct", time: 0, framesInvoked: 1 };
  }
  const clock = assertObject(value, "render");
  if (clock.mode === "direct") {
    assertKnownKeys(clock, new Set(["mode", "time"]), "render");
    const time = assertFiniteNumber(clock.time ?? 0, "render.time");
    if (time < 0) invalid("render.time must not be negative");
    return { mode: "direct", time, framesInvoked: 1 };
  }
  if (clock.mode === "frame") {
    assertKnownKeys(clock, new Set(["mode", "frame", "fps"]), "render");
    const frame = assertNonNegativeSafeInteger(clock.frame, "render.frame");
    const fps = assertFiniteNumber(clock.fps ?? 60, "render.fps");
    if (fps <= 0) invalid("render.fps must be greater than zero");
    return {
      mode: "frame",
      frame,
      fps,
      time: (frame * 1000) / fps,
      framesInvoked: frame + 1,
    };
  }
  invalid('render.mode must be "direct" or "frame"');
}

function normalizeLimits(value: unknown): RenderResourceLimits {
  if (value === undefined) return { ...DEFAULT_RENDER_RESOURCE_LIMITS };
  const overrides = assertObject(value, "limits");
  assertKnownKeys(overrides, limitKeys, "limits");
  const limits = {
    ...DEFAULT_RENDER_RESOURCE_LIMITS,
  } as Record<keyof RenderResourceLimits, number>;
  for (const [key, item] of Object.entries(overrides)) {
    limits[key as keyof RenderResourceLimits] = assertPositiveSafeInteger(
      item,
      "limits." + key,
    );
  }
  return limits;
}

function normalizeEvents(
  value: unknown,
  limits: RenderResourceLimits,
): readonly PtsSceneEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid("events must be an array");
  if (value.length > limits.maxEvents) {
    resourceLimit(
      "events exceeds limits.maxEvents (" + String(limits.maxEvents) + ")",
    );
  }

  const events = value.map((item, index): PtsSceneEvent => {
    const path = "events[" + String(index) + "]";
    const event = assertObject(item, path);
    const at = assertFiniteNumber(event.at, path + ".at");
    if (at < 0) invalid(path + ".at must not be negative");
    if (event.type === "resize") {
      assertKnownKeys(event, new Set(["at", "type", "width", "height"]), path);
      const width = assertPositiveSafeInteger(event.width, path + ".width");
      const height = assertPositiveSafeInteger(event.height, path + ".height");
      if (width > limits.maxWidth || height > limits.maxHeight) {
        resourceLimit(path + " exceeds limits.maxWidth or limits.maxHeight");
      }
      if (width > Math.floor(limits.maxLogicalPixels / height)) {
        resourceLimit(path + " exceeds limits.maxLogicalPixels");
      }
      return {
        at,
        type: "resize",
        width,
        height,
      };
    }
    if (typeof event.type !== "string" || !pointerEventTypes.has(event.type)) {
      invalid(path + ".type is not a supported pointer action");
    }
    assertKnownKeys(
      event,
      new Set([
        "at",
        "type",
        "x",
        "y",
        "button",
        "buttons",
        "altKey",
        "ctrlKey",
        "metaKey",
        "shiftKey",
      ]),
      path,
    );
    const normalized: Record<string, unknown> = {
      at,
      type: event.type,
      x: assertFiniteNumber(event.x, path + ".x"),
      y: assertFiniteNumber(event.y, path + ".y"),
    };
    for (const key of ["button", "buttons"] as const) {
      if (event[key] !== undefined) {
        normalized[key] = assertNonNegativeSafeInteger(
          event[key],
          path + "." + key,
        );
      }
    }
    for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) {
      if (event[key] !== undefined) {
        if (typeof event[key] !== "boolean") {
          invalid(path + "." + key + " must be a boolean");
        }
        normalized[key] = event[key];
      }
    }
    return normalized as unknown as PtsSceneEvent;
  });

  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (left, right) =>
        left.event.at - right.event.at || left.index - right.index,
    )
    .map(({ event }) => event);
}

function normalizeOutput(
  value: unknown,
  index: number,
  cwd: string,
): PreparedOutputRequest {
  const path = "outputs[" + String(index) + "]";
  const output = assertObject(value, path);
  const common = new Set(["path", "format"]);
  const raster = new Set(["density", "matte", "msaa"]);
  const allowed = new Set(common);
  if (["png", "jpeg", "jpg", "webp", "raw"].includes(String(output.format))) {
    for (const key of raster) allowed.add(key);
  }
  if (output.format === "jpeg" || output.format === "jpg") {
    allowed.add("quality");
    allowed.add("downsample");
  } else if (output.format === "webp") {
    allowed.add("quality");
  } else if (output.format === "svg") {
    allowed.add("textMode");
  }
  assertKnownKeys(output, allowed, path);

  if (
    output.format !== "png" &&
    output.format !== "jpeg" &&
    output.format !== "jpg" &&
    output.format !== "webp" &&
    output.format !== "raw" &&
    output.format !== "svg"
  ) {
    invalid(path + ".format is not supported");
  }
  const format = output.format === "jpg" ? "jpeg" : output.format;
  const request: Record<string, unknown> = { format };

  if (format === "svg") {
    if (
      output.textMode !== undefined &&
      output.textMode !== "preserve" &&
      output.textMode !== "outline"
    ) {
      invalid(path + '.textMode must be "preserve" or "outline"');
    }
    if (output.textMode !== undefined) request.textMode = output.textMode;
  } else {
    if (output.density !== undefined) {
      request.density = assertPositiveSafeInteger(
        output.density,
        path + ".density",
      );
    }
    if (output.matte !== undefined) {
      if (typeof output.matte !== "string") {
        invalid(path + ".matte must be a string");
      }
      request.matte = output.matte;
    }
    if (output.msaa !== undefined) {
      if (
        typeof output.msaa !== "boolean" &&
        (typeof output.msaa !== "number" ||
          !Number.isSafeInteger(output.msaa) ||
          output.msaa <= 0)
      ) {
        invalid(path + ".msaa must be a boolean or positive integer");
      }
      request.msaa = output.msaa;
    }
    if (output.quality !== undefined) {
      const quality = assertFiniteNumber(output.quality, path + ".quality");
      if (quality < 0 || quality > 1) {
        invalid(path + ".quality must be between 0 and 1");
      }
      request.quality = quality;
    }
    if (output.downsample !== undefined) {
      if (typeof output.downsample !== "boolean") {
        invalid(path + ".downsample must be a boolean");
      }
      request.downsample = output.downsample;
    }
  }

  let destination: string | undefined;
  if (output.path !== undefined) {
    destination = toFilePath(output.path as string | URL, cwd, path + ".path");
    const extension = extname(destination).slice(1).toLowerCase();
    const extensionFormat = extension === "jpg" ? "jpeg" : extension;
    if (
      ["png", "jpeg", "webp", "raw", "svg"].includes(extensionFormat) &&
      extensionFormat !== format
    ) {
      invalid(
        path + ".format conflicts with the destination extension ." + extension,
      );
    }
  }

  return {
    request: request as unknown as Omit<RenderOutputRequest, "path">,
    ...(destination === undefined ? {} : { destination }),
  };
}

export async function prepareRenderRequest(
  source: string | URL,
  options: RenderSceneOptions,
  cwd = process.cwd(),
): Promise<PreparedRenderRequest> {
  const rawOptions = assertObject(options, "options");
  assertKnownKeys(rawOptions, optionKeys, "options");
  const sourcePath = toFilePath(source, cwd, "source");
  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch (error) {
    throw new PtsRenderError(
      "SOURCE_NOT_FOUND",
      "load",
      "Scene source does not exist: " + sourcePath,
      { cause: error, details: { source: sourcePath } },
    );
  }
  if (!sourceStat.isFile()) {
    throw new PtsRenderError(
      "SOURCE_NOT_FOUND",
      "load",
      "Scene source is not a regular file: " + sourcePath,
    );
  }

  const limits = normalizeLimits(rawOptions.limits);
  if (sourceStat.size > limits.maxSourceBytes) {
    resourceLimit(
      "Scene source exceeds limits.maxSourceBytes (" +
        String(limits.maxSourceBytes) +
        ")",
    );
  }

  const loader = rawOptions.loader ?? "auto";
  if (loader !== "auto" && loader !== "scene" && loader !== "pts-demo") {
    invalid('loader must be "auto", "scene", or "pts-demo"');
  }
  let selectedLoader: "scene" | "pts-demo";
  if (loader === "auto") {
    let sourceText: string;
    try {
      sourceText = await readFile(sourcePath, "utf8");
    } catch (error) {
      throw new PtsRenderError(
        "SOURCE_NOT_FOUND",
        "load",
        "Unable to read scene source: " + sourcePath,
        { cause: error, details: { source: sourcePath } },
      );
    }
    selectedLoader = selectAutomaticLoader(sourceText, sourcePath);
  } else {
    selectedLoader = loader;
  }

  let size: { width: number; height: number } | undefined;
  if (rawOptions.size !== undefined) {
    const rawSize = assertObject(rawOptions.size, "size");
    assertKnownKeys(rawSize, new Set(["width", "height"]), "size");
    size = {
      width: assertPositiveSafeInteger(rawSize.width, "size.width"),
      height: assertPositiveSafeInteger(rawSize.height, "size.height"),
    };
    if (size.width > limits.maxWidth || size.height > limits.maxHeight) {
      resourceLimit("size exceeds limits.maxWidth or limits.maxHeight");
    }
    if (size.width > Math.floor(limits.maxLogicalPixels / size.height)) {
      resourceLimit("size exceeds limits.maxLogicalPixels");
    }
  }

  let pointer: readonly [number, number] | undefined;
  if (rawOptions.pointer !== undefined) {
    if (!Array.isArray(rawOptions.pointer) || rawOptions.pointer.length !== 2) {
      invalid("pointer must be a two-number tuple");
    }
    pointer = [
      assertFiniteNumber(rawOptions.pointer[0], "pointer[0]"),
      assertFiniteNumber(rawOptions.pointer[1], "pointer[1]"),
    ];
  }

  const render = normalizeRenderClock(rawOptions.render);
  if (render.framesInvoked > limits.maxFramesInvoked) {
    resourceLimit(
      "Requested frame count exceeds limits.maxFramesInvoked (" +
        String(limits.maxFramesInvoked) +
        ")",
    );
  }
  if (render.mode === "frame" && render.fps > limits.maxFps) {
    resourceLimit(
      "Requested fps exceeds limits.maxFps (" + String(limits.maxFps) + ")",
    );
  }
  const events = normalizeEvents(rawOptions.events, limits);
  if (
    Buffer.byteLength(JSON.stringify(events), "utf8") > limits.maxInputBytes
  ) {
    resourceLimit(
      "events exceeds limits.maxInputBytes (" +
        String(limits.maxInputBytes) +
        ")",
    );
  }

  if (!Array.isArray(rawOptions.outputs) || rawOptions.outputs.length === 0) {
    invalid("outputs must be a non-empty array");
  }
  if (rawOptions.outputs.length > limits.maxOutputs) {
    resourceLimit(
      "outputs exceeds limits.maxOutputs (" + String(limits.maxOutputs) + ")",
    );
  }
  const outputs = rawOptions.outputs.map((output, index) =>
    normalizeOutput(output, index, cwd),
  );
  const destinations = new Set<string>();
  for (const output of outputs) {
    if (!output.destination) continue;
    const destinationKey =
      process.platform === "win32"
        ? output.destination.toLowerCase()
        : output.destination;
    if (destinations.has(destinationKey)) {
      throw new PtsRenderError(
        "OUTPUT_TARGET_INVALID",
        "arguments",
        "Two outputs resolve to the same destination: " + output.destination,
      );
    }
    destinations.add(destinationKey);
  }

  let seed: string | undefined;
  if (rawOptions.seed !== undefined) {
    if (typeof rawOptions.seed !== "string") invalid("seed must be a string");
    if (Buffer.byteLength(rawOptions.seed, "utf8") > limits.maxSeedBytes) {
      resourceLimit(
        "seed exceeds limits.maxSeedBytes (" +
          String(limits.maxSeedBytes) +
          ")",
      );
    }
    seed = rawOptions.seed;
  }

  let params: Readonly<Record<string, unknown>> = Object.freeze({});
  if (rawOptions.params !== undefined) {
    try {
      params = snapshotJsonObject(rawOptions.params, "params");
    } catch (error) {
      invalid(
        error instanceof Error
          ? error.message
          : "params must be JSON-compatible",
      );
    }
    if (
      Buffer.byteLength(JSON.stringify(params), "utf8") > limits.maxInputBytes
    ) {
      resourceLimit(
        "params exceeds limits.maxInputBytes (" +
          String(limits.maxInputBytes) +
          ")",
      );
    }
  }

  const fonts: Array<{ family: string; sources: string[] }> = [];
  if (rawOptions.fonts !== undefined) {
    if (!Array.isArray(rawOptions.fonts)) invalid("fonts must be an array");
    rawOptions.fonts.forEach((item, index) => {
      const path = "fonts[" + String(index) + "]";
      const font = assertObject(item, path);
      assertKnownKeys(font, new Set(["family", "sources"]), path);
      if (typeof font.family !== "string" || font.family.length === 0) {
        invalid(path + ".family must be a non-empty string");
      }
      if (!Array.isArray(font.sources) || font.sources.length === 0) {
        invalid(path + ".sources must be a non-empty array");
      }
      fonts.push({
        family: font.family,
        sources: font.sources.map((item, sourceIndex) =>
          toAssetURL(
            item as string | URL,
            cwd,
            path + ".sources[" + String(sourceIndex) + "]",
          ),
        ),
      });
    });
  }
  if (Buffer.byteLength(JSON.stringify(fonts), "utf8") > limits.maxInputBytes) {
    resourceLimit(
      "fonts exceeds limits.maxInputBytes (" +
        String(limits.maxInputBytes) +
        ")",
    );
  }

  const renderer = rawOptions.renderer ?? "cpu";
  if (renderer !== "cpu" && renderer !== "auto" && renderer !== "gpu") {
    invalid('renderer must be "cpu", "auto", or "gpu"');
  }
  const timeoutMs = assertPositiveSafeInteger(
    rawOptions.timeoutMs ?? 30_000,
    "timeoutMs",
  );
  if (
    rawOptions.background !== undefined &&
    typeof rawOptions.background !== "string"
  ) {
    invalid("background must be a string");
  }
  if (
    rawOptions.allowNet !== undefined &&
    typeof rawOptions.allowNet !== "boolean"
  ) {
    invalid("allowNet must be a boolean");
  }
  if (
    rawOptions.overwrite !== undefined &&
    typeof rawOptions.overwrite !== "boolean"
  ) {
    invalid("overwrite must be a boolean");
  }
  if (
    rawOptions.signal !== undefined &&
    (rawOptions.signal === null ||
      typeof rawOptions.signal !== "object" ||
      typeof (rawOptions.signal as { aborted?: unknown }).aborted !==
        "boolean" ||
      typeof (rawOptions.signal as { addEventListener?: unknown })
        .addEventListener !== "function" ||
      typeof (rawOptions.signal as { removeEventListener?: unknown })
        .removeEventListener !== "function")
  ) {
    invalid("signal must be an AbortSignal");
  }

  return {
    source: sourcePath,
    loader: selectedLoader,
    ...(size === undefined ? {} : { size: Object.freeze(size) }),
    ...(rawOptions.background === undefined
      ? {}
      : { background: rawOptions.background }),
    ...(pointer === undefined ? {} : { pointer: Object.freeze(pointer) }),
    render: Object.freeze(render),
    events: Object.freeze(events),
    ...(seed === undefined ? {} : { seed }),
    params,
    ...(rawOptions.assetRoot === undefined
      ? {}
      : {
          assetRoot: toAssetURL(
            rawOptions.assetRoot as string | URL,
            cwd,
            "assetRoot",
          ),
        }),
    allowNet: rawOptions.allowNet ?? false,
    fonts: Object.freeze(fonts),
    renderer,
    limits: Object.freeze(limits),
    outputs: Object.freeze(outputs),
    timeoutMs,
    overwrite: rawOptions.overwrite ?? false,
    ...(rawOptions.signal === undefined
      ? {}
      : { signal: rawOptions.signal as AbortSignal }),
  };
}
