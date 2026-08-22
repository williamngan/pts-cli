import type {
  AnimateCallbackFn,
  Bound,
  CanvasForm,
  IPlayer,
  Pt,
  PtLike,
} from "pts";

export type Awaitable<T> = T | Promise<T>;
export type SceneCleanup = () => Awaitable<void>;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** The common Space surface available in both browser and Node scene hosts. */
export interface PtsSceneSpace {
  readonly id: string;
  readonly ready: boolean;
  readonly width: number;
  readonly height: number;
  readonly size: Pt;
  readonly center: Pt;
  readonly pointer: Pt;
  readonly outerBound: Bound;
  readonly innerBound: Bound;

  add(player: IPlayer | AnimateCallbackFn): this;
  remove(player: IPlayer): this;
  removeAll(): this;
  refresh(enabled: boolean): this;
  clear(background?: string): this;
}

/**
 * Pts CanvasForm is used directly in both hosts. The broad generic is confined
 * to this alias because current Pts constrains CanvasForm to MultiTouchSpace.
 */
export type PtsSceneForm = CanvasForm<any>;

/** Cross-runtime image value accepted directly by CanvasForm.image(). */
export type PtsSceneImage = CanvasImageSource & {
  readonly width: number;
  readonly height: number;
};

export interface PtsSceneAssets {
  /** Resolve relative to the scene module rather than process.cwd(). */
  resolve(specifier: string | URL): URL;

  /** Load an image for the current CanvasForm backend. */
  image(specifier: string | URL): Promise<PtsSceneImage>;

  /** Register a font before measuring or drawing text. */
  font(options: {
    family: string;
    sources: readonly (string | URL)[];
  }): Promise<void>;
}

export interface PtsSceneContext {
  /** The exact Pts namespace used by the host and its Space implementation. */
  readonly Pts: typeof import("pts");
  readonly space: PtsSceneSpace;
  readonly form: PtsSceneForm;
  readonly assets: PtsSceneAssets;
  readonly params: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

interface PtsSceneDefinition {
  /** Portable scene schema version. Omitted means version 1. */
  readonly apiVersion?: 1;
  readonly name?: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly background?: string;
  readonly assetBaseURL?: string | URL;
  readonly setup: (context: PtsSceneContext) => Awaitable<void | SceneCleanup>;
}

type PtsSceneDimensions =
  | { readonly width: number; readonly height: number }
  | { readonly width?: never; readonly height?: never };

/** A portable scene with either both logical dimensions or neither. */
export type PtsScene = PtsSceneDefinition & PtsSceneDimensions;

export interface RenderWarning {
  readonly code: string;
  readonly message: string;
  readonly phase?: string;
}

export type ExactScene<T extends PtsScene> = T &
  Record<Exclude<keyof T, keyof PtsScene>, never>;

/** Browser-safe identity helper for inference and exact top-level key checks. */
export function defineScene<const T extends PtsScene>(scene: ExactScene<T>): T {
  return scene;
}

/** Point form accepted by portable input helpers. */
export type ScenePoint = PtLike | readonly [number, number];
