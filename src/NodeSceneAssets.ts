import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { FontLibrary, loadImage } from "skia-canvas";

import { PtsRenderError } from "./PtsRenderError.js";
import type { RenderResourceLimits } from "./renderTypes.js";
import type { PtsSceneAssets, PtsSceneImage } from "./scene.js";

interface NodeSceneAssetsOptions {
  readonly baseURL: URL;
  readonly rootURL?: URL;
  readonly allowNet: boolean;
  readonly limits: RenderResourceLimits;
  readonly signal: AbortSignal;
}

export class NodeSceneAssets implements PtsSceneAssets {
  readonly #allowNet: boolean;
  readonly #baseURL: URL;
  readonly #failedFontRegistrations = new Map<
    string,
    { readonly key: string; readonly promise: Promise<void> }
  >();
  readonly #failedImages = new Map<string, Promise<PtsSceneImage>>();
  readonly #imageCache = new Map<string, Promise<PtsSceneImage>>();
  readonly #limits: RenderResourceLimits;
  readonly #pending = new Set<Promise<unknown>>();
  readonly #rootURL: URL | undefined;
  readonly #signal: AbortSignal;
  readonly #fontRegistrations = new Map<
    string,
    { readonly key: string; readonly promise: Promise<void> }
  >();

  #assetBytes = 0;
  #canonicalRoot: Promise<string> | undefined;
  #fontDirectory: string | undefined;

  constructor(options: NodeSceneAssetsOptions) {
    this.#baseURL = options.baseURL;
    this.#rootURL =
      options.rootURL === undefined ? undefined : new URL(options.rootURL.href);
    this.#allowNet = options.allowNet;
    this.#limits = options.limits;
    this.#signal = options.signal;
  }

  resolve(specifier: string | URL): URL {
    return this.#resolveSpecifier(specifier, true);
  }

  #resolveSpecifier(specifier: string | URL, enforceRoot: boolean): URL {
    let resolved: URL;
    try {
      resolved =
        specifier instanceof URL
          ? new URL(specifier.href)
          : new URL(specifier, this.#baseURL);
    } catch (error) {
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "Invalid asset URL",
        { cause: error },
      );
    }
    this.#assertProtocol(resolved);
    if (enforceRoot) this.#assertWithinRoot(resolved);
    return resolved;
  }

  image(specifier: string | URL): Promise<PtsSceneImage> {
    let url: URL;
    try {
      url = this.resolve(specifier);
    } catch (error) {
      return this.#track(Promise.reject(error));
    }
    const cached = this.#imageCache.get(url.href);
    if (cached) return cached;
    const failed = this.#failedImages.get(url.href);
    if (failed !== undefined) {
      this.#pending.delete(failed);
      this.#failedImages.delete(url.href);
    }

    const promise = this.#track(this.#loadImage(url));
    this.#imageCache.set(url.href, promise);
    void promise.catch(() => {
      if (this.#imageCache.get(url.href) === promise) {
        this.#imageCache.delete(url.href);
        this.#failedImages.set(url.href, promise);
      }
    });
    return promise;
  }

  font(options: {
    family: string;
    sources: readonly (string | URL)[];
  }): Promise<void> {
    return this.#loadFont(options, true);
  }

  /** @internal CLI font paths have already been resolved from the caller cwd. */
  configuredFont(options: {
    family: string;
    sources: readonly (string | URL)[];
  }): Promise<void> {
    return this.#loadFont(options, false);
  }

  #loadFont(
    options: {
      family: string;
      sources: readonly (string | URL)[];
    },
    enforceRoot: boolean,
  ): Promise<void> {
    let urls: URL[];
    try {
      if (typeof options.family !== "string" || options.family.length === 0) {
        throw new PtsRenderError(
          "FONT_REGISTRATION_FAILED",
          "setup",
          "Font family must be a non-empty string",
        );
      }
      if (!Array.isArray(options.sources) || options.sources.length === 0) {
        throw new PtsRenderError(
          "FONT_REGISTRATION_FAILED",
          "setup",
          "Font sources must be a non-empty array",
        );
      }
      urls = options.sources.map((source) =>
        this.#resolveSpecifier(source, enforceRoot),
      );
    } catch (error) {
      return this.#track(Promise.reject(error));
    }

    const key = JSON.stringify(urls.map((url) => url.href));
    const failed = this.#failedFontRegistrations.get(options.family);
    if (failed !== undefined) {
      this.#pending.delete(failed.promise);
      this.#failedFontRegistrations.delete(options.family);
    }
    const existing = this.#fontRegistrations.get(options.family);
    if (existing !== undefined) {
      if (existing.key === key) return existing.promise;
      return this.#track(
        Promise.reject(
          new PtsRenderError(
            "FONT_REGISTRATION_FAILED",
            "setup",
            "Font family was already registered with different sources: " +
              options.family,
          ),
        ),
      );
    }

    const promise = this.#track(
      this.#registerFont(options.family, urls, enforceRoot),
    );
    this.#fontRegistrations.set(options.family, { key, promise });
    void promise.catch(() => {
      if (this.#fontRegistrations.get(options.family)?.promise === promise) {
        this.#fontRegistrations.delete(options.family);
        this.#failedFontRegistrations.set(options.family, { key, promise });
      }
    });
    return promise;
  }

  async settle(): Promise<void> {
    while (this.#pending.size > 0) {
      const pending = [...this.#pending];
      this.#pending.clear();
      await Promise.all(pending);
    }
  }

  async dispose(): Promise<void> {
    if (this.#fontDirectory) {
      await rm(this.#fontDirectory, { recursive: true, force: true });
      this.#fontDirectory = undefined;
    }
  }

  #assertProtocol(url: URL): void {
    if (url.protocol === "file:" || url.protocol === "data:") return;
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (!this.#allowNet) {
        throw new PtsRenderError(
          "ASSET_NETWORK_DISABLED",
          "setup",
          "Network assets are disabled: " + this.#displayURL(url),
          {
            hint: "Pass allowNet: true or use --allow-net for trusted scenes.",
          },
        );
      }
      return;
    }
    throw new PtsRenderError(
      "ASSET_NOT_FOUND",
      "setup",
      "Unsupported asset URL protocol: " + url.protocol,
    );
  }

  #assertWithinRoot(url: URL): void {
    const root = this.#rootURL;
    if (root === undefined || url.protocol === "data:") return;

    let within = false;
    if (root.protocol === "file:" && url.protocol === "file:") {
      const relation = relative(fileURLToPath(root), fileURLToPath(url));
      within =
        relation === "" ||
        (relation !== ".." &&
          !relation.startsWith(".." + sep) &&
          !isAbsolute(relation));
    } else if (root.protocol === url.protocol && root.origin === url.origin) {
      const rootPath = root.pathname.endsWith("/")
        ? root.pathname
        : root.pathname + "/";
      within = url.pathname.startsWith(rootPath);
    }

    if (!within) {
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "Asset resolves outside the explicit asset root: " +
          this.#displayURL(url),
        {
          details: { assetRoot: this.#displayURL(root) },
          hint: "Choose an asset beneath the configured root or remove the asset-root override.",
        },
      );
    }
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#pending.add(promise);
    void promise.catch(() => undefined);
    return promise;
  }

  async #loadImage(url: URL): Promise<PtsSceneImage> {
    this.#throwIfAborted();
    try {
      if (url.protocol === "file:") {
        const path = await this.#prepareFile(url);
        return (await loadImage(path)) as unknown as PtsSceneImage;
      }
      const data = await this.#fetch(url);
      return (await loadImage(data)) as unknown as PtsSceneImage;
    } catch (error) {
      if (error instanceof PtsRenderError) throw error;
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "Unable to load image asset: " + this.#displayURL(url),
        { cause: error },
      );
    }
  }

  async #registerFont(
    family: string,
    sources: readonly URL[],
    enforceRoot: boolean,
  ): Promise<void> {
    try {
      const paths: string[] = [];
      for (const [index, url] of sources.entries()) {
        if (url.protocol === "file:") {
          paths.push(await this.#prepareFile(url, enforceRoot));
          continue;
        }

        const data = await this.#fetch(url, enforceRoot);
        this.#fontDirectory ??= await mkdtemp(join(tmpdir(), "pts-cli-fonts-"));
        const extension = this.#fontExtension(url);
        const name =
          createHash("sha256")
            .update(family)
            .update("\0")
            .update(url.href)
            .update("\0")
            .update(String(index))
            .digest("hex") + extension;
        const path = join(this.#fontDirectory, name);
        await writeFile(path, data, { flag: "wx" });
        paths.push(path);
      }
      const registered = FontLibrary.use(family, paths);
      if (registered.length === 0) {
        throw new Error("Skia did not recognize any supplied font files");
      }
    } catch (error) {
      if (error instanceof PtsRenderError) throw error;
      throw new PtsRenderError(
        "FONT_REGISTRATION_FAILED",
        "setup",
        "Unable to register font family " + family,
        { cause: error },
      );
    }
  }

  async #prepareFile(url: URL, enforceRoot = true): Promise<string> {
    const sourcePath = fileURLToPath(url);
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(sourcePath);
    } catch (error) {
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "Asset file does not exist: " + this.#displayURL(url),
        { cause: error },
      );
    }

    if (enforceRoot && this.#rootURL?.protocol === "file:") {
      const root = await this.#canonicalRootPath();
      const relation = relative(root, canonicalPath);
      if (
        relation === ".." ||
        relation.startsWith(".." + sep) ||
        isAbsolute(relation)
      ) {
        throw new PtsRenderError(
          "ASSET_NOT_FOUND",
          "setup",
          "Asset symlink resolves outside the explicit asset root: " +
            this.#displayURL(url),
          {
            details: { assetRoot: this.#displayURL(this.#rootURL) },
            hint: "Choose an asset whose canonical path remains beneath the configured root.",
          },
        );
      }
    }

    let fileStat;
    try {
      fileStat = await stat(canonicalPath);
    } catch (error) {
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "Unable to inspect asset file: " + this.#displayURL(url),
        { cause: error },
      );
    }
    if (!fileStat.isFile()) {
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "Asset is not a regular file: " + this.#displayURL(url),
      );
    }
    this.#accountBytes(fileStat.size, this.#displayURL(url));
    return canonicalPath;
  }

  #canonicalRootPath(): Promise<string> {
    this.#canonicalRoot ??= realpath(fileURLToPath(this.#rootURL as URL)).catch(
      (error: unknown) => {
        throw new PtsRenderError(
          "ASSET_NOT_FOUND",
          "setup",
          "Explicit asset root does not exist: " +
            this.#displayURL(this.#rootURL as URL),
          { cause: error },
        );
      },
    );
    return this.#canonicalRoot;
  }

  async #fetch(initialURL: URL, enforceRoot = true): Promise<Buffer> {
    let url = initialURL;
    try {
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        this.#throwIfAborted();
        const response = await fetch(url, {
          redirect: "manual",
          signal: this.#signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location)
            throw new Error("Network redirect has no Location header");
          if (redirects === 5) throw new Error("Asset exceeded 5 redirects");
          url = new URL(location, url);
          this.#assertProtocol(url);
          if (enforceRoot) this.#assertWithinRoot(url);
          continue;
        }
        if (!response.ok) {
          throw new Error(
            "Asset request failed with HTTP " + String(response.status),
          );
        }
        const declaredLength = response.headers.get("content-length");
        if (declaredLength !== null) {
          const size = Number(declaredLength);
          if (Number.isFinite(size) && size > this.#limits.maxAssetBytes) {
            throw new PtsRenderError(
              "ASSET_LIMIT",
              "setup",
              "Asset exceeds limits.maxAssetBytes: " + this.#displayURL(url),
            );
          }
        }
        if (!response.body) return Buffer.alloc(0);

        const chunks: Buffer[] = [];
        let bytes = 0;
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const buffer = Buffer.from(value);
          bytes += buffer.length;
          if (bytes > this.#limits.maxAssetBytes) {
            throw new PtsRenderError(
              "ASSET_LIMIT",
              "setup",
              "Asset exceeds limits.maxAssetBytes: " + this.#displayURL(url),
            );
          }
          chunks.push(buffer);
        }
        this.#accountBytes(bytes, this.#displayURL(url));
        return Buffer.concat(chunks, bytes);
      }
      throw new Error("Unreachable redirect state");
    } catch (error) {
      if (error instanceof PtsRenderError) throw error;
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "Unable to fetch asset: " + this.#displayURL(url),
        { cause: this.#sanitizedNetworkCause(error, url) },
      );
    }
  }

  #accountBytes(bytes: number, source: string): void {
    if (bytes > this.#limits.maxAssetBytes) {
      throw new PtsRenderError(
        "ASSET_LIMIT",
        "setup",
        "Asset exceeds limits.maxAssetBytes: " + source,
      );
    }
    if (this.#assetBytes > this.#limits.maxAssetBytesTotal - bytes) {
      throw new PtsRenderError(
        "ASSET_LIMIT",
        "setup",
        "Assets exceed limits.maxAssetBytesTotal",
      );
    }
    this.#assetBytes += bytes;
  }

  #throwIfAborted(): void {
    if (this.#signal.aborted) {
      throw new PtsRenderError(
        "RENDER_ABORTED",
        "setup",
        "Render was aborted while loading assets",
      );
    }
  }

  #fontExtension(url: URL): string {
    if (url.protocol === "data:") {
      const mediaType = url.href.slice(5, url.href.indexOf(",")).toLowerCase();
      if (mediaType.startsWith("font/woff2")) return ".woff2";
      if (mediaType.startsWith("font/woff")) return ".woff";
      if (
        mediaType.startsWith("font/ttf") ||
        mediaType.startsWith("application/x-font-ttf")
      ) {
        return ".ttf";
      }
      if (mediaType.startsWith("font/otf")) return ".otf";
      return ".font";
    }
    const extension = extname(url.pathname).toLowerCase();
    return /^\.[a-z\d]{1,10}$/.test(extension) ? extension : ".font";
  }

  #displayURL(url: URL): string {
    if (url.protocol === "data:") {
      const comma = url.href.indexOf(",");
      const header = comma < 0 ? "data:" : url.href.slice(0, comma + 1);
      const encodedLength = comma < 0 ? 0 : url.href.length - comma - 1;
      return header.slice(0, 128) + "[" + String(encodedLength) + " chars]";
    }
    const safe = new URL(url.href);
    safe.username = "";
    safe.password = "";
    if (safe.search) safe.search = "?[redacted]";
    safe.hash = "";
    return safe.href;
  }

  #sanitizedNetworkCause(error: unknown, url: URL): Error {
    if (url.protocol === "data:") {
      return new Error("Data asset could not be decoded");
    }
    let message: string;
    try {
      message = error instanceof Error ? error.message : String(error);
    } catch {
      message = "Asset request failed";
    }
    const secrets = [url.href, url.username, url.password, url.search.slice(1)];
    for (const secret of secrets) {
      if (secret.length > 0) message = message.split(secret).join("[redacted]");
      try {
        const decoded = decodeURIComponent(secret);
        if (decoded.length > 0) {
          message = message.split(decoded).join("[redacted]");
        }
      } catch {
        // The encoded spelling was already handled above.
      }
    }
    const sanitized = new Error(message);
    sanitized.name = "AssetLoadError";
    return sanitized;
  }
}
