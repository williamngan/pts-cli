import type { JsonValue, RenderWarning } from "./scene.js";
import type { RendererKind, RendererPreference } from "./types.js";

export type RenderLoader = "auto" | "scene" | "pts-demo";

export type RenderClock =
  | { readonly mode: "direct"; readonly time?: number }
  | {
      readonly mode: "frame";
      readonly frame: number;
      readonly fps?: number;
    };

export type RenderFacts =
  | {
      readonly mode: "direct";
      readonly time: number;
      readonly framesInvoked: 1;
    }
  | {
      readonly mode: "frame";
      readonly frame: number;
      readonly fps: number;
      readonly time: number;
      readonly framesInvoked: number;
    };

export interface PtsScenePointerEvent {
  readonly at: number;
  readonly type:
    | "up"
    | "down"
    | "move"
    | "drag"
    | "uidrag"
    | "drop"
    | "uidrop"
    | "over"
    | "out"
    | "enter"
    | "leave"
    | "click"
    | "pointerdown"
    | "pointerup"
    | "contextmenu";
  readonly x: number;
  readonly y: number;
  readonly button?: number;
  readonly buttons?: number;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface PtsSceneResizeEvent {
  readonly at: number;
  readonly type: "resize";
  readonly width: number;
  readonly height: number;
}

export type PtsSceneEvent = PtsScenePointerEvent | PtsSceneResizeEvent;

interface RenderOutputTarget {
  /** Omit to receive a Buffer in RenderSceneResult. */
  readonly path?: string | URL;
}

interface RasterOutputOptions {
  readonly density?: number;
  readonly matte?: string;
  readonly msaa?: number | boolean;
}

export type RenderOutputRequest =
  | (RenderOutputTarget & RasterOutputOptions & { readonly format: "png" })
  | (RenderOutputTarget &
      RasterOutputOptions & {
        readonly format: "jpeg" | "jpg";
        readonly quality?: number;
        readonly downsample?: boolean;
      })
  | (RenderOutputTarget &
      RasterOutputOptions & {
        readonly format: "webp";
        readonly quality?: number;
      })
  | (RenderOutputTarget & {
      readonly format: "svg";
      readonly textMode?: "preserve" | "outline";
    })
  | (RenderOutputTarget & RasterOutputOptions & { readonly format: "raw" });

export interface RenderResourceLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxLogicalPixels: number;
  readonly maxRasterPixelsPerOutput: number;
  readonly maxRasterPixelsTotal: number;
  readonly maxFramesInvoked: number;
  readonly maxFps: number;
  readonly maxEvents: number;
  readonly maxOutputs: number;
  readonly maxSourceBytes: number;
  readonly maxInputBytes: number;
  readonly maxSeedBytes: number;
  readonly maxMetadataBytes: number;
  readonly maxAssetBytes: number;
  readonly maxAssetBytesTotal: number;
  readonly maxArtifactBytesTotal: number;
  readonly maxBufferResultBytes: number;
  readonly maxCapturedLogBytes: number;
}

export interface RenderFontRequest {
  readonly family: string;
  readonly sources: readonly (string | URL)[];
}

export interface RenderSceneOptions {
  readonly loader?: RenderLoader;
  readonly size?: { readonly width: number; readonly height: number };
  readonly background?: string;
  readonly pointer?: readonly [number, number];
  readonly render?: RenderClock;
  readonly events?: readonly PtsSceneEvent[];
  readonly seed?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly assetRoot?: string | URL;
  readonly allowNet?: boolean;
  readonly fonts?: readonly RenderFontRequest[];
  readonly renderer?: RendererPreference;
  readonly limits?: Readonly<Partial<RenderResourceLimits>>;
  readonly outputs: readonly RenderOutputRequest[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Replace existing path targets. Defaults to false. */
  readonly overwrite?: boolean;
}

export interface RuntimeFacts {
  readonly node: string;
  readonly ptsVersion: string;
  readonly ptsRevision?: string;
  readonly skiaCanvas: string;
  readonly requestedRenderer: RendererPreference;
  readonly renderer: RendererKind;
  readonly api?: string;
  readonly device?: string;
  readonly driver?: string;
  readonly rendererError?: string;
}

export interface RandomFacts {
  readonly seed: string | null;
  readonly effectiveSeed: string | null;
  readonly algorithm: "pts-cli-seed-v1" | null;
  readonly seedApplied: boolean;
}

export interface RenderOutputFacts {
  readonly format: "png" | "jpeg" | "webp" | "svg" | "raw";
  readonly bytes: number;
  readonly sha256: string;
}

export type RenderOutputResult = RenderOutputFacts &
  (
    | { readonly path: string; readonly buffer?: never }
    | { readonly path?: never; readonly buffer: Buffer }
  );

export interface RenderSceneResult {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly loader: Exclude<RenderLoader, "auto">;
  readonly width: number;
  readonly height: number;
  readonly render: Readonly<RenderFacts>;
  readonly random: Readonly<RandomFacts>;
  readonly runtime: Readonly<RuntimeFacts>;
  readonly outputs: readonly RenderOutputResult[];
  readonly warnings: readonly RenderWarning[];
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly logs: {
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
  };
  readonly durationMs: number;
}

/** Logical CLI canvas used when neither the caller nor the file sets a size. */
export const DEFAULT_RENDER_SIZE = Object.freeze({
  width: 800,
  height: 600,
} as const);

/** Canvas clear color used when neither the caller nor the file sets one. */
export const DEFAULT_RENDER_BACKGROUND = "transparent";

export const DEFAULT_RENDER_RESOURCE_LIMITS: Readonly<RenderResourceLimits> =
  Object.freeze({
    maxWidth: 16_384,
    maxHeight: 16_384,
    maxLogicalPixels: 64_000_000,
    maxRasterPixelsPerOutput: 64_000_000,
    maxRasterPixelsTotal: 128_000_000,
    maxFramesInvoked: 10_000,
    maxFps: 1_000,
    maxEvents: 10_000,
    maxOutputs: 16,
    maxSourceBytes: 5 * 1024 * 1024,
    maxInputBytes: 5 * 1024 * 1024,
    maxSeedBytes: 4 * 1024,
    maxMetadataBytes: 256 * 1024,
    maxAssetBytes: 32 * 1024 * 1024,
    maxAssetBytesTotal: 128 * 1024 * 1024,
    maxArtifactBytesTotal: 512 * 1024 * 1024,
    maxBufferResultBytes: 128 * 1024 * 1024,
    maxCapturedLogBytes: 1024 * 1024,
  });
