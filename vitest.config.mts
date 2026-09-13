import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // These entry points run in the separate CLI/Chromium smoke suites.
      exclude: [
        "src/browser.ts",
        "src/cli.ts",
        "src/worker.ts",
        "src/**/*.d.ts",
      ],
      reporter: ["text", "html", "json-summary"],
      thresholds: { lines: 82, statements: 80, functions: 85, branches: 70 },
    },
  },
});
