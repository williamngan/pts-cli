import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

describe("classic compatibility manifest", () => {
  it("pins the published Pts release and verifies every vendored source and asset", async () => {
    const manifest = JSON.parse(
      await readFile("compatibility/pts-revamp.json", "utf8"),
    ) as {
      schemaVersion: unknown;
      pts: { version: unknown; commit: unknown };
      demos: Record<string, Record<string, unknown>>;
      assets: Record<string, string>;
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.pts).toEqual(
      expect.objectContaining({
        version: "1.0.0",
        commit: "034e5f6ac8bcf54d2121ef88799ac43fc4b2c827",
      }),
    );
    expect(Object.keys(manifest.demos).length).toBeGreaterThanOrEqual(20);

    const statuses = new Set([
      "supported",
      "supported-with-input",
      "partial",
      "unsupported",
      "not-applicable",
    ]);
    for (const [name, entry] of Object.entries(manifest.demos)) {
      expect(name).toMatch(/\.js$/);
      expect(entry.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      const source = await readFile("test/fixtures/pts-1.0.0/demo/" + name);
      expect(createHash("sha256").update(source).digest("hex")).toBe(
        entry.sourceSha256,
      );
      expect(statuses).toContain(entry.status);
      if (entry.status === "supported-with-input") {
        expect(entry.events).toMatch(/^events\/.+\.json$/);
      }
      if (
        entry.status === "partial" ||
        entry.status === "unsupported" ||
        entry.status === "not-applicable"
      ) {
        expect(entry.reason).toEqual(expect.any(String));
        expect(entry.expectedErrorCode).toEqual(expect.any(String));
      }
    }
    for (const [name, hash] of Object.entries(manifest.assets)) {
      const asset = await readFile("test/fixtures/pts-1.0.0/" + name);
      expect(createHash("sha256").update(asset).digest("hex")).toBe(hash);
    }
  });
});
