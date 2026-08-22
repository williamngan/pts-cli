import type { JsonValue, PtsScene } from "./scene.js";

const sceneKeys = new Set([
  "apiVersion",
  "name",
  "description",
  "metadata",
  "width",
  "height",
  "background",
  "assetBaseURL",
  "setup",
]);
const forbiddenJsonKeys = new Set(["__proto__", "constructor", "prototype"]);

function fail(path: string, message: string): never {
  throw new TypeError(path + " " + message);
}

function descriptorsOf(
  value: object,
  path: string,
): Record<PropertyKey, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    throw new TypeError(path + " could not be inspected", { cause: error });
  }
}

function prototypeOf(value: object, path: string): object | null {
  try {
    return Object.getPrototypeOf(value) as object | null;
  } catch (error) {
    throw new TypeError(path + " could not be inspected", { cause: error });
  }
}

function plainObjectDescriptors(
  value: unknown,
  path: string,
): Record<string, PropertyDescriptor> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be a plain object");
  }
  const prototype = prototypeOf(value, path);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "must be a plain object");
  }

  const descriptors = descriptorsOf(value, path);
  const result: Record<string, PropertyDescriptor> = Object.create(
    null,
  ) as Record<string, PropertyDescriptor>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") fail(path, "must not contain symbol keys");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      fail(path + "." + key, "must be an own data property");
    }
    result[key] = descriptor;
  }
  return result;
}

function descriptorValue(
  descriptors: Record<string, PropertyDescriptor>,
  key: string,
): unknown {
  return descriptors[key]?.value;
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") {
    fail(path, "must be a string");
  }
}

function assertOptionalDimension(value: unknown, path: string): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || (value as number) <= 0)
  ) {
    fail(path, "must be a positive safe integer");
  }
}

function cloneJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must contain only finite numbers");
    return value;
  }
  if (value === null || typeof value !== "object") {
    fail(path, "must be JSON-compatible");
  }
  if (ancestors.has(value)) fail(path, "must not contain a cycle");
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (prototypeOf(value, path) !== Array.prototype) {
        fail(path, "must be a plain array");
      }
      const descriptors = descriptorsOf(value, path);
      const allowed = new Set<string>(["length"]);
      const copy: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        allowed.add(key);
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
          fail(path + "[" + key + "]", "must not be sparse or accessor-backed");
        }
        copy.push(
          cloneJsonValue(descriptor.value, path + "[" + key + "]", ancestors),
        );
      }
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== "string" || !allowed.has(key)) {
          fail(path, "must not contain extra array properties");
        }
      }
      return Object.freeze(copy);
    }

    const descriptors = plainObjectDescriptors(value, path);
    const copy: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (forbiddenJsonKeys.has(key)) {
        fail(path + "." + key, "uses a forbidden key");
      }
      copy[key] = cloneJsonValue(descriptor.value, path + "." + key, ancestors);
    }
    return Object.freeze(copy);
  } finally {
    ancestors.delete(value);
  }
}

/** Validate, deeply clone, and freeze a JSON-compatible object. */
export function snapshotJsonObject(
  value: unknown,
  path: string,
): Readonly<Record<string, JsonValue>> {
  plainObjectDescriptors(value, path);
  return cloneJsonValue(value, path, new Set()) as Readonly<
    Record<string, JsonValue>
  >;
}

export function validateScene(value: unknown, path = "scene"): PtsScene {
  const descriptors = plainObjectDescriptors(value, path);
  for (const key of Object.keys(descriptors)) {
    if (!sceneKeys.has(key)) fail(path + "." + key, "is not a supported key");
  }

  const apiVersion = descriptorValue(descriptors, "apiVersion");
  const name = descriptorValue(descriptors, "name");
  const description = descriptorValue(descriptors, "description");
  const background = descriptorValue(descriptors, "background");
  const width = descriptorValue(descriptors, "width");
  const height = descriptorValue(descriptors, "height");
  const assetBaseURL = descriptorValue(descriptors, "assetBaseURL");
  const setup = descriptorValue(descriptors, "setup");
  const metadata = descriptorValue(descriptors, "metadata");

  if (apiVersion !== undefined && apiVersion !== 1) {
    fail(path + ".apiVersion", "must be 1 when provided");
  }
  assertOptionalString(name, path + ".name");
  assertOptionalString(description, path + ".description");
  assertOptionalString(background, path + ".background");
  assertOptionalDimension(width, path + ".width");
  assertOptionalDimension(height, path + ".height");
  if ((width === undefined) !== (height === undefined)) {
    fail(path, "must provide width and height together");
  }

  if (
    assetBaseURL !== undefined &&
    typeof assetBaseURL !== "string" &&
    !(assetBaseURL instanceof URL)
  ) {
    fail(path + ".assetBaseURL", "must be a string or URL");
  }
  if (typeof assetBaseURL === "string") {
    try {
      new URL(assetBaseURL, "file:///");
    } catch {
      fail(path + ".assetBaseURL", "must be a valid URL reference");
    }
  }
  if (typeof setup !== "function") {
    fail(path + ".setup", "must be a function");
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    normalized[key] = descriptorValue(descriptors, key);
  }
  if (metadata !== undefined) {
    normalized.metadata = snapshotJsonObject(metadata, path + ".metadata");
  }
  if (assetBaseURL instanceof URL) {
    normalized.assetBaseURL = new URL(assetBaseURL.href);
  }
  return Object.freeze(normalized) as unknown as PtsScene;
}
