import { describe, expect, it } from "vitest";

import { createSeededRandom, effectivePtsSeed } from "../src/random.js";
import { defineScene } from "../src/scene.js";
import { snapshotJsonObject, validateScene } from "../src/sceneValidation.js";

describe("portable scene contract", () => {
  it("keeps defineScene as a browser-safe identity helper", () => {
    const scene = {
      apiVersion: 1 as const,
      width: 20,
      height: 10,
      run() {},
    };

    expect(defineScene(scene)).toBe(scene);
  });

  it("validates the schema and rejects unknown top-level keys", () => {
    const scene = validateScene({
      name: "fixture",
      metadata: { nested: [1, true, null] },
      run() {},
    });
    expect(scene.name).toBe("fixture");

    expect(() =>
      validateScene({
        run() {},
        output: "scene.png",
      }),
    ).toThrow(/scene\.output is not a supported key/);
    expect(() => validateScene({ apiVersion: 2, run() {} })).toThrow(
      /apiVersion/,
    );
    expect(() => validateScene({ width: 1.5, run() {} })).toThrow(/width/);
  });

  it("accepts a run function as the complete render file", () => {
    const run = () => undefined;
    const scene = validateScene(run);

    expect(scene.run).toBe(run);
    expect(scene.width).toBeUndefined();
    expect(scene.height).toBeUndefined();
  });

  it("rejects non-JSON metadata and cycles with an inspectable path", () => {
    expect(() =>
      validateScene({ metadata: { value: Number.NaN }, run() {} }),
    ).toThrow(/metadata\.value/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => validateScene({ metadata: cyclic, run() {} })).toThrow(
      /must not contain a cycle/,
    );
  });

  it("requires paired dimensions and plain, own data properties", () => {
    expect(() => validateScene({ width: 10, run() {} })).toThrow(
      /width and height together/,
    );
    expect(() =>
      validateScene(Object.assign(new (class Scene {})(), { run() {} })),
    ).toThrow(/plain object/);
    expect(() => validateScene({ run() {}, [Symbol("extra")]: true })).toThrow(
      /symbol keys/,
    );

    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "run", {
      get() {
        getterCalls += 1;
        return () => undefined;
      },
    });
    expect(() => validateScene(accessor)).toThrow(/data property/);
    expect(getterCalls).toBe(0);
  });

  it("snapshots parameters as deeply frozen JSON without invoking accessors", () => {
    const source = { count: 1, nested: [true, { label: "ok" }] };
    const snapshot = snapshotJsonObject(source, "params");
    source.count = 2;

    expect(snapshot).toEqual({
      count: 1,
      nested: [true, { label: "ok" }],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);

    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    expect(() => snapshotJsonObject(accessor, "params")).toThrow(
      /data property/,
    );
    expect(getterCalls).toBe(0);
  });

  it("pins effective seed normalization and independent Math streams", () => {
    expect(effectivePtsSeed(" \tla\nunch\r ")).toBe("launch");

    const worker = createSeededRandom("launch", "worker-math");
    const legacy = createSeededRandom("launch", "legacy-math");
    expect(Array.from({ length: 5 }, () => worker())).toEqual([
      0.5881819310598075, 0.2797951474785805, 0.615730247925967,
      0.282653056550771, 0.649848609464243,
    ]);
    expect(Array.from({ length: 5 }, () => legacy())).toEqual([
      0.4036802598275244, 0.9467446603812277, 0.5651803885120898,
      0.28884741733781993, 0.1255971638020128,
    ]);
  });
});
