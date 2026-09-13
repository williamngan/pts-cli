# Canvas integration plan

> Historical first-milestone plan. The implemented CLI, portable/browser scene
> contract, classic loader, and SVG scope are documented in
> [README.md](../README.md) and
> [COMPATIBILITY-NOTES.md](COMPATIBILITY-NOTES.md). Statements below that defer
> SVG or browser mounting describe the earlier milestone, not the current
> package surface.

Status: Implemented locally; cross-platform CI and publication pending  
Date: 2026-08-18  
Initial release target: 0.1.0  
Scope: Node.js raster rendering with Pts and skia-canvas  
Out of scope for this plan: SVG, PDF, browser rendering, and changes to Pts

## 1. Decision

Proceed with skia-canvas as the first Node.js rendering backend for Pts.

Implementation checkpoint: the canvas core, raster exports, compatibility layer,
tests, ESM/CommonJS build, packed-consumer smoke tests, documentation, example,
and CI workflow are now present in this repository. The local verification suite
passes on Node 24/Linux x64. Remaining release work is to observe the configured
Node/OS matrix in hosted CI, add registered-font and remaining CanvasForm
category coverage, obtain a distinct released version for the Pts revamp API,
and decide when to remove the private package flag.

The integration will live entirely in this repository. Pts will be consumed as
an immutable external package and will not be patched, forked, monkey-patched,
or asked to install browser globals. The adapter will provide the small amount
of lifecycle, type, and compatibility code needed to connect Pts drawing
primitives to a skia-canvas 2D context.

The first release will support deterministic raster image generation. Its
official output formats will be PNG, JPEG, WebP, and raw RGBA pixels. Although
skia-canvas can also export SVG and PDF, those formats will not be exposed by
the adapter's first public export API. They deserve a separate design pass
because vector output has different questions around fonts, text outlining,
multi-page documents, fidelity, and testing.

This is a good fit because:

- Pts CanvasForm performs ordinary Canvas 2D drawing operations.
- skia-canvas implements the Canvas 2D API in Node.js.
- Pts already permits CanvasForm subclasses to initialize a custom context.
- skia-canvas has asynchronous bitmap export methods suitable for servers and
  batch jobs.
- The remaining mismatch is narrow enough to isolate in an adapter: Pts space
  lifecycle, browser-oriented TypeScript declarations, strict font parsing, and
  a few browser-only CanvasForm methods.

The adapter should remain thin. It should not copy CanvasForm drawing algorithms
or reproduce all of Pts Space. It should inherit the reusable parts of those
abstractions, override the browser-specific parts, and keep all unsafe casts in
one internal module.

## 2. Why canvas first is the right boundary

Canvas-first reduces the number of independent variables in the first release.
It lets the project validate the important integration seam—Pts geometry and
forms drawing through a non-browser context—without simultaneously designing a
vector document model.

Raster rendering also covers the most immediate Node.js use cases:

- social cards and Open Graph images;
- generative art and procedural textures;
- charts, diagrams, and report images;
- thumbnails and server-side previews;
- test fixtures and visual snapshots;
- batch rendering for datasets or static sites;
- image composition in web services and worker jobs.

Deferring SVG is not an architectural dead end. The proposed design keeps render
scheduling separate from output encoding, so a later vector backend can reuse
lifecycle lessons without pretending that SVG is just another bitmap format.

## 3. Goals

### 3.1 Product goals

1. Let a Node.js program use familiar Pts players and CanvasForm expressions to
   produce a raster image without a DOM.
2. Make a one-frame render deterministic and explicit.
3. Preserve the Pts authoring style where it is meaningful in Node:
   space.add(...), space.getForm(), Pts geometry helpers, and CanvasForm drawing
   methods.
4. Expose the underlying skia-canvas Canvas and context for advanced operations
   without requiring the adapter to wrap every Skia feature.
5. Provide a small, typed API that works from both ESM and CommonJS.
6. Make package installation, native dependency behavior, supported runtimes,
   and known Canvas differences clear.
7. Establish tests that distinguish “a file was written” from “the expected
   pixels were rendered.”

### 3.2 Engineering goals

1. Make no source or declaration changes in the Pts repository.
2. Avoid global requestAnimationFrame, document, window, Element, Image, or
   other DOM shims at runtime.
3. Keep backend casts and type adaptation out of user code.
4. Do not bundle Pts or skia-canvas into the published JavaScript.
5. Delegate encoding and native resource management to skia-canvas.
6. Keep rendering and exporting as separate operations.
7. Fail clearly when a caller reaches an intentionally unsupported browser-only
   API.
8. Make a future SVG package or entry point possible without changing the raster
   API.

## 4. Non-goals for 0.1.0

The following are explicitly not part of the first release:

- changing Pts or maintaining a Pts fork;
- SVG or PDF output through the adapter;
- DOM emulation or browser CanvasSpace compatibility;
- pointer, mouse, touch, keyboard, or resize-observer events;
- requestAnimationFrame-driven animation;
- real-time windows or interactive Skia applications;
- video/GIF encoding or a MediaRecorder equivalent;
- Pts Img loading, because Pts Img depends on browser image facilities;
- browser bundles, edge runtimes, Deno, Bun, or Cloudflare Workers;
- a worker pool or batch-render scheduler;
- an offscreen-canvas abstraction in SkiaCanvasForm;
- exact pixel identity with every browser and operating system;
- wrapping all skia-canvas APIs;
- silently accepting vector formats through the adapter's raster export helpers.

Users may still access capabilities directly through space.canvas or
space.skiaCtx, but doing so does not make those capabilities part of the
adapter's 0.1 compatibility contract.

## 5. Constraints discovered during repository review

### 5.1 Pts constraints

- CanvasForm accepts either a CanvasSpace or a RenderingContext2D. A skia-canvas
  context is compatible at runtime, but it is not declared as a DOM
  CanvasRenderingContext2D.
- The revamp CanvasForm is generic over `S extends MultiTouchSpace`, while a
  non-interactive renderer correctly extends the backend-neutral `Space` base.
  Extending `MultiTouchSpace` only to satisfy that constraint would falsely add
  browser interaction APIs. SkiaCanvasForm therefore localizes the mismatch to
  `CanvasForm<any>` and immediately overrides `space` as SkiaCanvasSpace. The
  `skiaSpace` accessor remains a discoverable alias.
- The no-argument CanvasForm constructor is intentionally available for custom
  context subclasses. This is the safest extension seam.
- The normal CanvasForm constructor immediately writes its default font. Pts
  Font.value can contain leading empty style/weight fields. skia-canvas is
  stricter about CSS font syntax, so the adapter must normalize the string
  before assigning it.
- The revamp exposes a protected cached style setter and
  CanvasForm.resetStyleCache. The adapter should use those hooks directly so
  multiple forms sharing one Skia context cannot hold contradictory style
  caches.
- The latest reviewed revamp tracks `"sample"` and `"char"` text-width estimator
  modes. Because SkiaCanvasForm overrides font assignment to normalize Skia's
  CSS font string, it must preserve and reapply the selected estimator mode just
  as the revamp CanvasForm does. The currently pushed lockfile commit predates
  that addition, so a narrow adapter fallback must provide equivalent `"char"`
  behavior until the reviewed local commits are pushed and locked.
- CanvasForm.useOffscreen and CanvasForm.renderOffscreen assume CanvasSpace
  browser facilities. They cannot be inherited as working Node APIs.
- Space has useful player bookkeeping and bounds behavior, but its play loop
  calls global requestAnimationFrame and cancelAnimationFrame. The Node adapter
  must never invoke that loop.
- Space.playItems is not safe to reuse for the Node frame path. It owns private
  refresh state and contains an inherited stop branch that calls
  cancelAnimationFrame. SkiaCanvasSpace will reuse Space's player storage,
  bounds, add/remove, and public geometry accessors, but will own its small
  deterministic player traversal.
- Pts declarations contain DOM types. This is a compile-time concern even though
  the adapter will have no DOM runtime dependency.

### 5.2 skia-canvas constraints

- skia-canvas is a native Node.js dependency with an install step that downloads
  a prebuilt binary or compiles one.
- Its primary file and buffer export methods are asynchronous and run rendering
  work away from the main JavaScript thread. The adapter should preserve that
  model.
- Canvas drawing is deferred until export. Export must therefore be awaited
  before a process exits or a response is completed.
- Bitmap output supports PNG, JPEG, WebP, and raw pixels. Export density is a
  backend option and should not be confused with the logical Pts coordinate
  system.
- The package exposes ESM and CommonJS entry points and a Node-specific export
  condition.
- Some skia-canvas declarations refer to optional integrations such as Sharp. A
  strict consumer typecheck must verify whether those declarations require an
  additional type-only workaround.
- Native availability varies by OS, CPU architecture, libc, and Node version. CI
  and documentation must reflect the combinations the project actually verifies.

### 5.3 Repository constraint

This repository currently contains only its Apache-2.0 license. The initial
implementation can therefore choose a clean package structure without migration
work. It must still avoid unnecessary framework and tooling weight.

### 5.4 Planning baselines

The repository review and package-level compatibility spike use these concrete
baselines:

- the Pts `revamp` branch as the authoritative API, never the npm-published
  `pts@0.12.9` implementation;
- GitHub revamp commit `89205a1d8e736aee340a021f4b201034dde8e0fa` as the
  reproducible install recorded in the current lockfile;
- a read-only review of the neighboring revamp checkout through commit
  `7a14a7595f061a311026d1e3c6dfeef686ef6c1f`, including its newer typography
  estimator modes;
- skia-canvas 3.0.8 documentation and package metadata;
- Node.js 24 in the local planning environment.

The development dependency follows `github:williamngan/pts#revamp`, while the
lockfile pins the exact fetched commit for reproducibility. The neighboring Pts
checkout is read-only input, not a persistent dependency. One compatibility pass
temporarily redirected this repository's `node_modules/pts` symlink to the
checkout, then restored the locked target; it did not install into, build, or
modify Pts. When newer reviewed commits are pushed to the branch, updating the
lockfile is an intentional compatibility update with the full check suite.

The revamp package still reports version 0.12.9, the same version as the older
npm release. A semver peer range therefore cannot distinguish the required API
yet. While the adapter is private, its peer and development requirements both
use `github:williamngan/pts#revamp`. The package stays private until revamp has
a distinct release version; at that point the Git peer must become a semver
range before publication. A small runtime capability check still turns an
overridden or otherwise incorrect resolution into an actionable
`INCOMPATIBLE_PTS` error.

## 6. Proposed architecture

### 6.1 Package boundary

The package will export:

- SkiaCanvasSpace: the deterministic Node rendering space;
- SkiaCanvasForm: the CanvasForm-compatible drawing form;
- raster export option and format types;
- the adapter's explicit unsupported-operation error type, if a custom error is
  useful to consumers;
- a small createSkiaCanvasSpace factory only if it improves inference or
  constructor ergonomics during implementation.

The package will not re-export all of Pts or skia-canvas. Applications should
import geometry helpers from pts and native image/font helpers from skia-canvas.
This avoids an accidental second public API and makes ownership clear.

### 6.2 Class relationship

The preferred design is:

```text
Pts Space
  └── SkiaCanvasSpace
        ├── owns skia-canvas Canvas
        ├── owns its 2D context
        ├── owns or lazily creates SkiaCanvasForm
        ├── supplies bounds and player lifecycle
        ├── exposes renderFrame()
        └── exposes raster export methods

Pts CanvasForm
  └── SkiaCanvasForm
        ├── initializes through CanvasForm's no-context extension path
        ├── attaches the Skia context through one internal cast boundary
        ├── normalizes font strings
        ├── exposes skiaCtx through a stable Canvas-compatible type
        └── rejects browser-only offscreen methods
```

SkiaCanvasSpace should extend Pts Space, not Pts CanvasSpace:

- Space provides bounds, center, size, player storage, and add/remove behavior.
  SkiaCanvasSpace overrides refresh and owns frame traversal so browser
  cancellation cannot be reached accidentally.
- CanvasSpace imports DOM construction, resize observers, events, pointer
  handling, media recording, and browser animation. None belongs in a Node
  adapter.
- Extending Space avoids copying Pts player bookkeeping while keeping browser
  objects out of the runtime path.

SkiaCanvasForm should extend the revamp CanvasForm using the no-argument super
constructor. Because revamp currently constrains its space generic to
MultiTouchSpace, the implementation should use `CanvasForm<any>` only at the
inheritance seam, then override `space` with SkiaCanvasSpace. It should
initialize its protected context, styles, normalized font, readiness flag, and
adapter-space reference itself. Calling the ordinary CanvasForm(context)
constructor is specifically avoided because the initial un-normalized font
assignment may fail before the subclass can correct it.

Both form.space and form.skiaSpace must return the same runtime object and
expose the precise SkiaCanvasSpace type. The alias makes backend-specific code
easy to find without sacrificing the familiar Pts accessor.

### 6.3 Internal compatibility boundary

Create one internal module for backend type adaptation. It will:

- define the skia-canvas context type from the installed package;
- document why it is Canvas-compatible at runtime but not assignable to the DOM
  declaration;
- contain the conversion to Pts RenderingContext2D;
- contain any conversion needed by inherited CanvasForm image methods;
- expose no “cast this yourself” requirement to package users.

Every unsafe cast should carry a short comment naming the runtime contract it
depends on. A repository search for “as unknown as” should yield only reviewed
adapter-boundary sites.

### 6.4 Why not copy the old Node adapter pattern

An earlier Node/Pts integration can be useful as behavioral reference, but this
project should not copy a full Space implementation. A copied player loop drifts
as Pts evolves, duplicates subtle lifecycle rules, and makes later Pts
compatibility harder to reason about.

The new package should reuse Pts Space where it is genuinely backend-neutral,
then own only:

- synchronous Node initialization;
- explicit frame scheduling;
- Skia canvas/context construction;
- raster export;
- backend-specific cleanup and errors.

### 6.5 No global shims

The adapter must not install requestAnimationFrame, cancelAnimationFrame,
window, document, Image, or Event on globalThis. Shims hide unsupported
semantics and can interfere with host applications and test runners.

Browser-only inherited lifecycle methods will be overridden and will throw a
stable, actionable error directing callers to renderFrame. This includes play,
playOnce, replay, pause, resume, stop, and minFrameTime unless a later design
adds an explicit Node scheduler.

### 6.6 Determinism, reentrancy, and asynchronous export

The second plan review adds three explicit state rules:

1. renderFrame is non-reentrant. A player cannot recursively render or resize
   the same space.
2. Each frame snapshots player keys at entry. Players added during a frame begin
   on the next frame; a player removed before its turn is skipped.
3. While an asynchronous export is pending, Space-managed clearing, resizing,
   disposal, and additional frames are rejected. Multiple exports of the same
   unchanged scene may run concurrently. Existing form and raw context handles
   cannot be intercepted, so callers using them own synchronization.

The third rule prevents deferred Skia rendering from racing with Space-managed
mutations made after toBuffer, toFile, or toURL returns its Promise. Direct
drawing through an existing form, space.canvas, or space.skiaCtx is an
intentional escape hatch and cannot be guarded by the space; callers using it
own synchronization.

## 7. Draft public API

The exact spelling is subject to a Phase 0 type spike, but implementation should
start from this contract.

```ts
import type { Bound, IPlayer, RenderingContext2D } from "pts";

export type RasterFormat = "png" | "jpg" | "jpeg" | "webp" | "raw";
export type SkiaCanvasContext2D = RenderingContext2D;

export interface SkiaCanvas {
  width: number;
  height: number;
  // Narrow Canvas and export surface; native types remain internal.
}

export interface SkiaCanvasSpaceOptions {
  background?: string;
  id?: string;
  refresh?: boolean;
}

export interface RenderFrameOptions {
  delta?: number;
  clear?: boolean;
}

export interface RasterExportOptions {
  density?: number;
  matte?: string;
  quality?: number;
  msaa?: boolean | number;
  downsample?: boolean;
}

export class SkiaCanvasSpace extends Space {
  constructor(
    width?: number,
    height?: number,
    options?: SkiaCanvasSpaceOptions,
  );

  readonly canvas: SkiaCanvas;
  readonly skiaCtx: SkiaCanvasContext2D;
  readonly ready: boolean;
  background: string;

  getForm(): SkiaCanvasForm;
  renderFrame(time?: number, options?: RenderFrameOptions): this;
  resize(width: number, height: number): this;
  resize(bound: Bound): this;
  clear(background?: string): this;
  dispose(): this;

  toBuffer(
    format?: RasterFormat,
    options?: RasterExportOptions,
  ): Promise<Buffer>;

  toFile(
    filename: string,
    options?: RasterExportOptions & { format?: RasterFormat },
  ): Promise<void>;

  toURL(
    format?: Exclude<RasterFormat, "raw">,
    options?: RasterExportOptions,
  ): Promise<string>;
}

export class SkiaCanvasForm extends CanvasForm<any> {
  readonly space: SkiaCanvasSpace;
  readonly skiaSpace: SkiaCanvasSpace;
  readonly skiaCtx: SkiaCanvasContext2D;

  font(
    sizeOrFont: number | Font,
    weight?: string,
    style?: string,
    lineHeight?: number,
    family?: string,
  ): this;

  fontWidthEstimate(mode?: boolean | "sample" | "char"): this;
}
```

Notes:

- Default dimensions should match the Canvas convention, 300 by 150, unless
  implementation evidence gives a compelling reason not to.
- The inherited form.ctx and skiaCtx accessors use the stable Pts
  RenderingContext2D surface. The public Canvas handle is similarly narrowed so
  skia-canvas's optional Sharp declaration does not leak into strict consumers.
  Advanced users can import and cast to native Skia types explicitly.
- Constructor dimensions are logical Pts units. Export density controls output
  pixel dimensions.
- RasterExportOptions should be derived from skia-canvas declarations where
  possible, then narrowed to bitmap-relevant fields. Do not hand-maintain a
  stale copy if an appropriate public backend type exists.
- JPEG should use the canonical API spelling while accepting a jpg file
  extension in toFile.
- Async methods are the supported export path. Synchronous export wrappers are
  intentionally omitted from 0.1. Advanced callers can use space.canvas directly
  if blocking behavior is appropriate.

## 8. Example usage target

This should be possible without browser globals:

```ts
import { Circle, Pt } from "pts";
import { SkiaCanvasSpace } from "skia-pts-canvas";

const space = new SkiaCanvasSpace(1200, 630, {
  background: "#10131a",
});
const form = space.getForm();

space.add((_time, _delta, current) => {
  const center = current.center;

  form
    .fillOnly("#67e8f9")
    .circle(Circle.fromCenter(center, 140))
    .fillOnly("#f8fafc")
    .font(48, "bold", undefined, 1.2, "sans-serif")
    .text(new Pt(80, 540), "Pts + Skia");
});

space.renderFrame(0);
await space.toFile("card.png", { density: 2 });
space.dispose();
```

The exported image would be 2400 by 1260 pixels, while the scene remains in a
1200 by 630 logical coordinate system.

Rendering and export are deliberately separate. Calling toFile or toBuffer must
not run players again. This prevents hidden state changes and lets one rendered
scene be encoded into several formats.

## 9. Behavioral contract

### 9.1 Construction and readiness

Construction is synchronous:

1. Validate finite, positive integer width and height.
2. Create the skia-canvas Canvas.
3. Acquire its 2D context.
4. Initialize a Bound from (0, 0) to (width, height).
5. Set the pointer to the center for compatibility with non-interactive Pts
   sketches.
6. Mark the space ready.
7. Clear/fill the canvas immediately with the configured background.

No ready event is dispatched. The ready getter is true after successful
construction. Consequently, exporting before adding or rendering players still
produces the configured blank background.

getForm follows Pts CanvasSpace and returns a new form on each call. All forms
share the same context and its CanvasForm style cache. If resize testing shows
that Skia replaces the context, the space will retain and retarget forms it
created; otherwise it will not keep unnecessary strong references.

### 9.2 Player lifecycle

The adapter will preserve meaningful IPlayer behavior:

- add(function) and add(IPlayer) both work;
- resize is called with the initialized bound when a player is added;
- start is called once for each player added to a ready space;
- animate is called once per successful renderFrame call;
- remove and removeAll prevent future frame callbacks;
- action is retained on the player type but never invoked automatically because
  there is no input system.

The implementation must test adding a player after earlier frames. Its start
callback still runs exactly once.

Player keys are snapshotted when a frame begins. A player added by another
player starts immediately but first animates on the following frame. A player
removed before its snapshotted turn is skipped. This avoids engine-dependent
object-enumeration behavior.

If reusing Space.add makes exact start tracking awkward for function players,
the adapter may track player keys before and after super.add. It should not
duplicate the entire add implementation.

### 9.3 Frame timing

renderFrame is the only 0.1 scheduling primitive.

- time defaults to 0.
- delta can be provided explicitly.
- If delta is omitted, it is derived from the previous rendered time.
- The first implicit delta is 0.
- time and delta must be finite numbers.
- A failed frame must not leave isPlaying true.
- A recursive renderFrame call throws before invoking any nested players.
- resize, export, and dispose throw while a frame is active.
- renderFrame returns the space for fluent use.
- Player execution order follows Pts Space's player insertion behavior.
- Calling an export method does not change time or call players.

Because there is no built-in scheduler, inherited minFrameTime has no honest
meaning and should fail clearly rather than appear to work.

### 9.4 Refresh and clear

Pts refresh behavior should remain:

- refresh(true), the default, clears before every frame;
- refresh(false) allows trails and cumulative drawing;
- RenderFrameOptions.clear, if implemented, overrides refresh for that single
  frame without changing the persistent setting;
- transparent clear removes existing pixels;
- an opaque background fills the complete logical canvas;
- a translucent background first clears, then fills, so repeated frames do not
  accidentally accumulate alpha unless refresh is disabled.

clear(background) updates the stored background only when an argument is
provided. It must preserve form styles and transformations.

CanvasForm's style cache must be reset whenever direct context save/restore or
resize can make its remembered values diverge from actual Skia state.

### 9.5 Context isolation for frames

Each frame should use context save/restore around player callbacks, matching the
intent of Pts CanvasSpace. The implementation must:

1. save the context;
2. clear if required;
3. snapshot player keys and invoke still-present players in snapshot order;
4. restore the context in a finally block;
5. reset CanvasForm's shared style cache;
6. restore isPlaying even when a player throws;
7. rethrow the original player error.

This keeps accidental transforms or clipping from leaking across frames while
allowing style state managed by the form to be reapplied correctly.

### 9.6 Resize

Resize must:

- reject fractional, non-finite, zero, or negative dimensions;
- update canvas dimensions and Pts bound;
- update center, size, width, height, and pointer consistently;
- notify player resize callbacks exactly once per resize;
- reset context state and CanvasForm style caches;
- preserve the configured background;
- initialize the resized canvas to that background immediately;
- leave getForm returning a usable form;
- not render a frame implicitly.

Phase 0 must determine whether changing skia-canvas width/height preserves
Canvas and context identity. The public contract is that existing SkiaCanvasForm
instances continue drawing to the resized space. If Skia replaces the context
internally, the adapter must retarget its owned forms or document a hard
limitation before 0.1.0. Silent drawing to a stale context is not acceptable.

### 9.7 Export

The adapter's export helpers will:

- accept only PNG, JPEG, WebP, and raw formats;
- delegate encoding to the current skia-canvas Canvas;
- preserve Skia's asynchronous behavior;
- validate density as a finite integer of at least 1 if Skia requires an
  integer;
- validate quality only for the formats where it is meaningful;
- reject SVG and PDF with an error that states they are deferred, rather than
  passing them through accidentally;
- infer PNG/JPEG/WebP from a recognized toFile extension;
- require an explicit format for ambiguous filenames;
- never create parent directories implicitly;
- never invoke renderFrame implicitly;
- reject adapter-managed canvas mutation until each pending export settles;
- permit concurrent exports only while the scene remains unchanged;
- propagate backend I/O and encoding errors without replacing their cause.

For raw output, tests must specify and document channel ordering. The first
release should use Skia's RGBA default unless a typed colorType option is
deliberately supported.

### 9.8 Disposal

dispose should be idempotent. It will:

- remove all players;
- drop adapter-held form references where safe;
- mark the space not ready;
- prevent future render, resize, and export calls with a clear disposed error;
- release JavaScript references to native objects when possible.

Disposal during a frame or pending export will throw rather than invalidate work
in progress. Once the operation settles, disposal can be retried. A form,
Canvas, or context reference previously obtained by a caller remains a raw
object; the adapter cannot revoke it.

The implementation should not promise deterministic native-memory reclamation
unless skia-canvas exposes an explicit disposal API. Documentation should state
that final native cleanup may follow normal garbage collection.

## 10. CanvasForm compatibility plan

### 10.1 Required drawing surface

The first release must verify these Pts CanvasForm categories:

- styles: fill, stroke, fillOnly, strokeOnly, alpha, line width/join/cap;
- primitives: point, points, circle, ellipse, arc, square, line, polygon,
  rectangle;
- curves and paths used by CanvasForm;
- transforms exercised through the underlying context;
- gradients;
- text, text boxes, alignment, and measurement;
- dashes and compositing where exposed by CanvasForm;
- image and ImageData drawing using objects loaded by skia-canvas.

“Verify” does not mean every browser edge case is promised. It means the adapter
has at least one meaningful integration test for each category and documents any
known divergence.

### 10.2 Font normalization

SkiaCanvasForm will own a helper that builds a valid CSS font string from Pts
Font fields:

1. Include style only when non-empty.
2. Include weight only when non-empty.
3. Include size and line height in the form sizepx/lineHeight.
4. Append the font face unchanged so quoted family names and fallback lists
   survive.
5. Join present tokens with one space and trim the final string.

SkiaCanvasForm.font will update the inherited Font object and write only the
normalized value through revamp's protected cached style setter. It must also
refresh the optional text-width estimator in the same situations as
CanvasForm.font and preserve the selected `"sample"` or `"char"` mode.

Tests must cover:

- the default font during form construction;
- size only;
- bold;
- italic;
- bold italic;
- custom line height;
- a quoted family containing spaces;
- a fallback family list;
- Font object input;
- font registration through skia-canvas FontLibrary.

### 10.3 Images

The adapter should not wrap Pts Img in 0.1. Instead:

- users load images through skia-canvas Image, loadImage, or ImageData;
- SkiaCanvasForm provides type-safe overloads for those backend image types;
- drawing delegates to the existing CanvasForm coordinate/crop calculations
  where runtime behavior is compatible;
- tests cover point placement, destination rectangle scaling, source cropping,
  and ImageData placement;
- remote URL fetching remains skia-canvas behavior and is not an adapter
  concern.

The README must make this import boundary explicit.

### 10.4 Unsupported form operations

useOffscreen and renderOffscreen should be overridden to throw an error such as:

“SkiaCanvasForm does not implement Pts CanvasSpace offscreen rendering. Use a
second skia-canvas Canvas and drawImage, or access space.canvas directly.”

The package must not leave inherited methods that fail later with an unrelated
undefined-property error.

### 10.5 Direct context access

SkiaCanvasForm.skiaCtx and SkiaCanvasSpace.skiaCtx provide a stable,
Canvas-compatible context surface. If a caller mutates context styles directly,
the README should instruct them to call form.reset(), consistent with
CanvasForm's cache contract. Callers that need backend-only members can import
and cast to skia-canvas's native type in an application that already resolves
its optional declarations.

The adapter should not proxy or intercept every direct context mutation.

## 11. TypeScript strategy

### 11.1 Public types

- Build declarations from TypeScript source.
- Use import type for Pts and backend types wherever possible.
- Avoid exporting anonymous inferred types that mention internal skia-canvas
  paths.
- Export named adapter option types.
- Keep public Canvas and context handles useful but narrow enough that optional
  skia-canvas integrations do not leak into every consumer.
- Add compile-time tests for method chaining and player callback inference.

### 11.2 DOM declaration leakage

Pts public declarations reference DOM types even when only geometry and Space
are used. The initial pragmatic approach is to emit a reference-lib declaration
for DOM types in the adapter's type entry point. This is type-only and must not
introduce a runtime dependency.

Before accepting that approach, create a strict consumer fixture with:

```json
{
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": false
  }
}
```

The fixture must import the package, construct a space, add a player, draw a
shape, and export a PNG. If declaration emission does not preserve the DOM
reference, configure the declaration entry explicitly rather than telling all
consumers to change their project.

The tradeoff must be documented: DOM names become available to TypeScript
because Pts declarations require them, but no DOM implementation is installed or
used.

### 11.3 Optional Sharp type risk

Run the strict consumer fixture without Sharp installed. If skia-canvas's
declarations make that fail:

1. Determine whether the adapter's public type surface can avoid loading the
   declaration that imports Sharp.
2. Prefer a local structural type for only the Canvas/context members the
   adapter exposes if that avoids the optional type dependency without losing
   useful inference.
3. If it cannot be isolated, report the upstream declaration issue and document
   the minimal consumer workaround.
4. Do not add Sharp as a runtime dependency merely to satisfy an unused optional
   method.
5. Do not make skipLibCheck: true the only test configuration.

This is a release-gating type spike, not a detail to discover after publishing.

### 11.4 Module compatibility

Publish:

- an ESM entry;
- a CommonJS entry;
- one declaration entry or correctly conditioned declarations;
- explicit exports with import, require, types, and default behavior as needed;
- Node-only package metadata.

Validate the packed package with:

- Node ESM import;
- Node CommonJS require;
- TypeScript NodeNext;
- TypeScript Node16/CommonJS;
- publint;
- Are the Types Wrong.

No browser export should be advertised in 0.1.

## 12. Dependency and packaging strategy

### 12.1 Package manager and toolchain

Use pnpm and commit the lockfile. Pin the packageManager field to the exact pnpm
version used for the initial release so CI and contributors resolve the native
dependency consistently.

Keep the toolchain small:

- TypeScript for source and declarations;
- tsdown for ESM/CommonJS library builds;
- Vitest for unit and integration tests;
- ESLint and Prettier for source consistency;
- publint and Are the Types Wrong for package validation.

This aligns with the current Pts toolchain without coupling the repositories.

### 12.2 Runtime dependency ownership

Recommended initial policy:

- pts is a peer dependency;
- skia-canvas is a peer dependency;
- exact tested versions of both are dev dependencies.

Rationale:

- A peer keeps one Pts class identity, which matters for instanceof checks such
  as Pts Img.
- A peer lets applications control the native skia-canvas version and its
  platform installation.
- Users must explicitly install and approve skia-canvas's native build script,
  which is clearer than a transitive native install.
- Exact dev dependencies give CI a reproducible tested baseline.

Start with narrow peer ranges based on versions verified in Phase 0. Widen only
after compatibility CI covers additional releases. Mark peers as required.

If installation testing shows that two required peer installs are too surprising
for the target audience, reconsider making skia-canvas a direct dependency
before 1.0. Do not change ownership solely for quick-start brevity—the native
binary lifecycle is the more important constraint.

### 12.3 Native install documentation

The README must include:

- supported Node, OS, architecture, and libc combinations;
- that skia-canvas runs an install script;
- pnpm 11's allowBuilds configuration for the reviewed skia-canvas install
  script;
- what happens when a prebuilt binary is unavailable;
- bundler/serverless guidance to externalize skia-canvas;
- an AWS Lambda pointer if it is verified, without claiming universal serverless
  support;
- a diagnostic command that imports skia-canvas and renders a tiny image.

### 12.4 Published contents

The package tarball should include only:

- built ESM and CommonJS files;
- declarations and source maps if deliberately supported;
- README, LICENSE, and package metadata;
- optionally one small example if it materially improves the npm package.

It should exclude source fixtures, golden images, plans, coverage, temporary
exports, and native artifacts from the development machine.

## 13. Proposed repository layout

```text
skia-pts-canvas/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml              # only when release automation is chosen
├── examples/
│   ├── basic-card.ts
│   ├── gradients.ts
│   ├── image-composition.ts
│   └── deterministic-frames.ts
├── plans/
│   └── CANVAS-INTEGRATION-PLAN.md
├── src/
│   ├── index.ts
│   ├── SkiaCanvasForm.ts
│   ├── SkiaCanvasSpace.ts
│   ├── compatibility.ts
│   ├── errors.ts
│   └── types.ts
├── test/
│   ├── fixtures/
│   │   ├── esm-consumer/
│   │   ├── cjs-consumer/
│   │   └── strict-types-consumer/
│   ├── integration/
│   │   ├── canvas-form.test.ts
│   │   ├── export.test.ts
│   │   ├── images.test.ts
│   │   └── lifecycle.test.ts
│   ├── unit/
│   │   ├── font.test.ts
│   │   ├── options.test.ts
│   │   └── validation.test.ts
│   └── helpers/
│       ├── pixels.ts
│       └── temp-output.ts
├── .editorconfig
├── .gitignore
├── .npmignore                     # only if package files is insufficient
├── .prettierignore
├── .prettierrc.json
├── CHANGELOG.md
├── LICENSE
├── README.md
├── eslint.config.mjs
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsdown.config.mts
└── vitest.config.mts
```

Do not create every file before it has content. This layout is the target, not
permission to scaffold empty placeholders.

## 14. Implementation phases

### Phase 0: compatibility spikes and contract lock

Purpose: retire the high-risk unknowns before building the package surface.

Tasks:

1. Initialize only the minimum package metadata needed to install exact
   development versions of Pts and skia-canvas.
2. Confirm a plain Pts CanvasForm method can draw a geometric primitive through
   a Skia context at runtime.
3. Reproduce and characterize default/font assignment behavior.
4. Confirm the no-argument CanvasForm subclass can initialize protected form
   state without a Pts change.
5. Exercise all context methods used by CanvasForm and record missing or
   behaviorally different methods.
6. Test Canvas width/height mutation, context identity, state reset, and form
   retargeting requirements.
7. Test save/restore plus CanvasForm style caching.
8. Test transparent and translucent clearing.
9. Test skia-canvas Image and ImageData through CanvasForm coordinate logic.
10. Run strict TypeScript consumer fixtures without DOM in lib and without Sharp
    installed.
11. Confirm ESM and CommonJS imports for both dependencies.
12. Verify native install on the local Node runtime and record platform facts.

Deliverable:

- a short compatibility note under plans or docs recording observed behavior,
  dependency versions, and the final API deviations from this proposal.

Exit criteria:

- A small in-repository spike renders and verifies pixels for a shape and text.
- The font workaround is proven.
- Resize behavior has a viable form-lifetime strategy.
- The strict type strategy is known.
- No Pts files were changed.

### Phase 1: package skeleton

Tasks:

1. Add package.json with private true until release readiness.
2. Add the pinned packageManager value and pnpm lockfile.
3. Configure TypeScript strict mode.
4. Configure tsdown for external Pts/skia dependencies, ESM, CommonJS, source
   maps, and declarations.
5. Add lint, format, typecheck, build, test, test:types, test:pack, and
   prepublishOnly scripts.
6. Add a minimal exports map and files allowlist.
7. Add source entry points and named option types.
8. Add .gitignore rules for dist, coverage, native/build output, and generated
   images.

Exit criteria:

- pnpm build produces only intended artifacts.
- Both module formats import successfully.
- npm pack --dry-run contains only intended files.

### Phase 2: SkiaCanvasSpace core

Tasks:

1. Implement dimension and option validation.
2. Construct Canvas, context, bound, background, pointer, and readiness
   synchronously.
3. Implement canvas, skiaCtx, ready, background, and form accessors.
4. Reuse Space player storage and meaningful add/remove/refresh behavior.
5. Implement start-on-add behavior for a ready Node space.
6. Override refresh and implement an adapter-owned deterministic player
   traversal that cannot reach requestAnimationFrame/cancelAnimationFrame.
7. Implement deterministic renderFrame timing and player-key snapshots.
8. Add render reentrancy and pending-export mutation guards.
9. Wrap player drawing in save/restore/finally.
10. Implement transparent, opaque, and translucent clear.
11. Implement resize and player notifications.
12. Implement idempotent dispose and disposed-state guards.
13. Override browser scheduler methods with actionable errors.
14. Ensure thrown player errors preserve their original identity/cause.

Exit criteria:

- Lifecycle, bounds, timing, refresh, error, and disposal unit tests pass.
- No runtime reference to DOM or requestAnimationFrame exists on the supported
  path.

### Phase 3: SkiaCanvasForm

Tasks:

1. Initialize through super() with no context.
2. Attach space and context through the reviewed compatibility boundary.
3. Initialize inherited default styles and readiness.
4. Implement font normalization and the font override.
5. Expose precisely typed space, skiaSpace, and skiaCtx accessors.
6. Localize revamp's `MultiTouchSpace` generic constraint to the inheritance
   declaration without adding browser event behavior to SkiaCanvasSpace.
7. Add backend image and ImageData overloads.
8. Override offscreen methods with clear errors.
9. Add a helper used by space resize to reinitialize context/style state if
   required.
10. Preserve revamp's named text-width estimator mode across font changes.
11. Verify form method chaining retains SkiaCanvasForm as the useful type where
    TypeScript permits it; document unavoidable base return types.

Exit criteria:

- Required CanvasForm category tests pass.
- Default and custom text render without font parser errors.
- A retained form still works after resize.
- Unsupported methods fail intentionally.

### Phase 4: raster export

Tasks:

1. Add a strict RasterFormat union.
2. Add typed bitmap export options derived from or checked against the backend.
3. Implement async toBuffer.
4. Implement async toFile with extension/format validation.
5. Implement async toURL for encoded bitmap formats.
6. Reject vector formats at the adapter layer.
7. Verify density, quality, matte, WebP, JPEG, PNG, and raw behavior.
8. Ensure repeated exports do not mutate the scene or rerun players.
9. Use temporary directories for every file-writing test.
10. Track pending exports, allow concurrent reads of the unchanged scene, and
    reject adapter-managed mutations until all exports settle.

Exit criteria:

- Every supported format has signature, dimensions, and pixel/content checks.
- A single frame can be exported to multiple formats without another animate
  callback.
- Failed writes expose useful backend errors and leave the space usable.

### Phase 5: package and consumer validation

Tasks:

1. Pack the package into a temporary tarball.
2. Install it into isolated ESM and CommonJS fixtures with only declared peers.
3. Execute actual rendering from both fixtures.
4. Run strict type fixtures with skipLibCheck false.
5. Run publint and Are the Types Wrong against the tarball.
6. Inspect the bundle to confirm Pts and skia-canvas remain external.
7. Verify package files, license, repository, engines, and peer metadata.
8. Test install guidance under pnpm's native build-script controls.

Exit criteria:

- The tarball, rather than the source tree, passes runtime and type tests.
- No undeclared package is needed by a consumer.
- No platform-native binary is accidentally packed.

### Phase 6: documentation and examples

Tasks:

1. Write a README that leads with a complete PNG example.
2. Document install steps for npm and pnpm.
3. Explain logical dimensions versus export density.
4. Explain deterministic frame timing and why play() is unsupported.
5. Document the player lifecycle and export-does-not-render rule.
6. Add a Pts CanvasSpace-to-SkiaCanvasSpace migration table.
7. Document supported CanvasForm categories and known divergences.
8. Document fonts and FontLibrary.
9. Document image loading through skia-canvas rather than Pts Img.
10. Document direct context access and form.reset after direct style mutation.
11. Document native deployment considerations.
12. Add examples for a basic card, gradients, image composition, and several
    deterministic time samples.
13. State prominently that SVG/PDF are deferred.

Exit criteria:

- Every example runs from a clean checkout.
- Examples write only to an ignored or caller-specified output directory.
- README code is exercised in CI or shares source with tested examples.

### Phase 7: CI and 0.1.0 release

Tasks:

1. Add fast Linux checks for formatting, lint, typecheck, unit tests, build, and
   package validation.
2. Add native smoke tests on the supported Node version matrix.
3. Add macOS and Windows smoke jobs where skia-canvas distributes supported
   binaries.
4. Include at least x64 in required CI and arm64 where hosted runners or
   self-hosted infrastructure are reliable.
5. Record actual supported combinations in package engines and README.
6. Add CHANGELOG entries and mark the API experimental.
7. Remove package private only after the packed artifact passes all gates.
8. Publish 0.1.0 with provenance/signing if the repository's release policy
   supports it.

Exit criteria:

- Required CI is green from a clean checkout.
- The compatibility matrix reflects evidence, not assumptions.
- The npm artifact is the exact tested tarball.
- Pts remains untouched.

## 15. Test strategy

### 15.1 Unit tests

Validate:

- default and custom dimensions;
- invalid NaN, Infinity, zero, negative, and fractional dimensions;
- option defaults;
- background mutation;
- bounds, size, center, width, height, and pointer;
- form singleton/new-instance decision;
- error messages and disposed guards;
- font string construction independent of rendering;
- filename extension and format parsing;
- vector format rejection.

Dimension policy for fractions must be decided in Phase 0: either reject them or
define exact rounding. Do not allow JavaScript and Skia to round differently
without documenting it.

### 15.2 Lifecycle integration tests

Validate callback order and counts:

1. constructor;
2. add;
3. resize callback;
4. start callback;
5. renderFrame;
6. animate callback;
7. clear/render;
8. resize;
9. later render;
10. remove/dispose.

Cover:

- function players and object players;
- a player added after an earlier frame;
- multiple players;
- refresh true and false;
- explicit and derived delta;
- non-monotonic time policy;
- a player throwing;
- removal during a callback;
- resize during or between frames;
- repeated dispose.

The non-monotonic time policy should be explicit. Recommended default: allow it
for deterministic sampling and derive the signed delta, because server renderers
may seek backward. An explicit delta always wins.

### 15.3 Pixel tests

Do not rely only on buffer length. Use raw RGBA output or getImageData to
assert:

- known background corner pixels;
- shape interior and exterior pixels;
- transparent alpha;
- translucent clear behavior;
- clipping and transform effects;
- gradient endpoints;
- image crop placement;
- refresh(false) accumulation;
- resize clearing and new bounds.

Use tolerances at antialiased edges. Prefer assertions well inside shapes for
cross-platform stability.

### 15.4 CanvasForm rendering tests

Create one compact scene per feature category rather than one enormous golden
image. A failure should identify the incompatible operation.

Required categories:

- point/square/circle;
- line/polyline/polygon;
- rectangle/ellipse/arc;
- curves;
- fill/stroke/dash/alpha;
- linear/radial/conic gradients where Pts exposes them and Skia supports them;
- save/restore and transforms;
- compositing;
- text and measurement;
- image scaling and cropping;
- ImageData.

Text tests should assert parse success, metrics, and non-transparent glyph
regions. Avoid exact text pixel goldens across operating systems unless the test
registers a repository-owned font and backend output is proven stable.

### 15.5 Export tests

For each output:

- PNG: validate magic bytes, dimensions, alpha, and decoded pixels.
- JPEG: validate signature, dimensions, approximate colors, quality behavior,
  and matte handling.
- WebP: validate RIFF/WEBP signature, dimensions, and approximate pixels.
- Raw: validate exact byte count, channel order, dimensions, and selected
  pixels.
- URL: validate MIME prefix, Base64 decode, and encoded signature.
- File: validate extension inference, awaited completion, and no implicit
  directory creation.
- Density: validate pixel dimensions while logical geometry proportions remain
  the same.

Also test two formats exported from the same rendered frame and assert the
animate count remains one.

### 15.6 Type tests

Compile fixtures for:

- ESM plus NodeNext;
- CommonJS plus Node16;
- strict true;
- skipLibCheck false;
- ES2022-only lib before the adapter's reference directive;
- no Sharp dependency;
- Pts IPlayer object;
- callback-style player;
- form chaining;
- skiaCtx native methods;
- image input types;
- intentional type errors for svg/pdf formats.

### 15.7 Package tests

Every package test uses npm pack or pnpm pack and installs the resulting tarball
into a temporary directory. It must not resolve source files through workspace
linking.

Assert:

- import and require both work;
- declarations resolve under both module modes;
- only documented peers are required;
- export maps do not expose internal files;
- source maps point to sensible sources if shipped;
- the tarball excludes fixtures, plans, coverage, and generated images;
- native skia-canvas remains an external install.

### 15.8 CI matrix

Start with a conservative matrix and promote combinations only after evidence:

| Area              | Initial proposal                                        |
| ----------------- | ------------------------------------------------------- |
| Fast checks       | Linux x64, current minimum supported Node               |
| Node versions     | 20, 22, and 24 if skia-canvas install/render succeeds   |
| Operating systems | Ubuntu required; macOS and Windows native smoke         |
| Architectures     | x64 required; arm64 when reliable runners are available |
| Package managers  | pnpm for development; npm install consumer smoke        |
| Modules           | ESM and CommonJS                                        |
| Types             | NodeNext and Node16, strict, skipLibCheck false         |

The final support matrix is a Phase 0/CI result, not a promise made in advance.

## 16. Acceptance criteria for 0.1.0

### Repository isolation

- [x] Every implementation, test, document, and workflow change is in
      skia-pts-canvas.
- [x] Pts is consumed through the revamp branch's exported package interface.
- [x] No patch-package file, postinstall mutation, or Pts source copy exists.
- [x] The neighboring Pts checkout is read-only and is not a build dependency.

### Runtime

- [x] A clean Node process can construct a space with no DOM globals.
- [x] A Pts player can draw shapes and text through SkiaCanvasForm.
- [x] start, resize, and animate callbacks follow the documented counts/order.
- [x] renderFrame is deterministic and export does not rerender.
- [x] refresh, background, clear, resize, and dispose work as documented.
- [x] Browser-only scheduler and offscreen methods fail clearly.

### Rendering

- [x] Core CanvasForm primitives produce verified pixels.
- [x] Default and custom Pts fonts are normalized and accepted by Skia.
- [ ] Registered fonts can render.
- [x] Skia-loaded Image and ImageData inputs work.
- [x] PNG, JPEG, WebP, and raw output pass signature/dimension/pixel tests.
- [x] Export density changes output resolution without changing logical bounds.
- [x] SVG and PDF are rejected by adapter export helpers.

### Types and packaging

- [x] ESM and CommonJS consumers work from the packed artifact.
- [x] Strict declaration tests pass with skipLibCheck false.
- [x] The DOM type dependency is handled and documented.
- [x] The optional Sharp declaration does not force a runtime Sharp dependency.
- [x] Pts and skia-canvas are not bundled.
- [x] publint and Are the Types Wrong pass or any upstream-only exception is
      narrowly documented.
- [x] Native install instructions are tested locally.

### Documentation

- [x] README quick start produces a real image.
- [x] Supported/unsupported features are explicit.
- [x] Fonts, images, density, scheduling, deployment, and direct context access
      are explained.
- [x] SVG/PDF deferral and the future boundary are explicit.

## 17. Risks and mitigations

| Risk                                                 | Impact                                              | Mitigation                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Pts CanvasForm calls an unsupported context method   | Some expressions fail at runtime                    | Phase 0 method inventory; per-category tests; document narrow gaps                                            |
| Font syntax differs from browsers                    | Construction or text drawing throws                 | Initialize subclass without context; normalize from Font fields; registered-font tests                        |
| CanvasForm generic is constrained to MultiTouchSpace | A Space-based Node backend cannot be named directly | Isolate `CanvasForm<any>` at inheritance; override typed space; do not inherit browser interaction APIs       |
| Revamp branch moves after a reviewed install         | Builds silently test different Pts code             | Follow the branch in package.json but commit its exact resolved tarball in the lockfile                       |
| Revamp and npm release both report 0.12.9            | Peer semver cannot enforce the required API         | Use Git peer while private; capability error; adopt semver after a distinct revamp release                    |
| Pts declarations require DOM types                   | Node-only TypeScript consumers fail                 | Emit a type-only DOM reference and validate a Node-only strict fixture                                        |
| skia-canvas optional Sharp type leaks                | Consumers need an unused package or skipLibCheck    | Minimize exposed backend declarations; structural type fallback; upstream report                              |
| Resize invalidates context/form references           | Existing forms draw nowhere                         | Phase 0 identity test; retarget owned forms; explicit contract and regression test                            |
| save/restore desynchronizes style cache              | Styles silently revert                              | Reset CanvasForm cache after restore and resize; alternating-style pixel tests                                |
| Inherited Space methods touch requestAnimationFrame  | Node throws a ReferenceError                        | Override all scheduler methods; never install globals; direct error tests                                     |
| Inherited playItems reaches cancelAnimationFrame     | Hidden browser call during manual rendering         | Do not call inherited playItems; own the small deterministic traversal; direct global-absence regression test |
| Drawing changes while Skia exports asynchronously    | Output depends on timing                            | Reject Space-managed mutations; document that existing form/context handles bypass the guard                  |
| A player recursively renders or mutates dimensions   | Corrupted timing/context state                      | Non-reentrant frame guard; snapshot player keys; explicit errors and tests                                    |
| Native binary unavailable                            | Install fails on some targets                       | Narrow support matrix; CI native smoke; document build/prebuilt behavior                                      |
| Native build scripts are blocked by pnpm             | Package imports fail after install                  | Explicit pnpm allowBuilds policy/instructions and install test                                                |
| Bundler includes native package incorrectly          | Deployment fails                                    | Mark backend external; document server bundler settings; package smoke                                        |
| Pixel output varies across platforms                 | Flaky CI                                            | Interior-pixel assertions, tolerances, repository font, minimal platform goldens                              |
| Export unexpectedly reruns animation                 | Nondeterministic state and duplicate work           | Separate render/export API; animate-count regression tests                                                    |
| Async export is not awaited                          | Empty/missing output at process exit                | Async-first examples and return types; avoid fire-and-forget helpers                                          |
| Users infer full browser parity                      | Support burden and surprises                        | Capability table, explicit non-goals, descriptive unsupported errors                                          |
| Pts internal protected API changes                   | Adapter breaks on upgrade                           | Narrow peer range, compatibility CI, minimal protected access, changelog                                      |

## 18. Opportunity space after a stable canvas release

The adapter should first become a dependable primitive. Once it is stable,
several higher-level opportunities become credible:

### 18.1 Batch and service rendering

- a concurrency-limited render pool;
- reusable scene factories;
- cancellation and timeout support;
- metrics for render and encode durations;
- examples for HTTP handlers and job queues;
- safe font/image asset preloading.

These features should be separate utilities. They should not complicate the core
space/form classes.

### 18.2 Deterministic animation frames

A later helper can render a sequence at explicit timestamps:

```ts
for (let frame = 0; frame < 60; frame += 1) {
  const time = frame * (1000 / 60);
  space.renderFrame(time);
  await space.toFile(outputName(frame));
}
```

A frame-sequence helper could add naming, concurrency, and encoder integration,
but 0.1 needs only the deterministic primitive.

### 18.3 Framework integrations

Thin examples or separate packages could target:

- static site generators;
- social image endpoints;
- server frameworks;
- test snapshot tooling;
- notebook/build pipelines.

The core package should remain framework-neutral.

### 18.4 Canvas compatibility reporting

As coverage grows, publish a machine-readable capability table mapping Pts
CanvasForm methods to:

- supported;
- supported with normalization;
- backend-specific difference;
- intentionally unsupported.

This becomes more useful than a broad claim of “Canvas compatible.”

### 18.5 Upstream custom-renderer seam

The adapter can remain independent, but two small future Pts API changes would
make third-party renderers cleaner:

- widen CanvasForm's associated-space generic from `MultiTouchSpace` to
  backend-neutral `Space`, removing this adapter's localized `any` bridge;
- publish the no-context constructor, cached style writer, cache invalidation,
  and named text-width modes under a distinct package version with compatibility
  tests for external renderer subclasses.

These are upstream opportunities, not prerequisites for canvas 0.1 and not
authorization to modify the Pts repository from this project.

## 19. Future SVG boundary

SVG work should begin only after the raster acceptance criteria pass. It should
start with a separate design document answering:

1. Is SVG merely skia-canvas export from the same retained Canvas, or should Pts
   use a purpose-built SVG context for semantic vector output?
2. Should text remain text or be outlined?
3. How are fonts embedded, referenced, or made reproducible?
4. Which blend modes, filters, images, clipping operations, and gradients
   survive faithfully?
5. Does output need stable, inspectable SVG markup or only visual equivalence?
6. How are dimensions, viewBox, density, and physical units represented?
7. Is multipage/PDF behavior part of the same package?
8. How are vector snapshots tested without brittle string equality?
9. Should vector support be a second entry point, a sibling package, or a
   capability on the same space?

The canvas implementation should prepare for that work by:

- keeping player scheduling independent from encoding;
- keeping raster format unions narrow;
- avoiding a generic “export anything” method;
- not naming core classes in a way that implies all future backends;
- documenting which code is Skia-specific versus Pts lifecycle-specific.

It should not add unused abstraction layers solely for a hypothetical vector
backend.

## 20. Default decisions and questions to validate

The plan uses these defaults so implementation can proceed without waiting for
minor choices:

| Question               | Proposed default                                                  |
| ---------------------- | ----------------------------------------------------------------- |
| Package name           | skia-pts-canvas                                                   |
| First version          | 0.1.0, experimental                                               |
| Package manager        | pnpm with committed lockfile                                      |
| Outputs                | PNG, JPEG, WebP, raw                                              |
| Export style           | Async-first                                                       |
| Frame scheduling       | Explicit renderFrame only                                         |
| Default size           | 300 by 150 logical units                                          |
| Default background     | Transparent                                                       |
| Default refresh        | true                                                              |
| Pts ownership          | Required peer dependency                                          |
| skia-canvas ownership  | Required peer dependency                                          |
| Browser support        | None                                                              |
| SVG/PDF                | Deferred and rejected by raster helpers                           |
| Pts Img                | Unsupported; use skia-canvas image loading                        |
| Offscreen form methods | Explicit unsupported error                                        |
| Resize                 | Supported without implicit render                                 |
| Export behavior        | Never invokes players                                             |
| Export consistency     | Concurrent reads allowed; adapter mutations blocked while pending |
| Frame mutation         | Player-key snapshot; additions render next frame                  |
| Non-monotonic time     | Allowed; signed derived delta                                     |
| Sync export wrappers   | Not exposed in 0.1                                                |
| Dimensions             | Positive integers                                                 |

Questions that Phase 0 must resolve with code rather than preference:

1. Does resizing preserve the Canvas/context identity needed for retained forms?
2. Which exact CanvasForm methods need runtime adaptation beyond fonts?
3. Can strict declarations avoid requiring Sharp without degrading the public
   Canvas/context types?
4. Which Node/OS/architecture combinations install and render reliably?
5. Does concurrent export of one unchanged Canvas have well-defined backend
   behavior across supported native targets?
6. What distinct Pts version will first contain the required revamp hooks?

Any answer that changes the public contract should update this plan or create a
short architecture decision record before implementation proceeds.

## 21. Suggested pull request sequence

Keep reviews focused and independently verifiable:

1. Compatibility spike and decision record.
2. Package/tooling skeleton with packed ESM/CommonJS smoke tests.
3. SkiaCanvasSpace lifecycle and pixel tests.
4. SkiaCanvasForm, font handling, and CanvasForm compatibility tests.
5. Raster exports and file/buffer/URL integration tests.
6. Strict consumer types and tarball validation.
7. Documentation, examples, native CI matrix, and 0.1 release metadata.

Do not combine SVG work into any of these pull requests.

## 22. Definition of done

The canvas milestone is done when a user can install the packed adapter and the
Pts revamp dependency into a clean Node project, run the README example, and
receive a pixel-verified PNG using Pts drawing APIs—with no DOM shim, no hidden
Pts modification, no implicit rerender during export, and no undocumented native
setup. Public npm publication additionally requires a distinct Pts version whose
peer range can express the revamp API requirement.

Passing local source tests alone is not sufficient. The packed artifact,
declarations, native install, module formats, and examples are part of the
feature.

## 23. References

- [Pts repository](https://github.com/williamngan/pts)
- [skia-canvas repository](https://github.com/samizdatco/skia-canvas)
- [skia-canvas Canvas API](https://skia-canvas.org/api/canvas)
- [skia-canvas context API](https://skia-canvas.org/api/context)
- [skia-canvas image API](https://skia-canvas.org/api/image)
- [skia-canvas font library API](https://skia-canvas.org/api/font-library)
- [skia-canvas release notes](https://skia-canvas.org/releases)
