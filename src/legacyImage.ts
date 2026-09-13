export const LEGACY_IMAGE_SOURCE = Symbol.for("pts-render.legacy-image-source");

export interface LegacyImageCarrier {
  readonly [LEGACY_IMAGE_SOURCE]: unknown;
}

export function isLegacyImageCarrier(
  value: unknown,
): value is LegacyImageCarrier {
  return (
    value !== null && typeof value === "object" && LEGACY_IMAGE_SOURCE in value
  );
}
