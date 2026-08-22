import { describe, expect, it } from "vitest";

import {
  analyzeJavaScriptSource,
  selectAutomaticLoader,
} from "../src/sourceAnalysis.js";

describe("source loader analysis", () => {
  it("selects standard quickStart and advanced CanvasSpace demos", () => {
    expect(
      selectAutomaticLoader(
        `
          window.demoDescription = "fixture";
          const run = Pts.quickStart("#pt", "#fff");
          run(() => {});
        `,
        "quick-start.js",
      ),
    ).toBe("pts-demo");

    expect(
      selectAutomaticLoader(
        `
          Pts.namespace(this);
          const space = new CanvasSpace("#pt");
          space.add(() => {}).play();
        `,
        "advanced.js",
      ),
    ).toBe("pts-demo");
  });

  it("does not mistake comments, strings, or object keys for markers", () => {
    const source = `
      // Pts.quickStart("#pt")
      const message = "window.demoDescription = new CanvasSpace()";
      export default { setup() {}, message, "Pts.quickStart": true };
    `;

    expect(selectAutomaticLoader(source, "portable.mjs")).toBe("scene");
    expect(analyzeJavaScriptSource(source, "portable.mjs")).toMatchObject({
      classicMarkers: [],
      hasModuleSyntax: true,
      ptsRuntimeReferences: [],
    });
  });

  it("finds direct ESM, CommonJS, and literal dynamic Pts imports", () => {
    const analysis = analyzeJavaScriptSource(
      `
        import { Pt } from "pts";
        export { Group } from "pts/dist/index.mjs";
        const one = require("pts");
        const two = import("pts");
        const ignored = import(packageName);
      `,
      "imports.mjs",
    );

    expect(analysis.ptsRuntimeReferences).toEqual([
      "pts",
      "pts/dist/index.mjs",
    ]);
  });

  it("recognizes CommonJS scenes and rejects genuinely ambiguous sources", () => {
    expect(
      selectAutomaticLoader(`module.exports = { setup() {} };`, "portable.cjs"),
    ).toBe("scene");

    expect(() =>
      selectAutomaticLoader(
        `
          export default { setup() {} };
          Pts.quickStart("#pt");
        `,
        "ambiguous.mjs",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "LOADER_AMBIGUOUS",
        phase: "load",
      }),
    );
  });

  it("reports syntax failures without evaluating the source", () => {
    expect(() =>
      selectAutomaticLoader(`throw new Error("must not execute")`, "safe.js"),
    ).not.toThrow();
    expect(() =>
      selectAutomaticLoader("function {", "invalid.js"),
    ).toThrowError(
      expect.objectContaining({ code: "SCENE_INVALID", phase: "load" }),
    );
  });
});
