import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("classic compatibility manifest", () => {
  it("pins the reviewed revamp commit and auditable demo records", async () => {
    const manifest = JSON.parse(
      await readFile("compatibility/pts-revamp.json", "utf8"),
    ) as {
      schemaVersion: unknown;
      pts: { branch: unknown; commit: unknown };
      demos: Record<string, Record<string, unknown>>;
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.pts).toEqual(
      expect.objectContaining({
        branch: "revamp",
        commit: "77420f143928d614766f13d56b2a8d7b00c44b24",
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
  });
});
