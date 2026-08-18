# skia-pts-canvas

Render Pts scenes as raster images in Node.js using
[skia-canvas](https://skia-canvas.org/).

This package is an experimental adapter. It does not modify Pts, emulate a DOM,
or install animation globals. Rendering is explicit and deterministic.

## Status

The canvas milestone is implemented for PNG, JPEG, WebP, and raw RGBA output.
SVG and PDF are intentionally deferred to a later design.

The package targets the current Pts `revamp` branch, not the older npm-published
`pts@0.12.9` implementation. It is still marked private while the 0.1.0 API is
validated and until Pts publishes the revamp API under a distinct version.

## Installation

For an unpublished development checkout, install the Pts revamp branch and
skia-canvas explicitly:

```sh
npm install github:williamngan/pts#revamp skia-canvas
```

This repository's development and private peer requirements follow that branch,
and its lockfile pins the exact commit reviewed by the test suite. skia-canvas
installs a native binary. Once Pts assigns a distinct version to the revamp API
and this adapter is published, the Git peer will become a normal semver peer;
Pts and skia-canvas will remain explicit peer dependencies. If the older npm
implementation is resolved accidentally, construction fails with an
`INCOMPATIBLE_PTS` error instead of a missing-method TypeError.

For pnpm 11, approve only the reviewed native build in pnpm-workspace.yaml:

```yaml
allowBuilds:
  skia-canvas: true
```

For development in this repository:

```sh
pnpm install
pnpm check
```

## Quick start

```js
import { Circle, Pt } from "pts";
import { SkiaCanvasSpace } from "skia-pts-canvas";

const space = new SkiaCanvasSpace(1200, 630, {
  background: "#10131a",
});
const form = space.getForm();

space.add((_time, _delta, current) => {
  form
    .fillOnly("#67e8f9")
    .circle(Circle.fromCenter(current.center, 140))
    .fillOnly("#f8fafc")
    .font(48, "bold", undefined, 1.2, "sans-serif")
    .text(new Pt(80, 540), "Pts + Skia");
});

space.renderFrame(0);
await space.toFile("card.png", { density: 2 });
space.dispose();
```

The scene uses a 1200 by 630 logical coordinate system. Export density 2
produces a 2400 by 1260 PNG without changing Pts coordinates.

## Rendering model

SkiaCanvasSpace deliberately does not use requestAnimationFrame.

- Add Pts callbacks or IPlayer objects with space.add.
- Call renderFrame with the timestamp you want.
- Export the current scene afterward.
- Exporting never invokes players or advances time.

```js
space.renderFrame(0); // delta is 0
space.renderFrame(16); // derived delta is 16
space.renderFrame(100, { delta: 10 }); // explicit delta wins
```

This makes still images, tests, and frame sequences reproducible. Calls to play,
playOnce, replay, pause, resume, stop, and minFrameTime throw an
UnsupportedOperationError that points to renderFrame.

### Player lifecycle

The useful Pts lifecycle is preserved:

- resize runs when a player is added to the initialized space;
- start runs once when the player is added;
- animate runs once per renderFrame;
- remove and removeAll stop future animation callbacks;
- action is not generated because Node has no pointer input.

Player keys are snapshotted at frame entry. A player added during a frame starts
immediately but first animates on the next frame. A player removed before its
turn is skipped.

Frames are non-reentrant. A player cannot recursively render or resize the same
space.

## API

### SkiaCanvasSpace

```ts
new SkiaCanvasSpace(
  width?: number,
  height?: number,
  options?: {
    background?: string;
    id?: string;
    refresh?: boolean;
  },
);
```

Width and height default to 300 and 150. They must be positive integers.
Background defaults to transparent, and refresh defaults to true.

Important members:

| Member                     | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| getForm()                  | Create a SkiaCanvasForm for the shared context |
| renderFrame(time, options) | Render players once                            |
| clear(background?)         | Clear or fill the canvas                       |
| refresh(enabled)           | Toggle clearing before frames                  |
| resize(width, height)      | Resize logical and output dimensions           |
| resize(bound)              | Resize from a Pts Bound                        |
| toBuffer(format, options)  | Asynchronously encode a raster Buffer          |
| toFile(filename, options)  | Asynchronously write a raster file             |
| toURL(format, options)     | Asynchronously create an encoded data URL      |
| canvas                     | Narrow handle to the owned skia-canvas Canvas  |
| skiaCtx / ctx              | Canvas-compatible drawing context              |
| pointer                    | A clone of the center point                    |
| dispose()                  | Stop adapter operations and remove players     |

Construction and resize initialize the canvas to its configured background.
Exporting a blank space therefore produces that background without requiring a
frame.

### SkiaCanvasForm

SkiaCanvasForm extends Pts CanvasForm and supports its ordinary drawing
expressions. It adds:

- a precisely typed space accessor and the equivalent skiaSpace alias;
- skiaCtx, the Canvas-compatible Skia context;
- normalized Pts font strings;
- preservation of revamp's `"sample"` and `"char"` text-width estimator modes;
- structural Skia image and ImageData inputs;
- clear errors for browser-only offscreen operations.

The revamp CanvasForm generic currently constrains spaces to MultiTouchSpace,
but a non-interactive Node renderer correctly extends the backend-neutral Space
class. The adapter isolates that declaration mismatch internally. Both
form.space and form.skiaSpace are typed as SkiaCanvasSpace; no cast is needed in
consumer code.

Calling getForm more than once creates independent form state sharing one
context, matching Pts CanvasSpace behavior.

## Output

Supported adapter formats:

| Format     | Buffer | File | URL | Relevant options                          |
| ---------- | ------ | ---- | --- | ----------------------------------------- |
| PNG        | yes    | yes  | yes | density, matte, msaa                      |
| JPEG / JPG | yes    | yes  | yes | density, matte, msaa, quality, downsample |
| WebP       | yes    | yes  | yes | density, matte, msaa, quality             |
| Raw RGBA   | yes    | yes  | no  | density, matte, msaa                      |

```js
const png = await space.toBuffer("png");
const jpeg = await space.toBuffer("jpeg", { quality: 0.85 });
const webpURL = await space.toURL("webp", { quality: 0.9 });
await space.toFile("preview@2x.png", { density: 2 });
```

For toFile, a recognized extension selects the format. An ambiguous filename
requires options.format. A recognized extension and explicit conflicting format
are rejected.

SVG and PDF passed through these helpers are rejected with an explanation. The
raw canvas handle can reach more skia-canvas features, but those are outside the
0.1 adapter contract.

### Asynchronous export safety

skia-canvas renders and encodes asynchronously. While an adapter export is
pending:

- additional exports of the unchanged scene are allowed;
- renderFrame, clear, resize, and dispose are rejected.

This prevents Space-managed output from depending on whether a later frame or
resize raced the native encoder. Direct drawing through an existing form,
space.canvas, or space.skiaCtx bypasses this guard, so callers using those
escape hatches own synchronization.

Always await exports before allowing a process, request, or worker to finish.

## Images

Load images through skia-canvas rather than Pts Img:

```js
import { loadImage } from "skia-canvas";

const image = await loadImage("assets/photo.webp");
const form = space.getForm();

space.add(() => {
  form.image(
    [
      [20, 20],
      [220, 170],
    ],
    image,
  );
});
```

Skia Canvas, Image, and ImageData instances satisfy the adapter's structural
image types. Destination rectangles and source crop rectangles use the normal
Pts CanvasForm conventions.

## Fonts

Pts Font.value includes empty style and weight slots. Browsers often tolerate
that CSS string, while Skia may ignore it. SkiaCanvasForm builds a normalized
font string from the Pts Font fields.

Pts revamp text-width modes remain available and survive later font changes:

```js
form.fontWidthEstimate("char").font(28, "bold");
```

Register custom fonts with skia-canvas before drawing:

```js
import { FontLibrary } from "skia-canvas";

FontLibrary.use("Project Sans", ["fonts/project-regular.woff"]);
form.font(28, "normal", "normal", 1.2, "Project Sans");
```

Exact glyph pixels can still vary with fonts and platform rasterization.

## Direct context access

Most scenes should use SkiaCanvasForm. The underlying context remains available
for transforms, clipping, filters, and backend-specific operations:

```js
const context = space.skiaCtx;
context.save();
context.translate(20, 20);
context.rotate(Math.PI / 8);
context.restore();
```

If direct context code changes styles that a form also manages, call
form.reset() before relying on the form's stored styles again.

The public canvas handle intentionally avoids importing skia-canvas declarations
because skia-canvas 3.0.8 references the optional Sharp package from its type
entry point. Advanced callers can import or cast to the native types when their
project already handles that optional declaration.

## Resize and clear

Resize resets the Skia context, reapplies all forms, initializes the configured
background, and notifies player resize callbacks. It does not animate players.
Existing forms remain usable.

clear always clears existing pixels before filling a non-transparent background,
so translucent backgrounds do not accumulate alpha when refresh is enabled.

Set refresh(false) for trails or cumulative drawing. A single frame can override
it:

```js
space.refresh(false);
space.renderFrame(16);
space.renderFrame(32, { clear: true });
```

## Native deployment

skia-canvas downloads a platform-specific native binary during installation or
falls back to compilation. Treat it as an external native dependency when
bundling server applications.

The initial local verification is Node 24 on Linux x64 with glibc. CI is
configured to exercise Node 20, 22, and 24 on Linux plus Node 22 native smoke
tests on macOS and Windows. Only combinations that pass CI should be treated as
supported.

See the
[skia-canvas deployment documentation](https://github.com/samizdatco/skia-canvas)
for current platform and serverless details.

## Current limitations

- Node.js only; no browser export is advertised.
- Raster output only through adapter helpers.
- No requestAnimationFrame scheduler.
- No pointer, keyboard, touch, or resize-observer events.
- No Pts Img wrapper.
- No CanvasSpace offscreen helpers or MediaRecorder.
- No deterministic revocation of native handles after dispose.
- Exact browser pixel parity is not promised.

The full design and acceptance criteria are in
[plans/CANVAS-INTEGRATION-PLAN.md](plans/CANVAS-INTEGRATION-PLAN.md).

## Development

Development uses `github:williamngan/pts#revamp`. Updating the lockfile to a new
revamp commit is an intentional compatibility update and should be followed by
the complete check suite.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm test:types
pnpm test:pack
pnpm package:check
```

Run the example:

```sh
pnpm example
```

It writes out/basic-card.png, which is ignored by Git.

## License

Apache-2.0.
