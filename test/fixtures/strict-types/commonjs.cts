import adapter = require("pts-render");
import sceneHelpers = require("pts-render/scene");

const space = new adapter.SkiaCanvasSpace(20, 10);
const form: adapter.SkiaCanvasForm = space.getForm();
const typedSpace: adapter.SkiaCanvasSpace = form.space;

form.fill("#fff").rect([
  [0, 0],
  [20, 10],
]);

const output: Promise<string> = space.toURL("jpeg", {
  quality: 0.9,
});
void output;
void typedSpace;

const scene = sceneHelpers.defineScene({ run() {} });
void scene;
