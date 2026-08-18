import { Bound, Pt, type IPlayer } from "pts";
import { describe, expect, it } from "vitest";

import {
  SkiaCanvasError,
  SkiaCanvasSpace,
  UnsupportedOperationError,
} from "../src/index.js";
import { pixelAt } from "./helpers/pixels.js";

describe("SkiaCanvasSpace lifecycle", () => {
  it("constructs a ready space and initializes its background", async () => {
    const space = new SkiaCanvasSpace(12, 8, {
      background: "#123456",
      id: "fixture",
    });

    expect(space.id).toBe("fixture");
    expect(space.ready).toBe(true);
    expect(space.width).toBe(12);
    expect(space.height).toBe(8);
    expect(space.size.toArray()).toEqual([12, 8]);
    expect(space.center.toArray()).toEqual([6, 4]);
    expect(space.pointer.toArray()).toEqual([6, 4]);
    expect(space.canvas.width).toBe(12);
    expect(space.canvas.height).toBe(8);

    const raw = await space.toBuffer("raw");
    expect(pixelAt(raw, 12, 0, 0)).toEqual([18, 52, 86, 255]);
  });

  it.each([
    [0, 10],
    [-1, 10],
    [1.5, 10],
    [Number.NaN, 10],
    [10, Number.POSITIVE_INFINITY],
  ])("rejects invalid dimensions %s by %s", (width, height) => {
    expect(() => new SkiaCanvasSpace(width, height)).toThrow(RangeError);
  });

  it("runs resize, start, and deterministic animate callbacks", () => {
    const calls: string[] = [];
    const frames: Array<[number, number]> = [];
    const space = new SkiaCanvasSpace(20, 10);

    space.add({
      resize(bound) {
        calls.push("resize:" + bound.width + "x" + bound.height);
      },
      start(bound, current) {
        calls.push("start:" + bound.width + "x" + current.height);
      },
      animate(time, delta) {
        calls.push("animate");
        frames.push([time, delta]);
      },
    });

    expect(calls).toEqual(["resize:20x10", "start:20x10"]);

    space.renderFrame(100).renderFrame(116);
    space.renderFrame(90, { delta: 5 });

    expect(frames).toEqual([
      [100, 0],
      [116, 16],
      [90, 5],
    ]);
    expect(space.isPlaying).toBe(false);
  });

  it("snapshots players so additions begin on the next frame", () => {
    const calls: string[] = [];
    const space = new SkiaCanvasSpace(10, 10);
    let added = false;

    space.add(() => {
      calls.push("first");
      if (!added) {
        added = true;
        space.add({
          start() {
            calls.push("second:start");
          },
          animate() {
            calls.push("second:animate");
          },
        });
      }
    });

    space.renderFrame();
    expect(calls).toEqual(["first", "second:start"]);

    space.renderFrame(1);
    expect(calls).toEqual(["first", "second:start", "first", "second:animate"]);
  });

  it("skips a snapshotted player removed before its turn", () => {
    const calls: string[] = [];
    const space = new SkiaCanvasSpace(10, 10);
    const removed: IPlayer = {
      animate() {
        calls.push("removed");
      },
    };

    space.add(() => {
      calls.push("first");
      space.remove(removed);
    });
    space.add(removed);
    space.renderFrame();

    expect(calls).toEqual(["first"]);
  });

  it("restores timing and state after a player throws", () => {
    const error = new Error("player failed");
    const space = new SkiaCanvasSpace(10, 10);
    space.add(() => {
      throw error;
    });

    expect(() => space.renderFrame(100)).toThrow(error);
    expect(space.isPlaying).toBe(false);

    space.removeAll();
    let observedDelta = -1;
    space.add((_time, delta) => {
      observedDelta = delta;
    });
    space.renderFrame(200);
    expect(observedDelta).toBe(0);
  });

  it("rejects recursive rendering and remains usable afterward", () => {
    const space = new SkiaCanvasSpace(10, 10);
    space.add(() => space.renderFrame(1));

    expect(() => space.renderFrame()).toThrowError(
      expect.objectContaining({ code: "FRAME_IN_PROGRESS" }),
    );
    expect(space.isPlaying).toBe(false);

    space.removeAll();
    expect(() => space.renderFrame()).not.toThrow();
  });

  it("supports refresh trails and one-frame clear overrides", async () => {
    const space = new SkiaCanvasSpace(8, 4, { refresh: false });
    const form = space.getForm();
    let x = 1;

    space.add(() => {
      form.fillOnly("#ff0000").point([x, 2], 1, "square");
      x += 3;
    });

    space.renderFrame();
    space.renderFrame(1);
    let raw = await space.toBuffer("raw");
    expect(pixelAt(raw, 8, 1, 2)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(raw, 8, 4, 2)).toEqual([255, 0, 0, 255]);

    space.renderFrame(2, { clear: true });
    raw = await space.toBuffer("raw");
    expect(pixelAt(raw, 8, 1, 2)[3]).toBe(0);
    expect(pixelAt(raw, 8, 7, 2)).toEqual([255, 0, 0, 255]);
  });

  it("resizes retained forms and notifies players without rendering", async () => {
    const space = new SkiaCanvasSpace(10, 10, {
      background: "#0000ff",
    });
    const form = space.getForm().fillOnly("#ff0000");
    let animateCount = 0;
    const sizes: number[][] = [];

    space.add({
      resize(bound) {
        sizes.push(bound.size.toArray());
      },
      animate() {
        animateCount += 1;
        form.point([15, 5], 2, "square");
      },
    });

    space.resize(20, 10);
    expect(animateCount).toBe(0);
    expect(sizes).toEqual([
      [10, 10],
      [20, 10],
    ]);
    expect(space.pointer.toArray()).toEqual([10, 5]);

    space.renderFrame();
    const raw = await space.toBuffer("raw");
    expect(pixelAt(raw, 20, 15, 5)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(raw, 20, 0, 0)).toEqual([0, 0, 255, 255]);
  });

  it("accepts a Pts Bound when resizing", () => {
    const space = new SkiaCanvasSpace(5, 5);
    const bound = new Bound(new Pt(2, 3), new Pt(14, 11));
    space.resize(bound);

    expect(space.width).toBe(12);
    expect(space.height).toBe(8);
    expect(space.outerBound.topLeft.toArray()).toEqual([2, 3]);
  });

  it("rejects browser scheduler methods with actionable errors", () => {
    const space = new SkiaCanvasSpace();

    expect(() => space.play()).toThrow(UnsupportedOperationError);
    expect(() => space.playOnce()).toThrow(/renderFrame/);
    expect(() => space.replay()).toThrow(/renderFrame/);
    expect(() => space.pause()).toThrow(/renderFrame/);
    expect(() => space.resume()).toThrow(/renderFrame/);
    expect(() => space.stop()).toThrow(/renderFrame/);
    expect(() => space.minFrameTime()).toThrow(/renderFrame/);
  });

  it("disposes idempotently and rejects subsequent adapter operations", () => {
    const space = new SkiaCanvasSpace();

    expect(space.dispose()).toBe(space);
    expect(space.dispose()).toBe(space);
    expect(space.ready).toBe(false);
    expect(() => space.renderFrame()).toThrow(SkiaCanvasError);
    expect(() => space.getForm()).toThrowError(
      expect.objectContaining({ code: "DISPOSED" }),
    );
  });
});
