import {
  Bound,
  CanvasSpace,
  Pt,
  type AnimateCallbackFn,
  type IPlayer,
} from "pts";
import * as Pts from "pts";

import type {
  PtsSceneAssets,
  PtsSceneImage,
  PtsSceneSource,
  RenderWarning,
  SceneCleanup,
} from "./scene.js";
import { snapshotJsonObject, validateScene } from "./sceneValidation.js";

const mountOptionKeys = new Set([
  "target",
  "size",
  "background",
  "resize",
  "retina",
  "params",
  "assetBaseURL",
  "bindMouse",
  "bindTouch",
  "autoplay",
  "signal",
  "onWarning",
]);

function displayAssetURL(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") {
      const comma = url.href.indexOf(",");
      const header = comma < 0 ? "data:" : url.href.slice(0, comma + 1);
      const encodedLength = comma < 0 ? 0 : url.href.length - comma - 1;
      return header.slice(0, 128) + "[" + String(encodedLength) + " chars]";
    }
    url.username = "";
    url.password = "";
    if (url.search) url.search = "?[redacted]";
    url.hash = "";
    return url.href;
  } catch {
    return "an invalid URL";
  }
}

export interface MountSceneOptions {
  readonly target: string | Element;
  readonly size?: { readonly width: number; readonly height: number };
  readonly background?: string;
  readonly resize?: boolean;
  readonly retina?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly assetBaseURL?: string | URL;
  readonly bindMouse?: boolean;
  readonly bindTouch?: boolean;
  readonly autoplay?: boolean;
  readonly signal?: AbortSignal;
  readonly onWarning?: (warning: RenderWarning) => void;
}

export interface MountedScene {
  readonly space: CanvasSpace;
  readonly form: ReturnType<CanvasSpace["getForm"]>;
  readonly warnings: readonly RenderWarning[];
  dispose(): Promise<void>;
}

class BrowserSceneAssets implements PtsSceneAssets {
  readonly #baseURL: URL;
  readonly #failedFontRegistrations = new Map<
    string,
    { readonly key: string; readonly promise: Promise<void> }
  >();
  readonly #failedImages = new Map<string, Promise<PtsSceneImage>>();
  readonly #fontRegistrations = new Map<
    string,
    { readonly key: string; readonly promise: Promise<void> }
  >();
  readonly #fonts = new Set<FontFace>();
  readonly #imageCache = new Map<string, Promise<PtsSceneImage>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #signal: AbortSignal;

  constructor(baseURL: URL, signal: AbortSignal) {
    this.#baseURL = baseURL;
    this.#signal = signal;
  }

  resolve(specifier: string | URL): URL {
    return specifier instanceof URL
      ? new URL(specifier.href)
      : new URL(specifier, this.#baseURL);
  }

  image(specifier: string | URL): Promise<PtsSceneImage> {
    let url: URL;
    try {
      url = this.resolve(specifier);
    } catch (error) {
      return this.#track(Promise.reject(error));
    }
    const cached = this.#imageCache.get(url.href);
    if (cached !== undefined) return cached;
    const failed = this.#failedImages.get(url.href);
    if (failed !== undefined) {
      this.#pending.delete(failed);
      this.#failedImages.delete(url.href);
    }

    const promise = this.#track(
      new Promise<HTMLImageElement>((resolve, reject) => {
        if (this.#signal.aborted) {
          reject(new DOMException("Scene mount was aborted", "AbortError"));
          return;
        }
        const image = new Image();
        const cleanup = (): void => {
          this.#signal.removeEventListener("abort", abort);
          image.removeEventListener("load", loaded);
          image.removeEventListener("error", failed);
        };
        const abort = (): void => {
          cleanup();
          image.removeAttribute("src");
          reject(new DOMException("Scene mount was aborted", "AbortError"));
        };
        const loaded = (): void => {
          cleanup();
          resolve(image);
        };
        const failed = (): void => {
          cleanup();
          reject(
            new Error(
              "Unable to load image asset (browser loading or CORS policy): " +
                displayAssetURL(image.src),
            ),
          );
        };
        this.#signal.addEventListener("abort", abort, { once: true });
        image.addEventListener("load", loaded, { once: true });
        image.addEventListener("error", failed, { once: true });
        if (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.origin !== window.location.origin
        ) {
          image.crossOrigin = "anonymous";
        }
        image.src = url.href;
      }),
    );
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
    let urls: URL[];
    try {
      if (typeof options.family !== "string" || options.family.length === 0) {
        throw new TypeError("Font family must be a non-empty string");
      }
      if (!Array.isArray(options.sources) || options.sources.length === 0) {
        throw new TypeError("Font sources must be a non-empty array");
      }
      urls = options.sources.map((source) => this.resolve(source));
    } catch (error) {
      return this.#track(Promise.reject(error));
    }

    const key = JSON.stringify(urls.map((url) => url.href));
    const previousFailure = this.#failedFontRegistrations.get(options.family);
    if (previousFailure !== undefined) {
      this.#pending.delete(previousFailure.promise);
      this.#failedFontRegistrations.delete(options.family);
    }
    const existing = this.#fontRegistrations.get(options.family);
    if (existing !== undefined) {
      if (existing.key === key) return existing.promise;
      return this.#track(
        Promise.reject(
          new TypeError(
            "Font family was already registered with different sources: " +
              options.family,
          ),
        ),
      );
    }

    const promise = this.#track(this.#registerFont(options.family, urls));
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

  dispose(): void {
    for (const font of this.#fonts) document.fonts.delete(font);
    this.#fonts.clear();
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#pending.add(promise);
    void promise.catch(() => undefined);
    return promise;
  }

  async #registerFont(family: string, sources: readonly URL[]): Promise<void> {
    for (const source of sources) {
      const face = new FontFace(
        family,
        "url(" + JSON.stringify(source.href) + ")",
      );
      await this.#abortable(face.load());
      document.fonts.add(face);
      this.#fonts.add(face);
    }
  }

  #abortable<T>(promise: Promise<T>): Promise<T> {
    if (this.#signal.aborted) {
      return Promise.reject(
        new DOMException("Scene mount was aborted", "AbortError"),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const abort = (): void =>
        reject(new DOMException("Scene mount was aborted", "AbortError"));
      this.#signal.addEventListener("abort", abort, { once: true });
      void promise.then(
        (value) => {
          this.#signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          this.#signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }
}

interface Registration {
  readonly key: string;
  readonly player: IPlayer;
}

function assertMountOptions(options: MountSceneOptions): void {
  if (options === null || typeof options !== "object") {
    throw new TypeError("mount options must be an object");
  }
  const prototype = Object.getPrototypeOf(options) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("mount options must be a plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new TypeError("mount options must not contain symbol keys");
    }
    if (!mountOptionKeys.has(key)) {
      throw new TypeError("mount options." + key + " is not supported");
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError("mount options." + key + " must be a data property");
    }
  }

  if (options.target === undefined) {
    throw new TypeError("mount options.target is required");
  }
  if (
    (typeof options.target !== "string" || options.target.length === 0) &&
    (!(options.target instanceof Element) || options.target.nodeType !== 1)
  ) {
    throw new TypeError("mount options.target must be a selector or Element");
  }
  if (options.size !== undefined) {
    const rawSize: unknown = options.size;
    if (rawSize === null || typeof rawSize !== "object") {
      throw new TypeError("options.size must be a plain width/height object");
    }
    const sizePrototype = Object.getPrototypeOf(rawSize) as object | null;
    const sizeDescriptors = Object.getOwnPropertyDescriptors(rawSize);
    if (
      (sizePrototype !== Object.prototype && sizePrototype !== null) ||
      Reflect.ownKeys(sizeDescriptors).some((key) => {
        if (typeof key !== "string") return true;
        const descriptor = sizeDescriptors[key];
        return (
          (key !== "width" && key !== "height") ||
          descriptor === undefined ||
          !("value" in descriptor)
        );
      })
    ) {
      throw new TypeError("options.size must be a plain width/height object");
    }
    for (const key of ["width", "height"] as const) {
      const value = options.size[key];
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError("options.size." + key + " must be positive");
      }
    }
  }
  if (
    options.background !== undefined &&
    typeof options.background !== "string"
  ) {
    throw new TypeError("options.background must be a string");
  }
  for (const key of [
    "resize",
    "retina",
    "bindMouse",
    "bindTouch",
    "autoplay",
  ] as const) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") {
      throw new TypeError("options." + key + " must be a boolean");
    }
  }
  if (options.params !== undefined) {
    snapshotJsonObject(options.params, "options.params");
  }
  if (
    options.assetBaseURL !== undefined &&
    typeof options.assetBaseURL !== "string" &&
    !(options.assetBaseURL instanceof URL)
  ) {
    throw new TypeError("options.assetBaseURL must be a string or URL");
  }
  if (
    options.signal !== undefined &&
    (typeof options.signal !== "object" ||
      typeof options.signal.aborted !== "boolean" ||
      typeof options.signal.addEventListener !== "function" ||
      typeof options.signal.removeEventListener !== "function")
  ) {
    throw new TypeError("options.signal must be an AbortSignal");
  }
  if (
    options.onWarning !== undefined &&
    typeof options.onWarning !== "function"
  ) {
    throw new TypeError("options.onWarning must be a function");
  }
}

function resolvedTarget(target: string | Element): string | Element {
  let element: Element | null;
  try {
    const selector =
      typeof target === "string" && target[0] !== "#" && target[0] !== "."
        ? "#" + target
        : target;
    element =
      typeof selector === "string"
        ? document.querySelector(selector)
        : selector;
  } catch (error) {
    throw new TypeError("mount options.target is not a valid selector", {
      cause: error,
    });
  }
  if (
    element?.nodeName.toLowerCase() === "svg" ||
    (element?.querySelector(":scope > svg") ?? null) !== null
  ) {
    throw new TypeError(
      "mountScene supports CanvasSpace targets, not SVGSpace targets",
    );
  }
  return target;
}

function waitUntilReady(
  ready: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Scene mount was aborted", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    const abort = (): void =>
      reject(new DOMException("Scene mount was aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void ready.then(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function initializePlayers(
  space: CanvasSpace,
  setup: () => Promise<void>,
): Promise<void> {
  const originalAdd = space.add;
  const originalRemove = space.remove;
  const originalRemoveAll = space.removeAll;
  const nativeAdd = (player: IPlayer | AnimateCallbackFn): CanvasSpace =>
    originalAdd.call(space, player);
  const nativeRemove = (player: IPlayer): CanvasSpace =>
    originalRemove.call(space, player);
  const nativeRemoveAll = (): CanvasSpace => originalRemoveAll.call(space);
  const mutable = space as unknown as {
    add(player: IPlayer | AnimateCallbackFn): CanvasSpace;
    remove(player: IPlayer): CanvasSpace;
    removeAll(): CanvasSpace;
    playerCount: number;
  };
  const pending = new Map<string, Registration>();
  const active = new Map<string, IPlayer>();
  let registrationCount = 0;

  mutable.add = (
    playerOrCallback: IPlayer | AnimateCallbackFn,
  ): CanvasSpace => {
    const player: IPlayer =
      typeof playerOrCallback === "function"
        ? { animate: playerOrCallback }
        : playerOrCallback;
    const index = registrationCount++;
    const key = player.animateID || space.id + String(index);
    player.animateID = key;
    pending.set(key, { key, player });
    return space;
  };
  mutable.remove = (player: IPlayer): CanvasSpace => {
    const key = player.animateID;
    if (typeof key !== "string") return space;
    pending.delete(key);
    if (active.has(key)) {
      nativeRemove(player);
      active.delete(key);
    }
    return space;
  };
  mutable.removeAll = (): CanvasSpace => {
    pending.clear();
    active.clear();
    nativeRemoveAll();
    return space;
  };

  const restore = (): void => {
    mutable.add = originalAdd;
    mutable.remove = originalRemove;
    mutable.removeAll = originalRemoveAll;
    mutable.playerCount = Math.max(mutable.playerCount, registrationCount);
  };

  try {
    await setup();
    while (pending.size > 0) {
      const batch = [...pending.values()];
      for (const registration of batch) {
        if (pending.get(registration.key) !== registration) continue;
        pending.delete(registration.key);
        active.set(registration.key, registration.player);
        nativeAdd(registration.player);
      }
      for (const registration of batch) {
        if (
          active.get(registration.key) !== registration.player ||
          pending.has(registration.key)
        ) {
          continue;
        }
        registration.player.start?.(space.outerBound, space);
      }
    }
  } catch (error) {
    pending.clear();
    active.clear();
    nativeRemoveAll();
    throw error;
  } finally {
    restore();
  }
}

export async function mountScene(
  sceneValue: PtsSceneSource,
  options: MountSceneOptions,
): Promise<MountedScene> {
  const scene = validateScene(sceneValue);
  assertMountOptions(options);
  const params =
    options.params === undefined
      ? Object.freeze({})
      : snapshotJsonObject(options.params, "options.params");
  if (options.signal?.aborted) {
    throw new DOMException("Scene mount was aborted", "AbortError");
  }

  const warnings: RenderWarning[] = [];
  const controller = new AbortController();
  let readyResolve: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const space = new CanvasSpace(resolvedTarget(options.target), () =>
    readyResolve?.(),
  ).setup({
    bgcolor: options.background ?? scene.background ?? "transparent",
    resize: options.resize ?? true,
    retina: options.retina ?? true,
  });

  let cleanup: SceneCleanup | undefined;
  let assets: BrowserSceneAssets | undefined;
  let disposePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      controller.abort();
      options.signal?.removeEventListener("abort", externalAbort);
      let cleanupError: unknown;
      if (cleanup) {
        try {
          await cleanup();
        } catch (error) {
          cleanupError = error;
        }
      }
      assets?.dispose();
      space.dispose();
      if (cleanupError !== undefined) throw cleanupError;
    })();
    return disposePromise;
  };
  const externalAbort = (): void => {
    controller.abort();
    void dispose().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", externalAbort, { once: true });

  try {
    await waitUntilReady(ready, controller.signal);
    const size =
      options.size ??
      (scene.width !== undefined && scene.height !== undefined
        ? { width: scene.width, height: scene.height }
        : undefined);
    if (size) {
      space.resize(new Bound(new Pt(0, 0), new Pt(size.width, size.height)));
    }
    space.background = options.background ?? scene.background ?? "transparent";
    space.clear();

    let baseURL: URL;
    if (options.assetBaseURL !== undefined) {
      baseURL =
        options.assetBaseURL instanceof URL
          ? new URL(options.assetBaseURL.href)
          : new URL(options.assetBaseURL, document.baseURI);
    } else if (scene.assetBaseURL !== undefined) {
      baseURL =
        scene.assetBaseURL instanceof URL
          ? new URL(scene.assetBaseURL.href)
          : new URL(scene.assetBaseURL, document.baseURI);
    } else {
      baseURL = new URL(document.baseURI);
      const warning = {
        code: "ASSET_BASE_DOCUMENT",
        message:
          "Relative assets use document.baseURI; set scene.assetBaseURL for unambiguous portability.",
        phase: "setup",
      } as const;
      warnings.push(warning);
      options.onWarning?.(warning);
    }
    assets = new BrowserSceneAssets(baseURL, controller.signal);
    const form = space.getForm();

    await initializePlayers(space, async () => {
      const result = await scene.run({
        Pts,
        space,
        form,
        assets: assets as BrowserSceneAssets,
        params,
        signal: controller.signal,
      });
      if (result !== undefined && typeof result !== "function") {
        throw new TypeError("run must return undefined or a cleanup function");
      }
      if (typeof result === "function") cleanup = result;
      await assets?.settle();
      if (controller.signal.aborted) {
        throw new DOMException("Scene mount was aborted", "AbortError");
      }
    });

    if (options.bindMouse ?? true) space.bindMouse();
    if (options.bindTouch ?? true) space.bindTouch();
    if (options.autoplay ?? true) space.play();

    return {
      space,
      form,
      warnings: Object.freeze([...warnings]),
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch {
      // Preserve the mount failure.
    }
    throw error;
  }
}
