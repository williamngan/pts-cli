import { existsSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { NodeSceneAssets } from "../src/NodeSceneAssets.js";
import {
  DEFAULT_RENDER_RESOURCE_LIMITS,
  type RenderResourceLimits,
} from "../src/renderTypes.js";

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

async function withNetworkAssets(
  handler: RequestListener,
  check: (
    assets: NodeSceneAssets,
    root: URL,
    controller: AbortController,
  ) => Promise<void>,
  limits: Partial<RenderResourceLimits> = {},
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing test port");
  const root = new URL("http://127.0.0.1:" + address.port + "/assets/");
  const controller = new AbortController();
  const assets = new NodeSceneAssets({
    baseURL: root,
    rootURL: root,
    allowNet: true,
    limits: { ...DEFAULT_RENDER_RESOURCE_LIMITS, ...limits },
    signal: controller.signal,
  });
  try {
    await check(assets, root, controller);
  } finally {
    controller.abort();
    await assets.dispose();
    const closed = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await closed;
  }
}

describe("Node scene assets", () => {
  it("follows bounded local HTTP redirects and deduplicates pending images", async () => {
    const requests: string[] = [];
    await withNetworkAssets(
      (request, response) => {
        requests.push(request.url ?? "");
        if (request.url === "/assets/start.svg") {
          response.writeHead(302, { location: "image.svg" });
          response.end("redirect");
        } else {
          response.writeHead(200, { "content-type": "image/svg+xml" });
          response.end(squareSvg);
        }
      },
      async (assets) => {
        const first = assets.image("start.svg");
        expect(assets.image("start.svg")).toBe(first);
        const image = await first;
        expect([image.width, image.height]).toEqual([2, 3]);
        await assets.settle();
      },
    );
    expect(requests).toEqual(["/assets/start.svg", "/assets/image.svg"]);
  });

  it.each([
    "/outside.svg",
    "file:///tmp/secret.svg",
    "ftp://example.com/secret.svg",
  ])("rejects redirects outside the asset policy: %s", async (location) => {
    let requests = 0;
    await withNetworkAssets(
      (_request, response) => {
        requests += 1;
        response.writeHead(302, { location });
        response.end();
      },
      async (assets) => {
        await expect(assets.image("escape.svg")).rejects.toMatchObject({
          code: "ASSET_NOT_FOUND",
        });
      },
    );
    expect(requests).toBe(1);
  });

  it("stops redirect loops after five redirects", async () => {
    let requests = 0;
    await withNetworkAssets(
      (_request, response) => {
        requests += 1;
        response.writeHead(302, { location: "loop.svg" });
        response.end();
      },
      async (assets) => {
        await expect(assets.image("loop.svg")).rejects.toMatchObject({
          code: "ASSET_NOT_FOUND",
          cause: { message: "Asset exceeded 5 redirects" },
        });
      },
    );
    expect(requests).toBe(6);
  });

  it.each(["declared", "streamed"])(
    "enforces %s network asset byte limits",
    async (mode) => {
      await withNetworkAssets(
        (_request, response) => {
          response.writeHead(
            200,
            mode === "declared" ? { "content-length": "1024" } : {},
          );
          response.write("x".repeat(64));
          // Keep the response open: rejecting its headers/chunks must cancel it.
        },
        async (assets) => {
          await expect(assets.image("oversized.svg")).rejects.toMatchObject({
            code: "ASSET_LIMIT",
          });
        },
        { maxAssetBytes: 32 },
      );
    },
  );

  it("enforces cumulative asset bytes without charging cached images twice", async () => {
    await withNetworkAssets(
      (_request, response) => response.end(squareSvg),
      async (assets) => {
        const first = assets.image("one.svg");
        await first;
        expect(assets.image("one.svg")).toBe(first);
        await expect(assets.image("two.svg")).rejects.toMatchObject({
          code: "ASSET_LIMIT",
          message: "Assets exceed limits.maxAssetBytesTotal",
        });
      },
      { maxAssetBytesTotal: Buffer.byteLength(squareSvg) },
    );
  });

  it("redacts query secrets in HTTP errors", async () => {
    await withNetworkAssets(
      (_request, response) => {
        response.writeHead(403);
        response.end();
      },
      async (assets) => {
        const rejected = assets.image("denied.svg?token=private-secret");
        await expect(rejected).rejects.toMatchObject({
          code: "ASSET_NOT_FOUND",
          cause: { message: "Asset request failed with HTTP 403" },
        });
        await rejected.catch((error: unknown) => {
          expect(String(error)).not.toContain("private-secret");
        });
      },
    );
  });

  it("reports cancellation consistently while a network body is pending", async () => {
    let onRequest: () => void = () => undefined;
    const requested = new Promise<void>((resolve) => {
      onRequest = resolve;
    });
    await withNetworkAssets(
      (_request, response) => {
        response.writeHead(200);
        response.write("<svg");
        onRequest();
      },
      async (assets, _root, controller) => {
        const rejected = assets.image("pending.svg");
        await requested;
        controller.abort();
        await expect(rejected).rejects.toMatchObject({
          code: "RENDER_ABORTED",
          phase: "setup",
        });
      },
    );
  });

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
