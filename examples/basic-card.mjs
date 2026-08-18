import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Circle, Pt } from "pts";
import { SkiaCanvasSpace } from "skia-pts-canvas";

const outputDirectory = resolve("out");
const outputFile = resolve(outputDirectory, "basic-card.png");

await mkdir(outputDirectory, { recursive: true });

const space = new SkiaCanvasSpace(1200, 630, {
  background: "#10131a",
});
const form = space.getForm();

space.add((_time, _delta, current) => {
  const halo = form.gradient(["#67e8f9", "#8b5cf6"]);

  form
    .fillOnly(
      halo(
        Circle.fromCenter(current.center, 190),
        Circle.fromCenter(current.center, 30),
      ),
    )
    .circle(Circle.fromCenter(current.center, 190))
    .fillOnly("#10131a")
    .circle(Circle.fromCenter(current.center, 145))
    .fillOnly("#f8fafc")
    .font(54, "bold", undefined, 1.2, "sans-serif")
    .text(new Pt(72, 548), "Pts + Skia Canvas");
});

space.renderFrame(0);
await space.toFile(outputFile, { density: 2 });
space.dispose();

console.log(outputFile);
