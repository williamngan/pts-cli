import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { PtsRenderError } from "./PtsRenderError.js";
import {
  DEFAULT_RENDER_RESOURCE_LIMITS,
  type PtsSceneEvent,
  type RenderOutputRequest,
  type RenderResourceLimits,
  type RenderSceneOptions,
} from "./renderTypes.js";

export type ParsedCLI =
  | { readonly command: "help" | "version" }
  | {
      readonly command: "render";
      readonly source: string;
      readonly options: RenderSceneOptions;
      readonly json: boolean;
      readonly quiet: boolean;
      readonly debug: boolean;
      readonly stdoutOutput: boolean;
    };

interface RawArguments {
  readonly positionals: string[];
  readonly values: Map<string, string[]>;
  readonly booleans: Map<string, number>;
}

const valueOptions = new Set([
  "out",
  "format",
  "loader",
  "size",
  "background",
  "pointer",
  "time",
  "frame",
  "fps",
  "events",
  "seed",
  "param",
  "params",
  "density",
  "quality",
  "matte",
  "text-mode",
  "asset-root",
  "font",
  "renderer",
  "timeout",
  "limit",
]);
const repeatableOptions = new Set(["out", "param", "font", "limit"]);
const booleanOptions = new Set([
  "allow-net",
  "force",
  "json",
  "quiet",
  "debug",
  "help",
  "version",
]);

function usage(message: string): never {
  throw new PtsRenderError("CLI_USAGE", "arguments", message);
}

function normalizeOptionToken(token: string): {
  readonly name: string;
  readonly inline?: string;
} {
  if (token === "-o") return { name: "out" };
  if (!token.startsWith("--")) usage("Unknown argument: " + token);
  const content = token.slice(2);
  const equals = content.indexOf("=");
  if (equals < 0) return { name: content };
  return { name: content.slice(0, equals), inline: content.slice(equals + 1) };
}

function tokenize(argv: readonly string[]): RawArguments {
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  const booleans = new Map<string, number>();
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (positionalOnly || !token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    const option = normalizeOptionToken(token);
    if (booleanOptions.has(option.name)) {
      if (option.inline !== undefined) {
        usage("--" + option.name + " does not accept a value");
      }
      const count = (booleans.get(option.name) ?? 0) + 1;
      if (count > 1) usage("--" + option.name + " may be specified only once");
      booleans.set(option.name, count);
      continue;
    }
    if (!valueOptions.has(option.name)) {
      usage("Unknown option: --" + option.name);
    }
    const value = option.inline ?? argv[++index];
    if (value === undefined) usage("--" + option.name + " requires a value");
    const existing = values.get(option.name) ?? [];
    if (existing.length > 0 && !repeatableOptions.has(option.name)) {
      usage("--" + option.name + " may be specified only once");
    }
    existing.push(value);
    values.set(option.name, existing);
  }
  return { positionals, values, booleans };
}

function one(raw: RawArguments, name: string): string | undefined {
  return raw.values.get(name)?.[0];
}

function finite(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) usage("--" + name + " must be a finite number");
  return number;
}

function positiveInteger(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    usage("--" + name + " must be a positive integer");
  }
  return number;
}

function nonNegativeInteger(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    usage("--" + name + " must be a non-negative integer");
  }
  return number;
}

function parseLimits(raw: RawArguments): Partial<RenderResourceLimits> {
  const result: Record<string, number> = {};
  const known = new Set(Object.keys(DEFAULT_RENDER_RESOURCE_LIMITS));
  for (const item of raw.values.get("limit") ?? []) {
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      usage("--limit must use name=value");
    }
    const name = item.slice(0, separator);
    if (!known.has(name)) usage("Unknown resource limit: " + name);
    if (Object.hasOwn(result, name)) {
      usage("Resource limit may be specified only once: " + name);
    }
    result[name] = positiveInteger(item.slice(separator + 1), "limit " + name);
  }
  return result;
}

async function readJsonFile(
  path: string,
  maxBytes: number,
  name: string,
): Promise<unknown> {
  const absolute = resolve(path);
  let fileStat;
  try {
    fileStat = await stat(absolute);
  } catch (error) {
    throw new PtsRenderError(
      "CLI_USAGE",
      "arguments",
      name + " file does not exist: " + absolute,
      { cause: error },
    );
  }
  if (!fileStat.isFile()) usage(name + " path is not a file: " + absolute);
  if (fileStat.size > maxBytes) {
    throw new PtsRenderError(
      "RESOURCE_LIMIT",
      "arguments",
      name + " file exceeds maxInputBytes",
    );
  }
  try {
    return JSON.parse(await readFile(absolute, "utf8")) as unknown;
  } catch (error) {
    throw new PtsRenderError(
      "CLI_USAGE",
      "arguments",
      name + " file is not valid JSON: " + absolute,
      { cause: error },
    );
  }
}

function assertPlainObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    usage(name + " must contain a JSON object");
  }
  return value as Record<string, unknown>;
}

function assertSafeParamKey(key: string): void {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    usage("Forbidden parameter key: " + key);
  }
}

async function parseParams(
  raw: RawArguments,
  maxBytes: number,
): Promise<Readonly<Record<string, unknown>>> {
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const file = one(raw, "params");
  if (file) {
    const base = assertPlainObject(
      await readJsonFile(file, maxBytes, "params"),
      "--params",
    );
    for (const [key, value] of Object.entries(base)) {
      assertSafeParamKey(key);
      result[key] = value;
    }
  }

  const seen = new Set<string>();
  for (const item of raw.values.get("param") ?? []) {
    const separator = item.indexOf("=");
    if (separator <= 0) usage("--param must use key=value");
    const key = item.slice(0, separator);
    assertSafeParamKey(key);
    if (seen.has(key)) usage("--param key repeated: " + key);
    seen.add(key);
    const rawValue = item.slice(separator + 1);
    try {
      result[key] = JSON.parse(rawValue) as unknown;
    } catch {
      result[key] = rawValue;
    }
  }
  return result;
}

async function parseEvents(
  raw: RawArguments,
  maxBytes: number,
): Promise<readonly PtsSceneEvent[] | undefined> {
  const path = one(raw, "events");
  if (!path) return undefined;
  const value = await readJsonFile(path, maxBytes, "events");
  if (Array.isArray(value)) return value as PtsSceneEvent[];
  const root = assertPlainObject(value, "--events");
  const keys = Object.keys(root);
  if (
    keys.some((key) => key !== "schemaVersion" && key !== "events") ||
    root.schemaVersion !== 1 ||
    !Array.isArray(root.events)
  ) {
    usage("--events must use { schemaVersion: 1, events: [...] }");
  }
  return root.events as PtsSceneEvent[];
}

function outputFormat(path: string, explicit: string | undefined): string {
  const inferred =
    path === "-"
      ? ""
      : extname(path).slice(1).toLowerCase().replace(/^jpg$/, "jpeg");
  const normalizedExplicit = explicit?.toLowerCase().replace(/^jpg$/, "jpeg");
  if (
    normalizedExplicit !== undefined &&
    !["png", "jpeg", "webp", "raw", "svg"].includes(normalizedExplicit)
  ) {
    usage("Unsupported --format: " + String(explicit));
  }
  if (
    inferred &&
    ["png", "jpeg", "webp", "raw", "svg"].includes(inferred) &&
    normalizedExplicit !== undefined &&
    inferred !== normalizedExplicit
  ) {
    usage("--format conflicts with output extension: " + path);
  }
  const format = normalizedExplicit ?? inferred;
  if (!["png", "jpeg", "webp", "raw", "svg"].includes(format)) {
    usage("Cannot infer output format from " + path + "; pass --format");
  }
  return format;
}

function parseOutputs(raw: RawArguments): {
  readonly outputs: readonly RenderOutputRequest[];
  readonly stdoutOutput: boolean;
} {
  const paths = raw.values.get("out") ?? [];
  if (paths.length === 0) usage("At least one --out destination is required");
  const explicit = one(raw, "format");
  if (explicit !== undefined && paths.length !== 1) {
    usage("--format is valid only with exactly one --out destination");
  }
  if (paths.filter((path) => path === "-").length > 1) {
    usage("Standard output may be selected only once");
  }

  const density = one(raw, "density");
  const quality = one(raw, "quality");
  const matte = one(raw, "matte");
  const textMode = one(raw, "text-mode");
  if (
    textMode !== undefined &&
    textMode !== "preserve" &&
    textMode !== "outline"
  ) {
    usage('--text-mode must be "preserve" or "outline"');
  }
  const formats = paths.map((path) => outputFormat(path, explicit));
  if (
    quality !== undefined &&
    !formats.some((format) => ["jpeg", "webp"].includes(format))
  ) {
    usage("--quality requires a JPEG or WebP output");
  }
  if (textMode !== undefined && !formats.includes("svg")) {
    usage("--text-mode requires an SVG output");
  }
  if (density !== undefined && formats.every((format) => format === "svg")) {
    usage("--density requires a raster output");
  }
  if (matte !== undefined && formats.every((format) => format === "svg")) {
    usage("--matte requires a raster output");
  }

  const parsedDensity =
    density === undefined ? undefined : positiveInteger(density, "density");
  const parsedQuality =
    quality === undefined ? undefined : finite(quality, "quality");
  if (parsedQuality !== undefined && (parsedQuality < 0 || parsedQuality > 1)) {
    usage("--quality must be between 0 and 1");
  }

  const outputs = paths.map((path, index): RenderOutputRequest => {
    const format = formats[index];
    const target = path === "-" ? {} : { path };
    if (format === "svg") {
      return {
        ...target,
        format: "svg",
        ...(textMode === undefined ? {} : { textMode }),
      };
    }
    const raster = {
      ...target,
      ...(parsedDensity === undefined ? {} : { density: parsedDensity }),
      ...(matte === undefined ? {} : { matte }),
    };
    if (format === "jpeg") {
      return {
        ...raster,
        format: "jpeg",
        ...(parsedQuality === undefined ? {} : { quality: parsedQuality }),
      };
    }
    if (format === "webp") {
      return {
        ...raster,
        format: "webp",
        ...(parsedQuality === undefined ? {} : { quality: parsedQuality }),
      };
    }
    if (format === "png") return { ...raster, format: "png" };
    return { ...raster, format: "raw" };
  });
  return { outputs, stdoutOutput: paths.includes("-") };
}

function parseFonts(raw: RawArguments): readonly {
  readonly family: string;
  readonly sources: readonly string[];
}[] {
  const families = new Map<string, string[]>();
  for (const item of raw.values.get("font") ?? []) {
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      usage("--font must use family=path");
    }
    const family = item.slice(0, separator);
    const path = item.slice(separator + 1);
    const sources = families.get(family) ?? [];
    sources.push(path);
    families.set(family, sources);
  }
  return [...families].map(([family, sources]) => ({ family, sources }));
}

export async function parseCLIArguments(
  argv: readonly string[],
): Promise<ParsedCLI> {
  const raw = tokenize(argv);
  if (raw.booleans.has("help") || argv.length === 0) return { command: "help" };
  if (raw.booleans.has("version")) return { command: "version" };

  if (raw.positionals[0] !== "render") {
    usage('Expected the "render" subcommand');
  }
  if (raw.positionals.length !== 2 || !raw.positionals[1]) {
    usage("Usage: ptsjs render <source> --out <destination>");
  }

  const limits = parseLimits(raw);
  const effectiveLimits = { ...DEFAULT_RENDER_RESOURCE_LIMITS, ...limits };
  const { outputs, stdoutOutput } = parseOutputs(raw);
  const json = raw.booleans.has("json");
  if (json && stdoutOutput) {
    usage("--json cannot be combined with --out -");
  }

  const sizeValue = one(raw, "size");
  let size: { width: number; height: number } | undefined;
  if (sizeValue !== undefined) {
    const match = /^(\d+)x(\d+)$/i.exec(sizeValue);
    if (!match) usage("--size must use WIDTHxHEIGHT");
    size = {
      width: positiveInteger(match[1] ?? "", "size width"),
      height: positiveInteger(match[2] ?? "", "size height"),
    };
  }

  const pointerValue = one(raw, "pointer");
  let pointer: readonly [number, number] | undefined;
  if (pointerValue !== undefined) {
    const parts = pointerValue.split(",");
    if (parts.length !== 2) usage("--pointer must use X,Y");
    pointer = [
      finite(parts[0] ?? "", "pointer x"),
      finite(parts[1] ?? "", "pointer y"),
    ];
  }

  const time = one(raw, "time");
  const frame = one(raw, "frame");
  const fps = one(raw, "fps");
  if (time !== undefined && frame !== undefined) {
    usage("--time and --frame are mutually exclusive");
  }
  if (fps !== undefined && frame === undefined) usage("--fps requires --frame");
  let render: RenderSceneOptions["render"];
  if (frame !== undefined) {
    render = {
      mode: "frame",
      frame: nonNegativeInteger(frame, "frame"),
      ...(fps === undefined ? {} : { fps: finite(fps, "fps") }),
    };
  } else {
    const parsedTime = time === undefined ? 0 : finite(time, "time");
    if (parsedTime < 0) usage("--time must not be negative");
    render = { mode: "direct", time: parsedTime };
  }

  const loader = one(raw, "loader") ?? "auto";
  if (loader !== "auto" && loader !== "scene" && loader !== "pts-demo") {
    usage('--loader must be "auto", "scene", or "pts-demo"');
  }
  const renderer = one(raw, "renderer") ?? "cpu";
  if (renderer !== "cpu" && renderer !== "auto" && renderer !== "gpu") {
    usage('--renderer must be "cpu", "auto", or "gpu"');
  }
  const events = await parseEvents(raw, effectiveLimits.maxInputBytes);
  const background = one(raw, "background");
  const seed = one(raw, "seed");
  const assetRoot = one(raw, "asset-root");

  return {
    command: "render",
    source: raw.positionals[1],
    options: {
      loader,
      ...(size === undefined ? {} : { size }),
      ...(background === undefined ? {} : { background }),
      ...(pointer === undefined ? {} : { pointer }),
      render,
      ...(events === undefined ? {} : { events }),
      ...(seed === undefined ? {} : { seed }),
      params: await parseParams(raw, effectiveLimits.maxInputBytes),
      ...(assetRoot === undefined ? {} : { assetRoot }),
      allowNet: raw.booleans.has("allow-net"),
      fonts: parseFonts(raw),
      renderer,
      limits,
      outputs,
      timeoutMs:
        one(raw, "timeout") === undefined
          ? 30_000
          : positiveInteger(one(raw, "timeout") ?? "", "timeout"),
      overwrite: raw.booleans.has("force"),
    },
    json,
    quiet: raw.booleans.has("quiet"),
    debug: raw.booleans.has("debug"),
    stdoutOutput,
  };
}
