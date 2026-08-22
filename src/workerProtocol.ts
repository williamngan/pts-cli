import type {
  RandomFacts,
  RenderFacts,
  RenderOutputRequest,
  RenderResourceLimits,
  RuntimeFacts,
} from "./renderTypes.js";
import type { JsonValue, RenderWarning } from "./scene.js";
import type { SerializedPtsRenderError } from "./PtsRenderError.js";

export interface WorkerOutputRequest {
  readonly request: Omit<RenderOutputRequest, "path">;
  readonly artifactPath: string;
}

export interface RenderWorkerJob {
  readonly source: string;
  readonly loader: "scene" | "pts-demo";
  readonly size?: { readonly width: number; readonly height: number };
  readonly background?: string;
  readonly pointer?: readonly [number, number];
  readonly render: RenderFacts;
  readonly events: readonly Record<string, unknown>[];
  readonly seed?: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly assetRoot?: string;
  readonly allowNet: boolean;
  readonly fonts: readonly {
    readonly family: string;
    readonly sources: readonly string[];
  }[];
  readonly renderer: "cpu" | "auto" | "gpu";
  readonly limits: RenderResourceLimits;
  readonly outputs: readonly WorkerOutputRequest[];
}

export interface WorkerOutputResult {
  readonly artifactPath: string;
  readonly format: "png" | "jpeg" | "webp" | "svg" | "raw";
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorkerRenderResult {
  readonly source: string;
  readonly loader: "scene" | "pts-demo";
  readonly width: number;
  readonly height: number;
  readonly render: RenderFacts;
  readonly random: RandomFacts;
  readonly runtime: RuntimeFacts;
  readonly outputs: readonly WorkerOutputResult[];
  readonly warnings: readonly RenderWarning[];
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly durationMs: number;
}

export type ParentToWorkerMessage = {
  readonly type: "render";
  readonly job: RenderWorkerJob;
};

export type WorkerToParentMessage =
  | { readonly type: "success"; readonly result: WorkerRenderResult }
  | { readonly type: "failure"; readonly error: SerializedPtsRenderError };
