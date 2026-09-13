import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCLIArguments } from "../src/cliArguments.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CLI option contract", () => {
  it("parses input files, overrides, fonts, clocks and automation flags together", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pts-options-"));
    directories.push(directory);
    const params = join(directory, "params.json");
    const events = join(directory, "events.json");
    await writeFile(params, JSON.stringify({ radius: 1, base: true }));
    await writeFile(
      events,
      JSON.stringify({
        schemaVersion: 1,
        events: [{ at: 0, type: "move", x: 1, y: 2 }],
      }),
    );
    const parsed = await parseCLIArguments([
      "render",
      "scene.mjs",
      "-o",
      "card.jpg",
      "--out",
      "card.svg",
      "--quality",
      "0.8",
      "--density",
      "2",
      "--matte",
      "#fff",
      "--text-mode",
      "outline",
      "--size",
      "640x360",
      "--pointer=-2,8",
      "--frame",
      "3",
      "--fps",
      "30",
      "--background",
      "#123",
      "--seed=",
      "--params",
      params,
      "--param",
      "radius=4",
      "--param",
      "label=hello",
      "--param",
      "empty=",
      "--events",
      events,
      "--font",
      "Test=a.ttf",
      "--font",
      "Test=b.ttf",
      "--asset-root",
      "assets",
      "--allow-net",
      "--renderer",
      "auto",
      "--limit",
      "maxFramesInvoked=10",
      "--timeout",
      "1000",
      "--force",
      "--json",
      "--quiet",
      "--debug",
      "--loader",
      "scene",
    ]);
    expect(parsed.command).toBe("render");
    if (parsed.command !== "render") throw new Error("Missing render command");
    expect(parsed).toMatchObject({
      source: "scene.mjs",
      json: true,
      quiet: true,
      debug: true,
      stdoutOutput: false,
    });
    expect(parsed.options).toMatchObject({
      size: { width: 640, height: 360 },
      pointer: [-2, 8],
      render: { mode: "frame", frame: 3, fps: 30 },
      background: "#123",
      seed: "",
      params: { radius: 4, base: true, label: "hello", empty: "" },
      events: [{ at: 0, type: "move", x: 1, y: 2 }],
      fonts: [{ family: "Test", sources: ["a.ttf", "b.ttf"] }],
      assetRoot: "assets",
      allowNet: true,
      renderer: "auto",
      limits: { maxFramesInvoked: 10 },
      timeoutMs: 1000,
      overwrite: true,
      loader: "scene",
      outputs: [
        {
          format: "jpeg",
          path: "card.jpg",
          quality: 0.8,
          density: 2,
          matte: "#fff",
        },
        { format: "svg", path: "card.svg", textMode: "outline" },
      ],
    });
  });

  it.each([
    ["--unknown"],
    ["--json=false"],
    ["--json", "--json"],
    ["--size", "8x6", "--size", "8x6"],
    ["--size"],
    ["-x"],
    ["--size", "0x10"],
    ["--size", "8,6"],
    ["--pointer", "1,2,3"],
    ["--pointer=,"],
    ["--time=NaN"],
    ["--time="],
    ["--time=-1"],
    ["--frame="],
    ["--frame=-1"],
    ["--frame=1.5"],
    ["--time=0", "--frame=1"],
    ["--fps=60"],
    ["--loader=unknown"],
    ["--renderer=unknown"],
    ["--param=__proto__=1"],
    ["--param=bad"],
    ["--param=x=1", "--param=x=2"],
    ["--font=broken"],
    ["--limit=bad"],
    ["--limit=unknown=1"],
    ["--limit=maxOutputs=0"],
    ["--limit=maxOutputs=1", "--limit=maxOutputs=2"],
    ["--out=card.png", "--quality=0.8"],
    ["--out=card.jpg", "--quality=2"],
    ["--out=card.jpg", "--quality="],
    ["--out=card.png", "--text-mode=outline"],
    ["--out=card.svg", "--text-mode=bad"],
    ["--out=card.svg", "--density=2"],
    ["--out=card.svg", "--matte=#fff"],
    ["--out=card.png", "--matte=notacolor"],
    ["--background=notacolor"],
    ["--background=ff0000"],
    ["--background="],
    ["--out=card.png", "--density=1.5"],
    ["--out=card.png", "--format=svg"],
    ["--out=card.png", "--out=other.png", "--format=png"],
    ["--out=-", "--format=png", "--json"],
    ["--out=-", "--out=-"],
    ["--format=pdf"],
    ["--out=card.unknown"],
    ["--timeout=0"],
    ["--params="],
    ["--events="],
  ])("rejects malformed arguments %j", async (...args) => {
    await expect(
      parseCLIArguments(["scene.mjs", ...args]),
    ).rejects.toMatchObject({ code: "CLI_USAGE", phase: "arguments" });
  });

  it("supports stdout, inline options, aliases and the end-of-options marker", async () => {
    const parsed = await parseCLIArguments([
      "--format=jpg",
      "--out=-",
      "--time=12.5",
      "--",
      "-scene.mjs",
    ]);
    expect(parsed).toMatchObject({
      source: "-scene.mjs",
      stdoutOutput: true,
      options: {
        outputs: [{ format: "jpeg" }],
        render: { mode: "direct", time: 12.5 },
      },
    });
    await expect(parseCLIArguments([])).resolves.toEqual({ command: "help" });
    await expect(parseCLIArguments(["--version"])).resolves.toEqual({
      command: "version",
    });
    await expect(parseCLIArguments(["render"])).rejects.toMatchObject({
      code: "CLI_USAGE",
    });
  });

  it("rejects malformed, missing and oversized input files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pts-json-options-"));
    directories.push(directory);
    const path = join(directory, "input.json");
    await expect(
      parseCLIArguments(["scene.mjs", "--params", path]),
    ).rejects.toMatchObject({ code: "CLI_USAGE" });
    await writeFile(path, "{");
    await expect(
      parseCLIArguments(["scene.mjs", "--params", path]),
    ).rejects.toMatchObject({ code: "CLI_USAGE" });
    await writeFile(path, JSON.stringify({ schemaVersion: 2, events: [] }));
    await expect(
      parseCLIArguments(["scene.mjs", "--events", path]),
    ).rejects.toMatchObject({ code: "CLI_USAGE" });
    await expect(
      parseCLIArguments([
        "scene.mjs",
        "--params",
        path,
        "--limit",
        "maxInputBytes=1",
      ]),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    await writeFile(path, "[]");
    await expect(
      parseCLIArguments(["scene.mjs", "--params", path]),
    ).rejects.toMatchObject({ code: "CLI_USAGE" });
  });
});
