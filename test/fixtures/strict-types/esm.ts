import {
  SkiaCanvasSpace,
  type RasterFormat,
  type SkiaCanvasForm,
} from "skia-pts-canvas";

const space = new SkiaCanvasSpace(120, 80, {
  background: "transparent",
});
const form = space.getForm();
const typedForm: SkiaCanvasForm = form;
const typedSpace: SkiaCanvasSpace = form.space;
const aliasSpace: SkiaCanvasSpace = form.skiaSpace;
form.fontWidthEstimate("char");

space.add((time, delta, current) => {
  const center: number = current.center.x;
  form.fillOnly("#f03").point([center, time + delta], 2, "circle");
});

space.skiaCtx.fillRect(0, 0, 1, 1);
const output: Promise<Buffer> = space.toBuffer("png");
const format: RasterFormat = "webp";
void output;
void format;
void typedForm;
void typedSpace;
void aliasSpace;

// @ts-expect-error Vector formats are deliberately excluded.
space.toBuffer("svg");
