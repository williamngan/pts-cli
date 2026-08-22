import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { renderScene } from "../dist/index.mjs";

const outputDirectory = resolve("out");
await mkdir(outputDirectory, { recursive: true });

const result = await renderScene(resolve("examples/basic-card.mjs"), {
  outputs: [
    {
      format: "png",
      path: resolve(outputDirectory, "basic-card.png"),
      density: 2,
    },
    {
      format: "svg",
      path: resolve(outputDirectory, "basic-card.svg"),
      textMode: "preserve",
    },
  ],
  overwrite: true,
});

for (const output of result.outputs) {
  process.stdout.write(output.path + "\n");
}
