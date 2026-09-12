# pts-cli

Render [Pts.js](https://ptsjs.org/) scenes to PNG, JPEG, WebP, raw RGBA, and SVG
in Node.js. The package uses
[skia-canvas](https://github.com/samizdatco/skia-canvas) and provides:

- the `ptsjs` command for agents, scripts, and build pipelines;
- a deterministic `renderScene()` API;
- a portable JavaScript format that runs in Node and a normal browser
  CanvasSpace;
- a compatibility loader for a tested subset of unchanged Pts demos; and
- the lower-level `SkiaCanvasSpace` and `SkiaCanvasForm` adapter.

Pts itself is never patched. All Node integration lives in this repository.

## Status

This is an implementation-stage, private `0.1.0` package. The intended package
name is `pts-cli`; the executable is `ptsjs`. Keeping the command slightly more
specific avoids likely collisions around a generic `pts` executable.

The authoritative Pts baseline is the latest local committed `revamp` snapshot,
currently `7031a246c6870b8175160e62baf1193967d029c9`, not the older npm
implementation. The normal lockfile still resolves an earlier revamp commit;
publication remains blocked until the reviewed revision or a distinct revamp
release can be installed reproducibly. The compatibility suite is commit- and
source-hash-pinned to the intended snapshot.

## Why skia-canvas

Skia Canvas is a strong fit for this project:

- Pts CanvasForm already targets the Canvas 2D drawing model.
- Skia works without a DOM or headless browser.
- The same retained drawing commands can encode raster files and SVG.
- CPU rendering provides a dependable headless default, while GPU remains an
  explicit option.
- A worker process gives the CLI hard timeouts and isolates per-render Pts and
  random state.

The boundary is equally important. skia-canvas is a native dependency; fonts and
pixels can vary across platforms; and it does not make DOM, audio, microphone,
browser events, or HTMLSpace meaningful in Node. Its SVG is a recording of
Canvas drawing commands, not a semantic Pts SVGSpace scene graph. Those cases
are reported explicitly.

## Command line

After npm publication, render a file without installing the package globally:

```sh
npx pts-cli drawing.mjs
```

For unattended or reproducible use, suppress npm's install prompt and pin the
version:

```sh
npx --yes pts-cli@0.1.0 drawing.mjs --json
```

The package installs one executable named `ptsjs`, so the persistent form is:

```sh
npm install --global pts-cli
ptsjs drawing.mjs
```

### From this checkout

```sh
pnpm install
pnpm build

node dist/cli.mjs examples/basic-card.mjs \
  --json
```

With no `--out`, this creates a unique PNG such as
`pts-output/basic-card-550e8400-e29b-41d4-a716-446655440000.png`. To choose
names or generate multiple formats explicitly:

```sh
node dist/cli.mjs examples/basic-card.mjs \
  --out out/basic-card.png \
  --out out/basic-card.svg \
  --json
```

Output directories are created as needed. Existing files are protected unless
`--force` is supplied. A trailing slash selects a directory and asks the CLI to
generate the filename; a directory passed without a trailing slash is treated as
an exact target and rejected. Symlinks, other non-regular targets, and duplicate
canonical paths are also rejected before scene execution.

## Write a render file

A render file is ordinary JavaScript with one default-exported function. The CLI
calls `run` once so the file can register its normal Pts drawing callback:

```js
function run({ Pts, space, form, params }) {
  const { Circle } = Pts;
  const radius = Number(params.radius ?? 40);

  space.add((time) => {
    form
      .fillOnly("#67e8f9")
      .circle(Circle.fromCenter(space.pointer, radius + time / 1000));
  });
}

export default run;
```

Render it in Node:

```sh
ptsjs circles.mjs \
  --size 640x360 \
  --pointer 320,180 \
  --time 1000 \
  --param radius=48 \
  --out circles.png
```

The canvas is `800x600` with a transparent background when neither the file nor
the command specifies them. `--size` and `--background` override file values. To
keep defaults in the file, export a configured object instead:

```js
export default {
  width: 640,
  height: 360,
  background: "#10131a",
  run,
};
```

Mount the exact same function or configured object in a browser:

```js
import { mountScene } from "pts-cli/browser";
import run from "./circles.mjs";

const mounted = await mountScene(run, {
  target: "#pt",
  params: { radius: 48 },
});

// Later:
await mounted.dispose();
```

`pts-cli/browser` has no Node built-in, skia-canvas, or native dependency edge
in its module graph. It creates a real Pts CanvasSpace and CanvasForm, preserves
the same initial resize/start ordering as the Node runner, and owns input
binding and playback. It intentionally rejects SVGSpace targets.

### Delta from a standard web demo

Most drawing and player code can stay unchanged. The meaningful differences are
at the edges:

| Standard browser demo                         | Render file                                       |
| --------------------------------------------- | ------------------------------------------------- |
| `Pts.quickStart("#pt", bg)`                   | file or CLI background                            |
| container determines initial size             | file, `--size`, or the `800x600` default          |
| globals such as `Circle`, `space`, and `form` | destructure `Pts`, `space`, and `form` in `run`   |
| `space.bindMouse().bindTouch().play()`        | browser mount or CLI runner owns scheduling/input |
| browser-relative `Img` or font loading        | `assets.image()` and `assets.font()`              |
| live browser clock                            | explicit `--time` or `--frame` simulation         |

The callback itself remains normal Pts code. See
[`examples/basic-card.mjs`](examples/basic-card.mjs) for the canonical example.

## Rendering unchanged Pts demos

The classic compatibility loader evaluates a browser demo once in an isolated
worker VM and supplies Pts globals, `Pts.quickStart`, a private CanvasSpace
facade, deterministic lifecycle methods, and narrowly supported Canvas globals:

```sh
ptsjs path/to/pts/demo/circle.intersectCircle2D.js \
  --loader auto \
  --size 640x360 \
  --pointer 320,180 \
  --out circle.png \
  --out circle.svg
```

Auto-selection is syntax-aware. It parses without evaluation and chooses the
classic loader only for strong markers such as `Pts.quickStart`,
`window.demoDescription`, or a known Space constructor. A source containing both
module exports and classic markers is rejected as ambiguous; choose
`--loader scene` or `--loader pts-demo` explicitly.

Classic support is manifest-based, not a blanket “all demos” claim. At Pts
revision `7031a24…`, the checked matrix currently contains:

- 18 supported demos;
- 3 supported-with-input demos;
- 1 partial editable/pixel Img demo; and
- 4 browser-only/audio demos marked not applicable.

The supported set covers geometry, gradients, text, compositing, resize,
actions, Tempo, physics, UI, direct CanvasSpace construction, non-editable image
loading, and image patterns. Every source is SHA-256 pinned and every supported
entry produces both PNG and SVG. See
[`compatibility/pts-revamp.json`](compatibility/pts-revamp.json).

Root-relative legacy image paths require an explicit root instead of guessing
the machine filesystem:

```sh
ptsjs path/to/pts/demo/guide.image_load.js \
  --asset-root path/to/pts \
  --out image-demo.png
```

Editable Img canvases, pixel manipulation, audio, HTMLSpace, and SVGSpace fail
at a named compatibility boundary. SVG file export remains available because it
comes from the Canvas recording, not SVGSpace.

## CLI

```text
ptsjs <source> [--out <destination>] [options]
ptsjs render <source> [--out <destination>] [options]
```

Core options:

| Option                             | Purpose                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `-o, --out <path>`                 | Exact file or trailing-`/` directory; repeatable; `-` writes to stdout |
| `--format <name>`                  | Generated, ambiguous, or stdout format                                 |
| `--loader <auto\|scene\|pts-demo>` | Source interpretation                                                  |
| `--size <width>x<height>`          | Canvas size; overrides file values; otherwise defaults to `800x600`    |
| `--background <color>`             | Canvas background; overrides file value; otherwise transparent         |
| `--pointer <x>,<y>`                | Initial pointer without dispatching an action                          |
| `--time <ms>`                      | One direct frame at a timestamp                                        |
| `--frame <index> --fps <rate>`     | Simulate frames 0 through the index                                    |
| `--events <file.json>`             | Replay a deterministic pointer/action/resize timeline                  |
| `--seed <string>`                  | Seed Pts and isolated JavaScript random streams                        |
| `--params <file.json>`             | Base parameter object                                                  |
| `--param <key=value>`              | Parameter override; repeatable                                         |
| `--density <integer>`              | Raster output scale                                                    |
| `--quality <0..1>`                 | JPEG/WebP quality                                                      |
| `--matte <color>`                  | Color beneath raster transparency                                      |
| `--text-mode <preserve\|outline>`  | SVG text policy                                                        |
| `--asset-root <path\|URL>`         | Base for scene/legacy assets                                           |
| `--allow-net`                      | Allow HTTP(S) through the asset service                                |
| `--font <family=path>`             | Register a font; repeatable by family                                  |
| `--renderer <cpu\|auto\|gpu>`      | Native renderer policy                                                 |
| `--timeout <ms>`                   | Hard worker deadline                                                   |
| `--limit <name=value>`             | Resource-limit override; repeatable                                    |
| `--force`                          | Replace existing outputs                                               |
| `--json`                           | Emit exactly one machine-readable result record                        |
| `--quiet`                          | Suppress human diagnostics and captured scene logs                     |
| `--debug`                          | Include stack information in JSON errors                               |

### Defaults and generated outputs

Only the source is required. When `--out` is omitted, the CLI creates one PNG
under `pts-output/` in the current working directory:

```text
pts-output/<sanitized-source-stem>-<render-id>.png
```

The render ID is a full random UUID, so simultaneous agent processes do not
choose the same path. The absolute committed path and the same `renderId` are
reported in `--json` output. Human-readable mode prints the path to stderr.
`--quiet` intentionally suppresses that message, so callers using a generated
name should use `--json` when they need to discover it programmatically.

`--format` selects the generated extension:

```sh
ptsjs scene.mjs --format svg --text-mode outline --json
ptsjs scene.mjs --out renders/ --format webp --json
```

The second form creates a unique file inside `renders/`. A bare `--out` remains
an error; omit it to use `pts-output/`. Multiple outputs still require repeated
explicit `--out` destinations.

Other effective defaults are:

| Setting                      | Default or fallback                                    |
| ---------------------------- | ------------------------------------------------------ |
| loader                       | Syntax-aware `auto` selection                          |
| logical size                 | File dimensions, otherwise `800x600`                   |
| background                   | File/classic-demo background, otherwise transparent    |
| pointer                      | Canvas center                                          |
| clock                        | One direct frame at `0ms` with a zero delta            |
| simulated frame rate         | `60fps` when `--frame` is selected                     |
| events                       | Empty timeline                                         |
| random seed                  | Unset; randomness is not made deterministic implicitly |
| parameters                   | Empty object                                           |
| raster density               | `1`                                                    |
| JPEG/WebP quality            | `0.92` from skia-canvas                                |
| raster matte                 | Unset                                                  |
| SVG text mode                | `preserve`                                             |
| assets                       | Scene-relative, with network access disabled           |
| additional fonts             | None                                                   |
| renderer                     | CPU                                                    |
| timeout                      | `30000ms`                                              |
| overwrite                    | Disabled                                               |
| JSON, quiet, and debug modes | Disabled                                               |

`--limit` inherits the exported `DEFAULT_RENDER_RESOURCE_LIMITS` values. Flags
such as `--background`, `--seed`, and `--font` are optional overrides rather
than arbitrary implicit values.

`--time 5000` invokes one frame with `(time, delta) = (5000, 0)`. It does not
invent intermediate frames. Stateful sketches should use, for example,
`--frame 300 --fps 60`, which invokes frames 0 through 300 with timestamps
computed from their integer indexes.

### Deterministic input

An event file is versioned and strictly validated:

```json
{
  "schemaVersion": 1,
  "events": [
    { "at": 0, "type": "move", "x": 100, "y": 100 },
    { "at": 500, "type": "down", "x": 100, "y": 100, "buttons": 1 },
    { "at": 800, "type": "drag", "x": 220, "y": 160, "buttons": 1 },
    { "at": 900, "type": "up", "x": 220, "y": 160 },
    { "at": 1000, "type": "resize", "width": 800, "height": 600 }
  ]
}
```

Events are stably ordered by `at` and source order. `--pointer` changes initial
state only; it does not synthesize a move callback. Each `at` is a millisecond
timestamp on the selected render clock. Before a frame, the runner dispatches
all events whose timestamp is at or before that frame and then calls the normal
Pts `action(type, x, y, event)` handlers. Pointer actions update the synthetic
pointer state; resize events update the canvas and invoke its resize lifecycle.

With `--time 1000`, applicable events are replayed through `1000ms` and then one
frame is rendered. With `--frame 60 --fps 60`, intermediate frames are rendered
and each event is applied before the first frame boundary that reaches it.
Events after the final render time are not dispatched. The timeline supports Pts
pointer/action types and resize, not keyboard input or an emulated browser event
loop.

### Agent-facing JSON

Success writes one JSON object to stdout:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "renderId": "550e8400-e29b-41d4-a716-446655440000",
  "loader": "scene",
  "width": 640,
  "height": 360,
  "outputs": [
    {
      "format": "png",
      "bytes": 12345,
      "sha256": "...",
      "path": "/absolute/path/pts-output/circles-550e8400-e29b-41d4-a716-446655440000.png"
    }
  ]
}
```

Failures use
`{ "ok": false, "error": { "code", "phase", "message", "cause"? } }` and retain
a bounded cause chain without stacks by default. `--debug` adds worker and cause
stacks. Exit groups are stable: 2 for usage/validation, 3 for source or
compatibility, 4 for render-file initialization/input/frame, 5 for
export/commit, 6 for native/environment, 124 for timeout, and 130 for SIGINT.
`--json` cannot be combined with `--out -`.

## Programmatic one-shot API

```js
import { renderScene } from "pts-cli";

const result = await renderScene("./circles.mjs", {
  pointer: [320, 180],
  seed: "release-card",
  render: { mode: "frame", frame: 60, fps: 60 },
  outputs: [
    { format: "png" }, // returned as Buffer
    {
      format: "svg",
      path: "out/circles.svg",
      textMode: "outline",
    },
  ],
  timeoutMs: 30_000,
});

const png = result.outputs[0].buffer;
```

Each call starts a fresh worker. Outputs are encoded in request order from the
same final canvas. Path outputs are verified and committed atomically; omitted
paths become bounded Buffers in the parent. The result includes dimensions,
clock facts, random facts, renderer facts, warnings, hashes, captured logs, and
optional scene metadata.

Render files must have a default export containing either a `run` function or a
configured object with a `run` property. `.mjs`, package-appropriate `.js`, and
`.cjs` (`module.exports` or `exports.default`) are supported. Direct runtime
imports from `pts` are allowed only when they resolve to the runner's exact peer
installation; otherwise rendering fails with `PTS_INSTANCE_MISMATCH`. Using
`context.Pts` avoids that package-manager edge case.

## Assets and fonts

Portable code uses one API in Node and the browser:

```js
export default {
  assetBaseURL: import.meta.url,
  async run({ space, form, assets }) {
    const image = await assets.image("./artwork.webp");
    await assets.font({
      family: "Project Sans",
      sources: ["./project-sans.woff2"],
    });

    space.add(() => {
      form.image(
        [
          [0, 0],
          [320, 180],
        ],
        image,
      );
      form.font(24, "normal", "normal", 1.2, "Project Sans");
    });
  },
};
```

Node resolves assets relative to the source module unless `assetBaseURL` or
`--asset-root` overrides it. Network access is denied by default, redirects and
bytes are bounded, and registered resources live only for the render worker.
Local files and `data:` URLs work without network permission. An explicit asset
root confines file resolution through `assets.*` both lexically and after
symlink resolution; explicit `--font` paths still resolve from the caller's
working directory. Failed image loads can be retried; identical font
registrations are idempotent, while reusing a family with different sources is
an error. Diagnostics redact URL credentials, query strings, and data payloads.
The browser uses `HTMLImageElement`, `FontFace`, and the same scene-relative URL
rules; browser image failures also identify loading/CORS policy without exposing
URL credentials.

## SVG output

SVG is available at both levels:

```js
await space.toFile("drawing.svg", { outline: false });
const svg = await space.toBuffer("svg", { outline: true });
```

In the CLI/API, `textMode: "preserve"` retains text where Skia can do so;
`"outline"` converts glyphs to paths for more self-contained geometry. Embedded
raster images remain raster data inside the SVG. Filters, compositing, text,
fonts, and backend details can differ from a browser Canvas implementation, so
visual compatibility is tested semantically rather than by byte equality.

## Low-level adapter

Use `SkiaCanvasSpace` directly when a worker and scene schema are unnecessary:

```js
import { Circle } from "pts";
import { SkiaCanvasSpace } from "pts-cli";

const space = new SkiaCanvasSpace(640, 360, {
  background: "#10131a",
  renderer: "cpu",
});
const form = space.getForm();

space.setPointer([320, 180]);
space.add((time) => {
  form.fillOnly("#67e8f9").circle(Circle.fromCenter(space.pointer, 40));
});
space.renderFrame(1000);

await space.toFile("circle.png", { density: 2 });
await space.toFile("circle.svg", { outline: false });
space.dispose();
```

The adapter is intentionally explicit:

- `renderFrame()` is deterministic and non-reentrant;
- `setPointer()` and `dispatchAction()` provide synthetic input;
- `resize()` preserves explicitly supplied pointer state;
- exports do not advance the scene;
- mutation is blocked while asynchronous export is pending; and
- browser scheduling methods such as `play()` throw with a `renderFrame()`
  alternative.

CPU is the default. `renderer: "auto"` permits Skia fallback; `"gpu"` is strict
and fails if the actual engine is not GPU-backed. Allocation limits are checked
before native Canvas construction.

## Trust and resource boundary

Render files and classic demos execute arbitrary JavaScript. The worker and VM
improve lifecycle control, diagnostics, and timeout behavior; they are not a
security sandbox for hostile code. Render only trusted sources, especially when
network assets are enabled.

Default limits cover source/input bytes, logical and raster pixels, frames,
events, outputs, assets, artifact bytes, returned Buffers, metadata, logs, and
seed size. A timeout or SIGINT kills the worker. Scene code cannot choose output
paths because output policy remains in the parent process.

## Verification

```sh
pnpm check
```

The normal suite covers unit rendering, lifecycle and input semantics, SVG,
browser mounting in Chromium, CLI black-box behavior, strict consumer types,
packed ESM/CommonJS consumers, duplicate-Pts rejection, executable permissions,
and package metadata.

The exact local Pts snapshot can be checked without modifying it:

```sh
# node_modules/pts must temporarily resolve to this detached/read-only checkout
pnpm build
pnpm test:compatibility /path/to/pts-at-7031a24
```

The compatibility verifier checks the commit when Git metadata is present,
checks every source hash before execution, writes all output to its own
temporary directory, and compares the Pts checkout's status/diff fingerprints
before and after.

## Current limitations

- The exact latest local revamp commit cannot yet be pinned from the configured
  public Git source; release remains blocked.
- The package is private and has not completed hosted native verification on
  every advertised OS/Node combination.
- Classic compatibility is manifest-scoped; it is not a DOM emulator.
- Editable/pixel-oriented legacy Img, offscreen Canvas helpers, HTMLSpace,
  SVGSpace, audio, microphone, video, and arbitrary browser timers are not
  supported.
- SVG records Canvas output and does not provide semantic SVGSpace nodes.
- Native deployment, fonts, and platform rendering differences still need to be
  treated like any other skia-canvas application.
