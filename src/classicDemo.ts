import { readFile } from "node:fs/promises";
import { createContext, Script } from "node:vm";

import * as Pts from "pts";
import { DOMMatrix, DOMPoint, DOMRect, ImageData, Path2D } from "skia-canvas";

import { LEGACY_IMAGE_SOURCE } from "./legacyImage.js";
import { PtsRenderError } from "./PtsRenderError.js";
import { createSeededRandom, effectivePtsSeed } from "./random.js";
import type {
  JsonValue,
  PtsSceneAssets,
  PtsSceneImage,
  RenderWarning,
} from "./scene.js";
import { analyzeJavaScriptSource } from "./sourceAnalysis.js";
import { runnerLiveBound, type SkiaCanvasSpace } from "./SkiaCanvasSpace.js";

type LegacySpace = SkiaCanvasSpace & {
  bindKeyboard(): LegacySpace;
  bindMouse(): LegacySpace;
  bindTouch(): LegacySpace;
  minFrameTime(milliseconds?: number): LegacySpace;
  pause(): LegacySpace;
  play(): LegacySpace;
  playOnce(): LegacySpace;
  replay(): LegacySpace;
  resume(): LegacySpace;
  setup(options?: Record<string, unknown>): LegacySpace;
  stop(): LegacySpace;
};

export interface ClassicDemoExecution {
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly warnings: readonly RenderWarning[];
  invokeReadyCallbacks(): void;
}

export interface LoadedClassicDemo {
  readonly source: string;
  readonly script: Script;
}

export interface ClassicDemoOptions {
  readonly space: SkiaCanvasSpace;
  readonly form: ReturnType<SkiaCanvasSpace["getForm"]>;
  readonly backgroundOverridden: boolean;
  readonly evaluationTimeoutMs?: number;
  readonly assets: PtsSceneAssets;
  readonly assetRootProvided: boolean;
  readonly seed?: string;
}

function unsupported(name: string): never {
  throw new PtsRenderError(
    "COMPAT_API_UNSUPPORTED",
    "setup",
    name + " is not supported by the classic Node canvas runtime",
  );
}

function unsupportedAPI(name: string): object {
  const target = function unsupportedTarget(): never {
    return unsupported(name);
  };
  return new Proxy(target, {
    apply: () => unsupported(name),
    construct: () => unsupported(name),
    get: (_value, property) => {
      if (property === "prototype") return target.prototype;
      if (property === Symbol.toStringTag) return "UnsupportedPtsAPI";
      return () => unsupported(name + "." + String(property) + "()");
    },
  });
}

function installLegacyMethods(
  space: SkiaCanvasSpace,
  form: ReturnType<SkiaCanvasSpace["getForm"]>,
  backgroundOverridden: boolean,
  playIntent: { value: boolean },
): LegacySpace {
  const legacy = space as unknown as LegacySpace;
  const properties: PropertyDescriptorMap = {
    bindKeyboard: {
      configurable: true,
      value() {
        return legacy;
      },
    },
    bindMouse: {
      configurable: true,
      value() {
        return legacy;
      },
    },
    bindTouch: {
      configurable: true,
      value() {
        return legacy;
      },
    },
    minFrameTime: {
      configurable: true,
      value() {
        return legacy;
      },
    },
    pause: {
      configurable: true,
      value() {
        return legacy;
      },
    },
    play: {
      configurable: true,
      value() {
        playIntent.value = true;
        return legacy;
      },
    },
    playOnce: {
      configurable: true,
      value() {
        playIntent.value = true;
        return legacy;
      },
    },
    replay: {
      configurable: true,
      value() {
        playIntent.value = true;
        return legacy;
      },
    },
    resume: {
      configurable: true,
      value() {
        playIntent.value = true;
        return legacy;
      },
    },
    setup: {
      configurable: true,
      value(options: Record<string, unknown> = {}) {
        if (!backgroundOverridden && typeof options.bgcolor === "string") {
          space.background = options.bgcolor;
          space.clear();
        }
        return legacy;
      },
    },
    stop: {
      configurable: true,
      value() {
        playIntent.value = false;
        return legacy;
      },
    },
    element: {
      configurable: true,
      get: () => space.canvas,
    },
    getForm: {
      configurable: true,
      value() {
        return form;
      },
    },
    parent: {
      configurable: true,
      get: () => null,
    },
    pixelScale: {
      configurable: true,
      get: () => 1,
    },
  };
  Object.defineProperties(space, properties);
  return legacy;
}

function legacyMath(seed: string | undefined): Math {
  const value = Object.create(Math) as Math;
  Object.defineProperty(value, "random", {
    configurable: false,
    enumerable: false,
    value:
      seed === undefined
        ? Math.random.bind(Math)
        : createSeededRandom(effectivePtsSeed(seed), "legacy-math"),
    writable: false,
  });
  return value;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function createLegacyImgFacade(
  assets: PtsSceneAssets,
  space: SkiaCanvasSpace,
  assetRootProvided: boolean,
  onUse: () => void,
): unknown {
  const assetSpecifier = (source: string): string => {
    if (!source.startsWith("/")) return source;
    if (!assetRootProvided) {
      throw new PtsRenderError(
        "ASSET_NOT_FOUND",
        "setup",
        "A root-relative legacy image requires an explicit asset root: " +
          source,
        { hint: "Pass --asset-root <Pts checkout or project root>." },
      );
    }
    return source.slice(1);
  };
  const assertNonEditable = (value: unknown): void => {
    const editable =
      typeof value === "object" && value !== null
        ? (value as { editable?: unknown }).editable
        : value;
    if (editable === true) unsupported("Editable Img");
  };

  return class LegacyImg {
    #image: PtsSceneImage | undefined;
    #loaded = false;

    constructor(
      editable: boolean | { readonly editable?: boolean } = false,
      _space?: unknown,
      _crossOrigin?: boolean,
    ) {
      assertNonEditable(editable);
      onUse();
    }

    static async load(
      source: string,
      editable: boolean | { readonly editable?: boolean } = false,
      _space?: unknown,
      ready?: (image: LegacyImg) => void,
    ): Promise<LegacyImg> {
      const image = new LegacyImg(editable);
      await image.load(source);
      ready?.(image);
      return image;
    }

    static loadAsync(
      source: string,
      editable: boolean | { readonly editable?: boolean } = false,
    ): Promise<LegacyImg> {
      return LegacyImg.load(source, editable);
    }

    static async loadPattern(
      source: string,
      _space: unknown,
      repetition: "repeat" | "repeat-x" | "repeat-y" | "no-repeat" = "repeat",
      editable = false,
    ): Promise<CanvasPattern> {
      const image = await LegacyImg.load(source, editable);
      return image.pattern(repetition);
    }

    static blank(): never {
      return unsupported("Img.blank()");
    }

    async load(source: string): Promise<this> {
      if (typeof source !== "string" || source.length === 0) {
        throw new TypeError("Img.load source must be a non-empty string");
      }
      this.#image = await assets.image(assetSpecifier(source));
      this.#loaded = true;
      return this;
    }

    pattern(
      repetition: "repeat" | "repeat-x" | "repeat-y" | "no-repeat" = "repeat",
    ): CanvasPattern {
      if (!this.#image) throw new Error("Img must be loaded before pattern()");
      const pattern = space.skiaCtx.createPattern(this.#image, repetition);
      if (!pattern) throw new Error("Skia could not create an image pattern");
      return pattern;
    }

    dispose(): this {
      this.#image = undefined;
      this.#loaded = false;
      return this;
    }

    cleanup(): this {
      return this.dispose();
    }

    get [LEGACY_IMAGE_SOURCE](): PtsSceneImage | undefined {
      return this.#image;
    }

    get current(): PtsSceneImage | undefined {
      return this.#image;
    }

    get image(): PtsSceneImage | undefined {
      return this.#image;
    }

    get loaded(): boolean {
      return this.#loaded;
    }

    get pixelScale(): number {
      return 1;
    }

    get imageSize(): InstanceType<typeof Pts.Pt> {
      return this.#image
        ? new Pts.Pt(this.#image.width, this.#image.height)
        : new Pts.Pt(0, 0);
    }

    get canvasSize(): InstanceType<typeof Pts.Pt> {
      return this.imageSize;
    }

    crop(): never {
      return unsupported("Img.crop()");
    }

    filter(): never {
      return unsupported("Img.filter()");
    }

    getForm(): never {
      return unsupported("Img.getForm()");
    }

    pixel(): never {
      return unsupported("Img.pixel()");
    }

    resize(): never {
      return unsupported("Img.resize()");
    }

    sync(): never {
      return unsupported("Img.sync()");
    }
  };
}

/** Read, parse, and compile a classic demo without evaluating it. */
export async function loadClassicDemo(
  sourcePath: string,
): Promise<LoadedClassicDemo> {
  let source: string;
  try {
    source = await readFile(sourcePath, "utf8");
  } catch (error) {
    throw new PtsRenderError(
      "SOURCE_NOT_FOUND",
      "load",
      "Unable to read classic demo: " + sourcePath,
      { cause: error },
    );
  }

  analyzeJavaScriptSource(source, sourcePath);
  let script: Script;
  try {
    script = new Script(source, {
      filename: sourcePath,
    });
  } catch (error) {
    throw new PtsRenderError(
      "SCENE_INVALID",
      "load",
      "Classic demo cannot execute as a classic script: " + sourcePath,
      { cause: error },
    );
  }
  return Object.freeze({ source: sourcePath, script });
}

export async function executeClassicDemo(
  loaded: LoadedClassicDemo,
  options: ClassicDemoOptions,
): Promise<ClassicDemoExecution> {
  // Browser CanvasForm is not ready during CanvasSpace's initial resize pass.
  // Its internal setup player marks it ready immediately before user start
  // callbacks. Reproduce that ordering on this compatibility instance only.
  const formState = options.form as unknown as { _ready: boolean };
  formState._ready = false;
  options.space.add({
    start() {
      formState._ready = true;
    },
  });

  const playIntent = { value: false };
  const space = installLegacyMethods(
    options.space,
    options.form,
    options.backgroundOverridden,
    playIntent,
  );
  const readyCallbacks: Array<(bound: unknown, canvas: unknown) => void> = [];
  let usedLegacyImages = false;
  let claimedSpace = false;
  const claimSpace = (api: string): void => {
    if (claimedSpace) {
      unsupported(api + " cannot create a second root space");
    }
    claimedSpace = true;
  };
  const sandbox: Record<string, unknown> = {
    console,
    Date,
    DOMMatrix,
    DOMPoint,
    DOMRect,
    ImageData,
    Math: legacyMath(options.seed),
    Path2D,
    URL,
    space,
    form: options.form,
  };

  const CanvasSpaceFacade = function CanvasSpaceFacade(
    _target?: unknown,
    ready?: unknown,
  ): LegacySpace {
    claimSpace("CanvasSpace");
    if (typeof ready === "function") {
      readyCallbacks.push(ready as (bound: unknown, canvas: unknown) => void);
    }
    return space;
  };
  CanvasSpaceFacade.prototype = Object.getPrototypeOf(space) as object;

  const facade: Record<string, unknown> = { ...Pts };
  facade.CanvasSpace = CanvasSpaceFacade;
  facade.HTMLSpace = unsupportedAPI("HTMLSpace");
  facade.HTMLForm = unsupportedAPI("HTMLForm");
  facade.SVGSpace = unsupportedAPI("SVGSpace");
  facade.SVGForm = unsupportedAPI("SVGForm");
  facade.Img = createLegacyImgFacade(
    options.assets,
    options.space,
    options.assetRootProvided,
    () => {
      usedLegacyImages = true;
    },
  );
  facade.Sound = unsupportedAPI("Sound");

  const applyBackground = (background: unknown): void => {
    if (!options.backgroundOverridden) {
      space.background = typeof background === "string" ? background : "#9ab";
      space.clear();
    }
  };
  facade.namespace = (scope: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(facade)) {
      if (key !== "namespace") scope[key] = value;
    }
  };
  facade.quickStart = (_target: unknown, background: unknown = "#9ab") => {
    claimSpace("Pts.quickStart()");
    applyBackground(background);
    sandbox.space = space;
    sandbox.form = options.form;
    return (
      animate: unknown = null,
      start: unknown = null,
      action: unknown = null,
      resize: unknown = null,
    ): void => {
      const player: Record<string, unknown> = {};
      if (typeof animate === "function") player.animate = animate;
      if (typeof start === "function") player.start = start;
      if (typeof action === "function") player.action = action;
      if (typeof resize === "function") player.resize = resize;
      space.add(player);
      playIntent.value = true;
    };
  };

  for (const [key, value] of Object.entries(facade)) sandbox[key] = value;
  sandbox.Pts = facade;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = new Proxy(
    {},
    {
      get: (_target, property) => unsupported("document." + String(property)),
    },
  );

  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "pts-cli classic demo: " + loaded.source,
  });
  try {
    const completion = loaded.script.runInContext(context, {
      displayErrors: true,
      timeout: options.evaluationTimeoutMs ?? 1_000,
    });
    if (isThenable(completion)) await completion;
  } catch (error) {
    if (error instanceof PtsRenderError) throw error;
    throw new PtsRenderError(
      "SCENE_FAILED",
      "setup",
      "Classic demo failed during evaluation",
      { cause: error, details: { source: loaded.source } },
    );
  }

  const description = sandbox.demoDescription;
  const metadata =
    typeof description === "string"
      ? ({ demoDescription: description } as const)
      : undefined;
  const warnings: RenderWarning[] = [
    {
      code: "CLASSIC_DEMO_COMPATIBILITY",
      phase: "setup",
      message:
        "Rendered through the classic Pts demo compatibility runtime; browser-only APIs remain unsupported.",
    },
  ];
  if (!playIntent.value) {
    warnings.push({
      code: "CLASSIC_PLAY_NOT_REQUESTED",
      phase: "setup",
      message:
        "The demo did not request playback; explicit CLI frames were rendered anyway.",
    });
  }
  if (usedLegacyImages) {
    warnings.push({
      code: "CLASSIC_IMAGE_BRIDGE",
      phase: "setup",
      message:
        "Loaded a legacy Img through the non-editable Skia image bridge.",
    });
  }

  return {
    ...(metadata === undefined ? {} : { metadata }),
    warnings,
    invokeReadyCallbacks(): void {
      for (const callback of readyCallbacks) {
        callback(runnerLiveBound(options.space), options.space.canvas);
      }
    },
  };
}
