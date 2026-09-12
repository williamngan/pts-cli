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
      0.5956874489784241, 0.849919724278152, 0.9860693418886513,
      0.8299868844915181, 0.9579014552291483,
    ]);
    expect(Array.from({ length: 5 }, () => legacy())).toEqual([
      0.4027005659881979, 0.48452916787937284, 0.5601703440770507,
      0.6603907456155866, 0.19753041537478566,
    ]);
  });
});
