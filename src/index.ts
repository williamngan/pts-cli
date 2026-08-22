/// <reference lib="dom" />

export {
  SkiaCanvasError,
  UnsupportedOperationError,
  type SkiaCanvasErrorCode,
} from "./errors.js";
export {
  PtsRenderError,
  type PtsRenderErrorCode,
  type PtsRenderErrorOptions,
  type PtsRenderPhase,
} from "./PtsRenderError.js";
export { renderScene } from "./renderScene.js";
export { fontToSkiaValue, SkiaCanvasForm } from "./SkiaCanvasForm.js";
export { SkiaCanvasSpace } from "./SkiaCanvasSpace.js";
export type {
  Awaitable,
  JsonPrimitive,
  JsonValue,
  PtsScene,
  PtsSceneAssets,
  PtsSceneContext,
  PtsSceneForm,
  PtsSceneImage,
  PtsSceneSpace,
  RenderWarning,
  SceneCleanup,
  ScenePoint,
} from "./scene.js";
export {
  DEFAULT_RENDER_RESOURCE_LIMITS,
  type PtsSceneEvent,
  type PtsScenePointerEvent,
  type PtsSceneResizeEvent,
  type RandomFacts,
  type RenderClock,
  type RenderFacts,
  type RenderFontRequest,
  type RenderLoader,
  type RenderOutputFacts,
  type RenderOutputRequest,
  type RenderOutputResult,
  type RenderResourceLimits,
  type RenderSceneOptions,
  type RenderSceneResult,
  type RuntimeFacts,
} from "./renderTypes.js";
export type {
  CanvasAllocationLimits,
  DataURLFormat,
  EncodedRasterFormat,
  OutputFileOptions,
  OutputFormat,
  RasterExportOptions,
  RasterFileOptions,
  RasterFormat,
  RenderFrameOptions,
  RendererInfo,
  RendererKind,
  RendererPreference,
  SkiaCanvas,
  SkiaCanvasContext2D,
  SkiaCanvasImageData,
  SkiaCanvasImageSource,
  SkiaCanvasSpaceOptions,
  SvgExportOptions,
  SvgFileOptions,
  SyntheticActionPoint,
  SyntheticPointerEvent,
  SyntheticPointerEventInit,
  VectorFormat,
} from "./types.js";
