export type SkiaCanvasErrorCode =
  | "DISPOSED"
  | "EXPORT_IN_PROGRESS"
  | "FRAME_IN_PROGRESS"
  | "INCOMPATIBLE_PTS"
  | "MUTATION_IN_PROGRESS"
  | "RENDERER_UNAVAILABLE"
  | "UNSUPPORTED_OPERATION";

export class SkiaCanvasError extends Error {
  readonly code: SkiaCanvasErrorCode;

  constructor(code: SkiaCanvasErrorCode, message: string) {
    super(message);
    this.name = "SkiaCanvasError";
    this.code = code;
  }
}

export class UnsupportedOperationError extends SkiaCanvasError {
  constructor(operation: string, alternative: string) {
    super(
      "UNSUPPORTED_OPERATION",
      operation + " is not supported by SkiaCanvasSpace. " + alternative,
    );
    this.name = "UnsupportedOperationError";
  }
}
