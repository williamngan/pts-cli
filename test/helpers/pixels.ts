export type Rgba = readonly [number, number, number, number];

export function pixelAt(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
): Rgba {
  const offset = (y * width + x) * 4;
  return [
    pixels[offset] ?? -1,
    pixels[offset + 1] ?? -1,
    pixels[offset + 2] ?? -1,
    pixels[offset + 3] ?? -1,
  ];
}

export function pngDimensions(buffer: Uint8Array): [number, number] {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  return [view.getUint32(16), view.getUint32(20)];
}
