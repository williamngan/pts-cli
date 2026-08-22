import {
  renderScene,
  SkiaCanvasSpace,
  type RasterFormat,
  type SkiaCanvasForm,
} from "pts-cli";
import { mountScene } from "pts-cli/browser";
import { defineScene } from "pts-cli/scene";

const scene = defineScene({
  apiVersion: 1,
  width: 120,
  height: 80,
  async setup({ Pts, space: sceneSpace, form: sceneForm, assets }) {
    const image = await assets.image("asset.png");
    sceneForm.image(
      [
        [0, 0],
        [10, 10],
      ],
      image,
    );
    sceneSpace.add(() => {
      sceneForm
        .fillOnly("#f03")
        .circle(Pts.Circle.fromCenter(sceneSpace.pointer, 4));
    });
  },
});

void mountScene(scene, { target: document.body, autoplay: false });
const rendered = renderScene("scene.mjs", {
  outputs: [
    { format: "png", density: 2 },
    { format: "svg", textMode: "outline" },
  ],
});
void rendered;

// @ts-expect-error Output options are discriminated by format.
renderScene("scene.mjs", { outputs: [{ format: "svg", quality: 0.8 }] });

defineScene({
  setup() {},
  // @ts-expect-error Scene extensions belong under metadata.
  output: "scene.png",
});

// @ts-expect-error Portable dimensions are supplied as a width/height pair.
defineScene({ width: 120, setup() {} });

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

const svg: Promise<Buffer> = space.toBuffer("svg", { outline: true });
void svg;

// @ts-expect-error Raster quality is not an SVG option.
space.toBuffer("svg", { quality: 0.8 });
