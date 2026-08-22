import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/scene.ts",
    "src/browser.ts",
    "src/cli.ts",
    "src/worker.ts",
  ],
  format: ["esm", "cjs"],
  platform: "node",
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  banner: {
    dts: '/// <reference lib="dom" />',
  },
  deps: {
    neverBundle: ["pts", "skia-canvas"],
  },
});
