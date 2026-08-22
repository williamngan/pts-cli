import { describe, expect, it } from "vitest";

import {
  deserializePtsRenderError,
  PtsRenderError,
  serializePtsRenderError,
} from "../src/PtsRenderError.js";

describe("structured render errors", () => {
  it("preserves bounded cause diagnostics across the worker protocol", () => {
    const original = new PtsRenderError(
      "SCENE_FAILED",
      "setup",
      "Scene setup failed",
      { cause: new TypeError("fixture exploded") },
    );

    const serialized = serializePtsRenderError(original, true);
    expect(serialized.cause).toMatchObject({
      name: "TypeError",
      message: "fixture exploded",
    });
    expect(serialized.cause?.stack).toContain("fixture exploded");

    const restored = deserializePtsRenderError(serialized);
    expect(restored.cause).toMatchObject({
      name: "TypeError",
      message: "fixture exploded",
    });
    expect(serializePtsRenderError(restored).cause).toEqual({
      name: "TypeError",
      message: "fixture exploded",
    });
  });

  it("serializes hostile thrown values without invoking unsafe coercion", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("property trap");
        },
        getPrototypeOf() {
          throw new Error("prototype trap");
        },
      },
    );

    expect(serializePtsRenderError(hostile)).toMatchObject({
      code: "SCENE_FAILED",
      message: "An uninspectable value was thrown",
      cause: {
        name: "Error",
        message: "An uninspectable value was thrown",
      },
    });
  });

  it("makes arbitrary details bounded and JSON-safe without invoking accessors", () => {
    let getterCalls = 0;
    const details: Record<string, unknown> = {
      count: 12n,
      invalidNumber: Number.NaN,
    };
    details.self = details;
    Object.defineProperty(details, "unsafe", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    const error = new PtsRenderError(
      "SCENE_FAILED",
      "setup",
      "unsafe details",
      { details },
    );

    const serialized = serializePtsRenderError(error);
    expect(serialized.details).toMatchObject({
      count: "12n",
      invalidNumber: "NaN",
      self: "[Circular]",
      unsafe: "[Accessor omitted]",
    });
    expect(getterCalls).toBe(0);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });
});
