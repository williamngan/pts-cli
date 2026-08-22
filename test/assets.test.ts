import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { NodeSceneAssets } from "../src/NodeSceneAssets.js";
import { DEFAULT_RENDER_RESOURCE_LIMITS } from "../src/renderTypes.js";

const squareSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3"/></svg>';
const systemFont = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  join(process.env.SystemRoot ?? "C:\\Windows", "Fonts", "arial.ttf"),
].find((path) => existsSync(path));

function createAssets(root: string): NodeSceneAssets {
  const rootURL = pathToFileURL(root + sep);
  return new NodeSceneAssets({
    baseURL: new URL("scene.mjs", rootURL),
    rootURL,
    allowNet: false,
    limits: { ...DEFAULT_RENDER_RESOURCE_LIMITS },
    signal: new AbortController().signal,
  });
}

describe("Node scene assets", () => {
  it("loads bounded data URLs without exposing their payload in errors", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "pts-cli-assets-"));
    const assets = createAssets(temporary);
    try {
      const source = "data:image/svg+xml," + encodeURIComponent(squareSvg);
      const image = await assets.image(source);
      expect([image.width, image.height]).toEqual([2, 3]);
      await assets.settle();
    } finally {
      await assets.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("allows a failed image load to be retried successfully", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "pts-cli-assets-"));
    const assets = createAssets(temporary);
    try {
      await expect(assets.image("./late.svg")).rejects.toMatchObject({
        code: "ASSET_NOT_FOUND",
      });
      await writeFile(join(temporary, "late.svg"), squareSvg);
      const image = await assets.image("./late.svg");
      expect([image.width, image.height]).toEqual([2, 3]);
      await assets.settle();
    } finally {
      await assets.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("confines explicit roots lexically and through file symlinks", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "pts-cli-assets-"));
    const root = join(temporary, "root");
    const outside = join(temporary, "outside.svg");
    await mkdir(root);
    await writeFile(outside, squareSvg);
    const assets = createAssets(root);
    try {
      await expect(assets.image("../outside.svg")).rejects.toMatchObject({
        code: "ASSET_NOT_FOUND",
        message: expect.stringContaining("outside the explicit asset root"),
      });

      if (process.platform !== "win32") {
        await symlink(outside, join(root, "escape.svg"));
        await expect(assets.image("./escape.svg")).rejects.toMatchObject({
          code: "ASSET_NOT_FOUND",
          message: expect.stringContaining("symlink resolves outside"),
        });
      }
    } finally {
      await assets.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("redacts URL credentials when network access is denied", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "pts-cli-assets-"));
    const assets = createAssets(temporary);
    try {
      const rejected = assets.image(
        "https://user:password@example.com/image.png?token=secret",
      );
      await expect(rejected).rejects.toMatchObject({
        code: "ASSET_NETWORK_DISABLED",
      });
      await rejected.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("password");
        expect(message).not.toContain("secret");
      });
    } finally {
      await assets.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("deduplicates identical pending font registrations and rejects conflicts", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "pts-cli-assets-"));
    const assets = createAssets(temporary);
    try {
      const first = assets.font({
        family: "Fixture Pending",
        sources: ["./missing-a.ttf"],
      });
      const duplicate = assets.font({
        family: "Fixture Pending",
        sources: ["./missing-a.ttf"],
      });
      expect(duplicate).toBe(first);

      await expect(
        assets.font({
          family: "Fixture Pending",
          sources: ["./missing-b.ttf"],
        }),
      ).rejects.toMatchObject({ code: "FONT_REGISTRATION_FAILED" });
      await expect(first).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    } finally {
      await assets.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it.skipIf(systemFont === undefined)(
    "registers a real local font and makes identical registration idempotent",
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), "pts-cli-assets-"));
      const assets = new NodeSceneAssets({
        baseURL: pathToFileURL(temporary + sep),
        allowNet: false,
        limits: { ...DEFAULT_RENDER_RESOURCE_LIMITS },
        signal: new AbortController().signal,
      });
      try {
        const options = {
          family: "Pts CLI Fixture Font",
          sources: [pathToFileURL(systemFont as string)],
        };
        const first = assets.font(options);
        const duplicate = assets.font(options);
        expect(duplicate).toBe(first);
        await first;
        await assets.settle();
      } finally {
        await assets.dispose();
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
});
