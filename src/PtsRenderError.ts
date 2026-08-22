export type PtsRenderPhase =
  | "arguments"
  | "load"
  | "validate"
  | "setup"
  | "input"
  | "frame"
  | "export"
  | "cleanup"
  | "commit";

export type PtsRenderErrorCode =
  | "ASSET_LIMIT"
  | "ASSET_NETWORK_DISABLED"
  | "ASSET_NOT_FOUND"
  | "CLI_USAGE"
  | "COMPAT_API_UNSUPPORTED"
  | "FONT_REGISTRATION_FAILED"
  | "INPUT_TIMELINE_INVALID"
  | "LOADER_AMBIGUOUS"
  | "NATIVE_RENDER_FAILED"
  | "OUTPUT_COMMIT_FAILED"
  | "OUTPUT_EXISTS"
  | "OUTPUT_FORMAT_UNSUPPORTED"
  | "OUTPUT_OPTION_INVALID"
  | "OUTPUT_TARGET_INVALID"
  | "PTS_INCOMPATIBLE"
  | "PTS_INSTANCE_MISMATCH"
  | "RENDER_ABORTED"
  | "RENDER_TIMEOUT"
  | "RENDERER_UNAVAILABLE"
  | "RESOURCE_LIMIT"
  | "SCENE_API_UNSUPPORTED"
  | "SCENE_FAILED"
  | "SCENE_INVALID"
  | "SOURCE_NOT_FOUND"
  | "WORKER_FAILED";

export interface PtsRenderErrorOptions {
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly hint?: string;
}

export class PtsRenderError extends Error {
  readonly code: PtsRenderErrorCode;
  readonly phase: PtsRenderPhase;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly hint?: string;

  constructor(
    code: PtsRenderErrorCode,
    phase: PtsRenderPhase,
    message: string,
    options: PtsRenderErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "PtsRenderError";
    this.code = code;
    this.phase = phase;
    if (options.details !== undefined) this.details = options.details;
    if (options.hint !== undefined) this.hint = options.hint;
  }
}

export interface SerializedPtsRenderError {
  readonly name: "PtsRenderError";
  readonly code: PtsRenderErrorCode;
  readonly phase: PtsRenderPhase;
  readonly message: string;
  readonly cause?: SerializedErrorCause;
  readonly details?: Readonly<Record<string, SerializedDetailValue>>;
  readonly hint?: string;
  readonly stack?: string;
}

export type SerializedDetailValue =
  | boolean
  | number
  | string
  | null
  | readonly SerializedDetailValue[]
  | { readonly [key: string]: SerializedDetailValue };

export interface SerializedErrorCause {
  readonly name: string;
  readonly message: string;
  readonly cause?: SerializedErrorCause;
  readonly stack?: string;
}

function safeProperty(value: unknown, key: PropertyKey): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "An uninspectable value was thrown";
  }
}

function thrownMessage(value: unknown): string {
  const message = safeProperty(value, "message");
  return typeof message === "string" ? message : safeString(value);
}

function serializeErrorCause(
  value: unknown,
  includeStack: boolean,
  ancestors: Set<object>,
  depth: number,
): SerializedErrorCause {
  const isObject =
    value !== null &&
    (typeof value === "object" || typeof value === "function");
  if (isObject && ancestors.has(value)) {
    return { name: "Error", message: "Circular error cause" };
  }
  if (isObject) ancestors.add(value);

  try {
    const rawName = safeProperty(value, "name");
    const name =
      typeof rawName === "string" && rawName.length > 0
        ? rawName
        : isObject
          ? "Error"
          : "ThrownValue";
    const result: {
      name: string;
      message: string;
      cause?: SerializedErrorCause;
      stack?: string;
    } = { name, message: thrownMessage(value) };
    const stack = safeProperty(value, "stack");
    if (includeStack && typeof stack === "string") result.stack = stack;
    const cause = safeProperty(value, "cause");
    if (cause !== undefined && depth < 4) {
      result.cause = serializeErrorCause(
        cause,
        includeStack,
        ancestors,
        depth + 1,
      );
    }
    return result;
  } finally {
    if (isObject) ancestors.delete(value);
  }
}

function deserializeErrorCause(value: SerializedErrorCause): Error {
  const cause =
    value.cause === undefined ? undefined : deserializeErrorCause(value.cause);
  const error = new Error(
    value.message,
    cause === undefined ? undefined : { cause },
  );
  error.name = value.name;
  if (value.stack !== undefined) error.stack = value.stack;
  return error;
}

interface DetailState {
  readonly ancestors: Set<object>;
  nodes: number;
}

function sanitizeDetail(
  value: unknown,
  state: DetailState,
  depth: number,
): SerializedDetailValue {
  state.nodes += 1;
  if (state.nodes > 1_000) return "[Detail limit reached]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= 16_384
      ? value
      : value.slice(0, 16_384) + "[truncated]";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") return value.toString() + "n";
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "symbol") return "[Symbol]";
  if (typeof value === "function") return "[Function]";
  if (depth >= 6) return "[Detail depth limit reached]";
  if (state.ancestors.has(value)) return "[Circular]";
  state.ancestors.add(value);

  try {
    const errorName = safeProperty(value, "name");
    const errorMessage = safeProperty(value, "message");
    if (typeof errorName === "string" && typeof errorMessage === "string") {
      return { name: errorName, message: errorMessage };
    }

    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return "[Uninspectable object]";
    }

    let isArray = false;
    try {
      isArray = Array.isArray(value);
    } catch {
      return "[Uninspectable object]";
    }
    if (isArray) {
      const rawLength = descriptors.length?.value;
      const length =
        typeof rawLength === "number" && Number.isSafeInteger(rawLength)
          ? rawLength
          : 0;
      const result: SerializedDetailValue[] = [];
      for (let index = 0; index < Math.min(length, 100); index += 1) {
        const descriptor = descriptors[String(index)];
        result.push(
          descriptor !== undefined && "value" in descriptor
            ? sanitizeDetail(descriptor.value, state, depth + 1)
            : "[Empty]",
        );
      }
      if (length > 100) result.push("[Array truncated]");
      return result;
    }

    const result: Record<string, SerializedDetailValue> = Object.create(
      null,
    ) as Record<string, SerializedDetailValue>;
    const keys = Reflect.ownKeys(descriptors).filter(
      (key): key is string => typeof key === "string",
    );
    for (const key of keys.slice(0, 100)) {
      const descriptor = descriptors[key];
      result[key] =
        descriptor !== undefined && "value" in descriptor
          ? sanitizeDetail(descriptor.value, state, depth + 1)
          : "[Accessor omitted]";
    }
    if (keys.length > 100) result.$truncated = "[Object truncated]";
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

function sanitizeDetails(
  value: unknown,
): Readonly<Record<string, SerializedDetailValue>> {
  const sanitized = sanitizeDetail(
    value,
    { ancestors: new Set(), nodes: 0 },
    0,
  );
  if (
    sanitized !== null &&
    typeof sanitized === "object" &&
    !Array.isArray(sanitized)
  ) {
    return sanitized as Readonly<Record<string, SerializedDetailValue>>;
  }
  return Object.freeze({ value: sanitized });
}

export function serializePtsRenderError(
  error: unknown,
  includeStack = false,
): SerializedPtsRenderError {
  let isRenderError = false;
  try {
    isRenderError = error instanceof PtsRenderError;
  } catch {
    // Treat values with hostile prototype traps as ordinary thrown values.
  }
  const normalized = isRenderError
    ? (error as PtsRenderError)
    : new PtsRenderError("SCENE_FAILED", "setup", thrownMessage(error), {
        cause: error,
      });
  const serialized: {
    name: "PtsRenderError";
    code: PtsRenderErrorCode;
    phase: PtsRenderPhase;
    message: string;
    cause?: SerializedErrorCause;
    details?: Readonly<Record<string, SerializedDetailValue>>;
    hint?: string;
    stack?: string;
  } = {
    name: "PtsRenderError",
    code: normalized.code,
    phase: normalized.phase,
    message: normalized.message,
  };
  if (normalized.cause !== undefined) {
    serialized.cause = serializeErrorCause(
      normalized.cause,
      includeStack,
      new Set(),
      0,
    );
  }
  if (normalized.details !== undefined) {
    serialized.details = sanitizeDetails(normalized.details);
  }
  if (normalized.hint !== undefined) serialized.hint = normalized.hint;
  if (includeStack && normalized.stack) serialized.stack = normalized.stack;
  return serialized;
}

export function deserializePtsRenderError(
  value: SerializedPtsRenderError,
): PtsRenderError {
  const options: PtsRenderErrorOptions = {};
  if (value.details !== undefined) {
    (options as { details?: Readonly<Record<string, unknown>> }).details =
      value.details;
  }
  if (value.hint !== undefined) {
    (options as { hint?: string }).hint = value.hint;
  }
  if (value.cause !== undefined) {
    (options as { cause?: unknown }).cause = deserializeErrorCause(value.cause);
  }
  const error = new PtsRenderError(
    value.code,
    value.phase,
    value.message,
    options,
  );
  if (value.stack !== undefined) error.stack = value.stack;
  return error;
}
