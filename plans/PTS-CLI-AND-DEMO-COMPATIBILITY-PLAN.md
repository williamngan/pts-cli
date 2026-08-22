# Pts CLI and standard-demo compatibility plan

> Implementation status (2026-08-21): Phases 1-3 are implemented; Phase 4 has an
> exact-source compatibility runtime and representative manifest; Phase 5
> supports portable assets plus the non-editable legacy image subset. Browser,
> packed-package, CLI, SVG, and exact local-revamp checks pass. Phase 0's
> release lock remains blocked because the reviewed local Pts commit `77420f1…`
> is not reachable from the configured public Git ref. Phase 6 publication and
> hosted platform gates remain open. No implementation command writes to the Pts
> repo.

Status: Core implementation complete; release-only gates remain  
Date: 2026-08-21  
Product name: Pts CLI  
Working npm package name: `pts-cli`  
Executable name: `ptsjs`  
Repository: this repository only  
Authoritative Pts baseline: the latest reviewed commit on `pts/revamp`  
Hard constraint: never modify, patch, build in, or write generated artifacts to
the neighboring Pts repository

## 1. Executive decision

Build a CLI-first Pts renderer in this repository on top of the existing
`SkiaCanvasSpace` and `SkiaCanvasForm` adapter. The product will render Pts
scenes deterministically in Node and export raster images and SVG.

The product will support two intentionally separate source contracts:

1. **Portable scene modules** are the recommended authoring format. The same
   `.mjs` scene module can be mounted by a small browser harness or rendered by
   `ptsjs`. Its drawing code uses ordinary Pts `space`, `form`, player, and
   geometry APIs. It does not import Skia, write files, or control the Node
   lifecycle.
2. **Classic Pts demo compatibility** loads existing browser demo scripts such
   as the files in `pts/demo` without modifying them. A contained compatibility
   runtime supplies `window`, Pts globals, `Pts.quickStart`, a deterministic
   space, and captured browser lifecycle methods. Unsupported browser services
   fail explicitly rather than being silently approximated.

These contracts share the same renderer but do not share a loader. Keeping them
separate prevents a convenient legacy bridge from becoming the long-term scene
API.

The first CLI release should support PNG and SVG as primary formats, retain the
adapter's JPEG and WebP support, and keep PDF deferred. It should be easy for a
human to use and predictable for an AI agent to invoke.

This plan is the next milestone after `CANVAS-INTEGRATION-PLAN.md`. It does not
rewrite the history or acceptance criteria of the implemented raster adapter.
Where the older plan deliberately deferred SVG, browser-portable scene
authoring, and a CLI, this plan supplies the design pass required to add them.
`COMPATIBILITY-NOTES.md` remains the record of implemented behavior and must be
updated as each phase lands.

## 2. Why this boundary

The useful creative code in a Pts web demo is already backend-neutral:

```js
space.add((time, ftime) => {
  const circle = Circle.fromCenter(space.pointer, space.size.y / 4);
  form.fillOnly("#0c6").circle(circle);
});
```

The browser-specific code is mostly the harness around it:

- `window.demoDescription`;
- `Pts.quickStart("#pt", background)`;
- browser-global Pts symbols;
- a DOM selector and container-derived dimensions;
- `bindMouse()`, `bindTouch()`, and `play()`;
- requestAnimationFrame scheduling;
- browser image, font, sound, DOM, and download APIs.

The CLI should own the equivalent Node concerns:

- source loading and validation;
- logical dimensions and background;
- deterministic time, pointer, resize, and action input;
- Skia space/form construction;
- frame simulation;
- output format selection and safe file writes;
- cleanup, diagnostics, and process exit behavior.

This lets scene authors keep the Pts idiom while making the environment boundary
visible and testable.

## 3. Evidence from the current repositories

### 3.1 Reviewed baseline

The neighboring Pts checkout was reviewed read-only at:

```text
branch: revamp
commit: 77420f143928d614766f13d56b2a8d7b00c44b24
```

That commit was the current committed local `revamp` head at the end of the
planning review. It was two commits ahead of `origin/revamp`, which still
pointed to `1c0256b26191ba54a8e8ecce4bc4dc9151676f4a`; the local revamp
checkout, not the published package or stale remote ref, is the user-requested
authority. A branch name alone is not reproducible, so implementation must
record the exact commit reviewed in this repository's lockfile and compatibility
notes.

The two final baseline advances were reviewed read-only:

- `Improve Group and Bound` changes Pt equality and angle semantics, makes Group
  split/segments return real Groups, improves large insert behavior, and
  preserves Bound corner identity during `update()`.
- `Improve rng` removes host `Math.random` consumption from seeded Pts startup,
  pins 32-bit UHEPRNG sequences, and documents its effective-seed cleaning
  behavior.

Neither changes quickStart, Space lifecycle, CanvasForm, or demo-loader syntax,
but both can change generated output. The Bound change strengthens the need to
pass the live Bound to resize callbacks; the RNG change requires seed
canonicalization and new golden sequences. Visual/geometry/random fixtures must
therefore be regenerated only after this exact commit is installed and reviewed.

The current adapter lockfile still resolves Pts to the older commit
`89205a1d8e736aee340a021f4b201034dde8e0fa`. The delta includes material Space,
CanvasForm, typography, UI, physics, geometry, and demo changes. Updating that
lock is the first implementation gate; no CLI compatibility claim may be made
against the older installed baseline.

Because `77420f1…` was not yet reachable from the configured remote at final
review, Phase 0 must not silently lock the older remote head. Wait until the
exact commit is fetchable from an immutable dependency source (or an explicit
revamp prerelease exists), then lock it here. A local-path dependency may be
used only in a disposable read-only compatibility check, never committed as the
release dependency. Recheck committed `revamp` HEAD when Phase 0 starts and
review any additional commits before selecting the new exact baseline;
uncommitted work in the neighboring checkout is never consumed as a baseline.

Updating the baseline means changing only this repository's dependency metadata,
lockfile, adapter code, tests, and notes. The Pts checkout remains untouched.
The neighboring checkout is reference input, not a cleanliness gate: it may
contain unrelated user work. Before and after each compatibility pass, record
its HEAD plus a status/diff fingerprint and prove that this project's commands
introduced no delta. Never clean, reset, stash, format, build, or otherwise
normalize that checkout.

### 3.2 Standard-demo inventory

The current top-level `pts/demo` directory contains 81 JavaScript demos. A
read-only inventory found:

| Pattern                       | Demo count | Planning implication                                                    |
| ----------------------------- | ---------: | ----------------------------------------------------------------------- |
| `Pts.quickStart(...)`         |         79 | One high-value legacy compatibility seam                                |
| direct `new CanvasSpace(...)` |          2 | Requires an advanced-mode constructor facade                            |
| `space.pointer`               |         61 | Configurable deterministic pointer state is essential                   |
| `action` callback             |         22 | A static pointer alone cannot reproduce interaction                     |
| `resize` callback             |         11 | Initial and scripted resize ordering must be defined                    |
| `start` callback              |         33 | Player initialization order must match Pts                              |
| async IIFE                    |          5 | Evaluation and tracked asset work must be awaited                       |
| `Img` usage                   |          9 | Image loading and browser-backed Img operations need separate treatment |
| `Sound` usage                 |          9 | Audio is outside a still-image renderer                                 |
| `Tempo` usage                 |          6 | Stateful frame stepping is required for correct output                  |
| UI usage                      |          1 | Synthetic action sequences can make this meaningful                     |
| direct `Math.random()`        |          9 | Seeded Pts randomness alone is insufficient                             |

The inventory describes syntax, not a support percentage. A demo is supported
only after its behavior and output are covered by the compatibility manifest and
tests.

### 3.3 Read-only compatibility spike

A temporary in-memory spike evaluated unchanged standard demo source inside a
Node `vm` context, supplied Pts globals and a `Pts.quickStart` bridge, rendered
one explicit frame, and exported SVG through the installed Skia canvas.

These unchanged demos rendered successfully:

- `circle.intersectCircle2D.js`;
- `canvasform.gradient.js`;
- `guide.getting_started.js`;
- `create.gridcells.js`.

`canvasform.textBox.js` failed because the latest demo calls the newer
`Typography.fontSizeToBox(ratio)` API while the adapter's installed Pts commit
still implements the older signature. This is baseline skew, not evidence of a
browser/Node rendering incompatibility. It validates the Phase 0 dependency
gate.

No spike files or outputs were written to either repository.

The spike preceded the final `bbdb982e…` and `77420f1…` baseline commits. Its
loader feasibility result remains useful because those commits did not change
loader/lifecycle APIs, but its rendered images are not acceptance evidence for
the new geometry/random baseline. Phase 0 reruns every selected demo after the
exact commit is locked.

### 3.4 Existing adapter strengths

The current adapter already provides:

- a Pts `Space` subclass with logical bounds, player storage, and forms;
- a Pts `CanvasForm` subclass drawing through a Skia Canvas 2D context;
- explicit `renderFrame(time, options)` scheduling;
- synchronous Node initialization and deterministic first-frame delta;
- PNG, JPEG, WebP, and raw export;
- export/mutation race protection;
- resize and player lifecycle behavior;
- font normalization and text measurement compatibility;
- ESM and CommonJS package output;
- typed errors and strict consumer type fixtures.

The CLI plan should preserve these properties rather than replace the adapter
with a second rendering path.

## 4. Product and package identity

Use these names during implementation:

| Role                           | Name                                |
| ------------------------------ | ----------------------------------- |
| Product/documentation          | Pts CLI                             |
| Working npm package            | `pts-cli`                           |
| Installed executable           | `ptsjs`                             |
| Current implementation backend | `skia-canvas`                       |
| Existing low-level classes     | `SkiaCanvasSpace`, `SkiaCanvasForm` |

`node-pts` is not used because it sounds like a Node port or replacement build
of Pts itself. `skia-pts-canvas` accurately names the current adapter but not
the CLI product. `pts` is not installed as a binary in the first release because
it collides with the OpenAFS command suite and is less unambiguous for agents.

If an owned npm scope is available before publication, `@ptsjs/cli` may replace
the working unscoped package name. That is a release-name decision only: it must
not change the scene schema, executable name, command grammar, or programmatic
API. All committed examples should use one package name at a time; do not mix
provisional names throughout the documentation.

Renaming the remote repository is not an implementation prerequisite and must
not be attempted automatically. The package remains private until the Pts revamp
dependency can be expressed against a distinct published version or an explicit
pre-release version policy is accepted.

## 5. Goals

### 5.1 Product goals

1. Render a Pts scene to PNG or SVG with one command.
2. Make the recommended scene file portable between Node and a browser harness.
3. Keep the drawing body recognizably identical to standard Pts demos.
4. Render a large, explicitly tested subset of current classic demos unchanged.
5. Make still frames and simulated frame sequences deterministic when the scene
   uses supported time and randomness sources.
6. Provide clear controls for size, background, pointer, time, frame stepping,
   seed, assets, fonts, and output.
7. Produce stable machine-readable results and errors for AI agents.
8. Preserve a useful low-level programmatic adapter for Node applications.
9. Fail clearly at the boundary of browser-only behavior.
10. Keep all integration and compatibility work in this repository.

### 5.2 Compatibility goals

1. Preserve Pts player callbacks: `start`, `animate`, `resize`, and synthetic
   `action`.
2. Preserve ordinary Space values: `size`, `width`, `height`, `center`,
   `innerBound`, and `pointer`.
3. Preserve ordinary CanvasForm drawing expressions and direct `form.ctx` access
   when Skia implements the corresponding Canvas 2D operation.
4. Preserve function-player `this` binding and player object identity.
5. Match browser lifecycle ordering where it is meaningful without a DOM.
6. Make any approximation discoverable through a warning or a documented
   compatibility status.
7. Maintain a per-demo compatibility manifest tied to an exact Pts revision.

### 5.3 Engineering goals

1. Keep source loading, rendering, and output encoding as separate layers.
2. Keep legacy globals inside a per-render context; never install them on the
   CLI parent process's `globalThis`.
3. Keep the strict adapter API honest; do not add misleading no-op browser
   methods to `SkiaCanvasSpace` merely for legacy demos.
4. Use one renderer for portable scenes, legacy demos, programmatic calls, and
   CLI calls.
5. Contain scene execution in a child process for CLI protocol integrity,
   timeout handling, and native-failure isolation.
6. Keep unsafe backend casts and Pts-version capability checks localized.
7. Validate dimensions and resource limits before native allocation.
8. Write files atomically and never leave a partially encoded destination.

## 6. Non-goals

The first CLI release will not:

- modify or fork Pts;
- emulate a complete browser or DOM;
- claim pixel identity with every browser, OS, GPU, or font stack;
- make Sound, microphone, HTMLSpace, HTMLForm, or MediaRecorder work in Node;
- treat Canvas-generated SVG as equivalent to Pts SVGSpace/SVGForm output;
- execute untrusted scene code securely;
- transpile TypeScript or JSX at runtime;
- encode GIF, APNG, or video;
- provide a real-time native application window;
- support PDF or multi-page documents;
- silently ignore an unsupported API that can materially change output;
- add a global requestAnimationFrame polyfill;
- use a headless browser as the primary renderer;
- use source-to-source AST rewriting as the standard-demo compatibility
  strategy.

## 7. Architecture

```text
ptsjs parent process
  ├── parses and validates CLI arguments
  ├── reserves output destinations
  ├── launches one render worker
  ├── owns stdout/stderr and JSON protocol
  └── atomically commits completed outputs

render worker process
  ├── applies limits, seed, and execution policy
  ├── selects one source loader
  │     ├── portable scene-module loader
  │     └── classic Pts-demo compatibility loader
  ├── normalizes both loaders to one PtsScene runtime contract
  ├── constructs SkiaCanvasSpace / SkiaCanvasForm
  ├── applies pointer, resize, and action input
  ├── renders explicit deterministic frame(s)
  ├── exports one unchanged canvas to one or more formats
  └── disposes scene resources and native objects
```

### 7.1 Layer responsibilities

#### Adapter layer

Owns the Skia canvas/context, Pts form bridge, player lifecycle, deterministic
frame mutation, pointer state, synthetic action dispatch, resize, and format
export. It knows nothing about CLI argument parsing or legacy globals.

#### Scene layer

Defines and validates the portable scene schema. It has no filesystem writes,
process exits, or output format decisions. Its optional `defineScene` helper
must be safe to import in a browser bundle and must not import `skia-canvas`.

#### Loader layer

Loads either a scene module or a classic script and returns a normalized scene
setup plus metadata and compatibility notices. Loader-specific shims do not leak
into the adapter.

#### Runner layer

Resolves option precedence, creates the space, invokes async setup, simulates
inputs and frames, calls exporters, and guarantees cleanup.

#### CLI layer

Owns command syntax, child-process orchestration, logs, JSON records, exit
codes, output-path safety, and signal handling. Its parent entry does not import
or initialize Skia; `ptsjs --help`, `--version`, and argument failures must work
without loading the native renderer.

### 7.2 Internal loader contract

Normalize loaders through a small execution contract rather than pretending a
classic script is already a scene object:

```ts
interface LoadedScene {
  readonly loader: "scene" | "pts-demo";
  readonly sourceURL: URL;
  readonly requestedConfig: {
    width?: number;
    height?: number;
    background?: string;
    assetBaseURL?: URL;
  };

  execute(context: PtsSceneContext): Promise<{
    cleanup?: SceneCleanup;
    metadata?: Readonly<Record<string, JsonValue>>;
    warnings: readonly RenderWarning[];
  }>;
}
```

For a portable module, loading imports and validates the default object,
`requestedConfig` comes from that object, and `execute` calls its `setup`. For a
classic demo, loading parses but does not evaluate the script, `requestedConfig`
is normally empty, and `execute` runs it once against the already constructed
`LegacyDemoSpace`. quickStart/setup background is applied during that execution
before player registration. This contract keeps the runner linear without
executing legacy source twice or requiring static evaluation of JavaScript
arguments.

`sourceURL` is always canonical and absolute. The portable loader resolves and
normalizes `assetBaseURL` before the context's asset service is created; the
classic loader uses `sourceURL` until a manifest or caller asset root supplies a
different legacy base. Dynamic metadata such as `window.demoDescription` belongs
in the execution result because it does not exist until classic source runs.

## 8. Proposed package surface

The package will continue to expose the low-level adapter and add a small scene
and one-shot rendering API. It will not re-export all of Pts or Skia Canvas.

Proposed conceptual exports:

```ts
// pts-cli
export { SkiaCanvasSpace, SkiaCanvasForm };
export { renderScene };
export type {
  PtsScene,
  PtsSceneContext,
  RenderSceneOptions,
  RenderSceneResult,
  RenderOutputRequest,
  RenderOutputResult,
};

// pts-cli/scene -- browser-safe and optional
type ExactScene<T extends PtsScene> = T &
  Record<Exclude<keyof T, keyof PtsScene>, never>;
export function defineScene<const T extends PtsScene>(scene: ExactScene<T>): T;
export type { PtsScene, PtsSceneContext };

// pts-cli/browser -- browser-only, with no Skia/Node dependency edge
export function mountScene(
  scene: PtsScene,
  options: MountSceneOptions,
): Promise<MountedScene>;
```

`defineScene` is an identity function used for inference, exact top-level key
checking in editors, and discoverability. It is never required at runtime. Plain
default-exported objects are the canonical JavaScript format, so a portable
scene does not need to import the CLI package at all.

The `pts-cli/scene` and `pts-cli/browser` builds must have no Node built-ins,
Skia imports, or native dependency edges. A package/build and browser-bundler
test will enforce this. `browser` may import the Pts peer and browser APIs;
`scene` remains an identity helper plus types. If the identity helper's
isolation cannot be guaranteed, omit that helper and publish types only. The
browser mount helper is tested as a real product surface because it owns
important lifecycle semantics.

Proposed `package.json` intent:

```json
{
  "name": "pts-cli",
  "bin": {
    "ptsjs": "./dist/cli.mjs"
  },
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./scene": {
      "import": "./dist/scene.mjs",
      "require": "./dist/scene.cjs"
    },
    "./browser": {
      "import": "./dist/browser.mjs"
    }
  }
}
```

Exact type-condition entries will follow the repository's existing strict
Node16/NodeNext package tests.

### 8.1 Dependency ownership

The CLI must install as a working product, while Pts must resolve only once:

- `skia-canvas` becomes a normal runtime dependency of the CLI package. Asking
  command-line users or `npx` to supply the renderer as a peer is too fragile.
- Pts remains an unbundled peer dependency and a pinned development dependency.
  This lets a browser application and this package share one Pts instance.
- Publication waits for a revamp version/range that a package manager can
  satisfy reproducibly; the current Git branch spelling is not a stable public
  peer contract.
- packed-install tests cover npm and pnpm, local and global-style bin links, and
  `npx`-equivalent use. A missing or incompatible peer fails before scene load
  with `PTS_INCOMPATIBLE` and the exact required range.
- importing `pts-cli/scene` or `pts-cli/browser` must not pull `skia-canvas`
  into the browser module graph, even though installing the single package still
  installs its native CLI dependency. Package extraction can solve install
  weight later without changing the scene schema.

## 9. Portable scene contract

### 9.1 Canonical shape

```ts
type Awaitable<T> = T | Promise<T>;
type SceneCleanup = () => Awaitable<void>;

interface PtsScene {
  /** Schema version; omitted means version 1. */
  readonly apiVersion?: 1;

  /** Human-readable metadata only. */
  readonly name?: string;
  readonly description?: string;

  /** JSON-compatible scene-local metadata; no behavior is inferred from it. */
  readonly metadata?: Readonly<Record<string, JsonValue>>;

  /** Logical canvas dimensions, before raster density. */
  readonly width?: number;
  readonly height?: number;

  /** Clear color; transparent when omitted. */
  readonly background?: string;

  /** Optional base for relative asset strings, often `import.meta.url`. */
  readonly assetBaseURL?: string | URL;

  /** Register Pts players and initialize assets. */
  readonly setup: (context: PtsSceneContext) => Awaitable<void | SceneCleanup>;
}

interface PtsSceneContext {
  /** The exact Pts module namespace used by the host renderer. */
  readonly Pts: typeof import("pts");

  /** Common Pts Space surface backed by CanvasSpace or SkiaCanvasSpace. */
  readonly space: PtsSceneSpace;

  /** Common Pts CanvasForm surface. */
  readonly form: PtsSceneForm;

  /** Cross-runtime, scene-relative asset service. */
  readonly assets: PtsSceneAssets;

  /** JSON-compatible user parameters. */
  readonly params: Readonly<Record<string, unknown>>;

  /** Cancels on timeout, SIGINT, or runner failure. */
  readonly signal: AbortSignal;
}
```

`PtsSceneSpace` and `PtsSceneForm` will be structural types describing the
portable intersection, not fictitious base classes. The concrete runtime values
remain normal Pts `CanvasSpace`/`CanvasForm` in a browser and
`SkiaCanvasSpace`/`SkiaCanvasForm` in Node.

The portable Space type includes geometry/state (`id`, size/width/height,
center, inner/outer bounds, pointer, readiness), player management
(`add`/`remove`/`removeAll`), and backend-neutral drawing controls such as
`clear` and `refresh`. It intentionally omits DOM binding, requestAnimationFrame
scheduling (including `play`, `playOnce`, and `minFrameTime`), setup/container
methods, offscreen canvas, and native Skia handles. The portable Form type
exposes the CanvasForm drawing and typography surface plus a structural Canvas
2D `ctx`, while omitting offscreen/DOM-only helpers and backend handles.

These types are generated or checked against the reviewed Pts public surface in
type fixtures so they cannot silently become stale. Runtime values are not
wrappers: `instanceof CanvasSpace` in the browser and
`instanceof SkiaCanvasSpace` in Node remain true. The temporary lifecycle gate
changes only owned instance methods during mount setup and is fully restored
before the mount Promise resolves.

`JsonValue` is the usual recursive JSON value union. Scene-local extensions go
under `metadata` rather than creating unversioned behavior-bearing top-level
keys.

The schema intentionally does not contain output paths, format, density,
quality, text outlining, overwrite policy, or process behavior. Those belong to
the caller.

### 9.2 Recommended JavaScript scene

```js
export default {
  name: "Intersecting circles",
  width: 640,
  height: 360,
  background: "#fe3",

  setup({ Pts, space, form }) {
    const { Circle } = Pts;

    space.add((time, ftime) => {
      const c1 = Circle.fromCenter(space.pointer, space.size.y / 4);
      const c2 = Circle.fromCenter(space.pointer, space.size.y / 8);
      const target = Circle.fromCenter(space.center, space.size.y / 4);

      form.fillOnly("#0c6").circle(c1);
      form.fill("#fe3").circle(c2);
      form.fill("rgba(70,30,240,.2)").circle(target);
    });
  },
};
```

The callback body is copied directly from the web-demo idiom. The only required
structural changes are replacing global bootstrap code with a default scene
object and destructuring the Pts symbols used by the scene. Supplying `Pts`
through the context guarantees that geometry, players, seeding, and the adapter
all use one exact Pts module instance.

The authoring delta is deliberately mechanical:

| Standard web-demo harness              | Portable scene equivalent                        |
| -------------------------------------- | ------------------------------------------------ |
| `Pts.namespace(this)`                  | destructure only used symbols from `context.Pts` |
| `Pts.quickStart("#pt", "#fe3")`        | `background: "#fe3"` plus `setup(context)`       |
| container determines initial size      | scene `width`/`height` or caller override        |
| `run(animate, start, action, resize)`  | `space.add({ animate, start, action, resize })`  |
| `space.bindMouse().bindTouch().play()` | browser mount or CLI runner owns it              |
| browser-relative image/font loading    | `context.assets` with a scene-relative URL       |
| drawing callback body                  | copied verbatim                                  |

There are therefore two honest compatibility claims:

- `--loader pts-demo` can execute a manifest-tested classic file with zero
  source edits; and
- the portable scene wrapper changes the bootstrap, but the Pts geometry and
  drawing body stays the same and the complete resulting module is shared by
  browser and Node.

Do not claim that an arbitrary browser demo is automatically portable merely
because it calls CanvasForm. DOM, sound, native events, timers, and browser Img
internals still cross the declared compatibility boundary.

### 9.3 Browser use

A browser entry point mounts the same object:

```js
import { mountScene } from "pts-cli/browser";
import scene from "./circles.mjs";

const mounted = await mountScene(scene, {
  target: "#pt",
  resize: true,
  retina: true,
  params: {},
});

// Later, if needed:
mounted.dispose();
```

Conceptual browser types:

```ts
interface MountSceneOptions {
  target: string | Element;
  size?: { width: number; height: number };
  background?: string;
  resize?: boolean;
  retina?: boolean;
  params?: Readonly<Record<string, unknown>>;
  assetBaseURL?: string | URL;
  bindMouse?: boolean;
  bindTouch?: boolean;
  autoplay?: boolean;
  signal?: AbortSignal;
  onWarning?: (warning: RenderWarning) => void;
}

interface MountedScene {
  readonly space: import("pts").CanvasSpace;
  readonly form: import("pts").CanvasForm;
  readonly warnings: readonly RenderWarning[];
  dispose(): Promise<void>;
}
```

`mountScene` imports the caller's Pts peer, creates the normal browser
CanvasSpace/Form, supplies that exact namespace to setup, implements browser
assets with browser image primitives and `FontFace`, and binds/plays by default.
It handles the race where async setup crosses CanvasSpace's ready event,
ensuring every initial player receives one resize and one start in the same
two-pass order as the Node runner. It does so in this package's wrapper; it does
not patch Pts source or global prototypes.

The browser mount algorithm is explicit:

1. validate the scene/options and an already-aborted signal before allocating;
2. create a non-playing CanvasSpace and await its normal ready/bounds event;
3. install a per-instance registration gate for `add`, `remove`, and
   `removeAll`; never modify a prototype;
4. run and await setup plus tracked assets while the gate records the exact
   surviving player set and preserves player identity/insertion order;
5. close the gate, register survivors without firing incidental lifecycle
   callbacks, then run one resize pass followed by one start pass;
6. restore the native instance methods before binding input or playing;
7. bind only the requested input sources and start playback only when `autoplay`
   is true (all three default to true); and
8. on any failure, roll back the gate and dispose every resource already owned.

The gate is an internal compatibility primitive with contract tests. It must
preserve `animateID`, duplicate-ID replacement, remove/removeAll behavior,
function-player `this`, additions/removals made by lifecycle callbacks, and
exception rollback. If those invariants cannot be met against the reviewed Pts
surface without a prototype patch, browser mounting does not ship until a
cleaner instance-local mechanism exists.

`mountScene` is deliberately Canvas-to-Canvas portability: it creates a
CanvasSpace/CanvasForm and rejects an SVG mount target with a clear error. A
browser SVGSpace uses a different form/lifecycle contract and is not evidence
that Skia's Canvas-generated SVG will behave as a semantic SVG scene graph.

Size/background precedence mirrors the Node runner. Responsive `resize: true`
allows the DOM container to determine live size after the initial scene/default
size. Fixed mode honors the scene or explicit dimensions. `dispose` aborts only
the helper's internal controller (never the caller's signal), awaits scene
cleanup, unbinds listeners owned by this mount, and disposes the space exactly
once. It is idempotent, including after partial setup. An external abort behaves
like `dispose` plus an abort error to a pending mount call.

Relative browser asset strings use, in order: an explicit mount option, the
scene's `assetBaseURL`, then `document.baseURI` with a warning. Passing a URL
created from `import.meta.url` is the most portable unambiguous form. Node
always knows the source module URL and uses it when the scene does not override
the base.

### 9.4 Single-Pts-instance invariant

The context-supplied `Pts` namespace is canonical. It removes a subtle package
manager failure mode in which the adapter extends one installed Pts copy while a
scene imports geometry or seeds randomness through another.

Rules:

1. `pts-cli` keeps Pts as an unbundled peer dependency.
2. The Node runner passes the same imported namespace used by the adapter into
   every scene context and legacy VM.
3. Portable scenes should use `context.Pts` for runtime values. Type-only
   imports from `pts` remain encouraged.
4. A scene may use runtime imports from `pts` only when Node resolves them to
   the same real package path and compatible capability set as the runner.
5. The loader checks direct static imports/CommonJS requires and any Pts
   resolution observed by the worker's module-loading seam. It compares real
   package identity with the runner before imported Pts values can cross into
   rendering. Merely having an unused second Pts installation near the scene is
   not an error.
6. Arbitrary computed dynamic imports cannot be proven safe by source preflight.
   Using one is outside the portable contract; if a foreign Pts-branded value is
   detected at an adapter boundary, fail rather than coercing it.
7. A second or incompatible instance fails with `PTS_INSTANCE_MISMATCH`; do not
   continue on structural similarity because `instanceof`, static caches,
   seeding, and future internals may diverge.
8. The packed npm, pnpm, and monorepo fixtures cover deduped and duplicate-Pts
   layouts.

This invariant also lets a globally or transiently installed CLI render a scene
that does not itself import `pts`; the scene receives the CLI's validated peer
instance through its context.

### 9.5 Setup and cleanup rules

1. Module top-level code should declare the scene only. Rendering, random scene
   construction, and asset loading belong in `setup`.
2. `setup` may be synchronous or async.
3. `setup` registers players through ordinary `space.add` calls.
4. While initial setup is active, registration is deferred: the runner does not
   invoke each player's initial `resize` and `start` until setup and tracked
   asset work complete. It then runs a resize pass over initial players followed
   by a start pass, both in stable insertion order, matching the reviewed
   browser-ready pattern used by standard demos.
5. After initial setup, runner-managed spaces mirror the reviewed browser Pts
   behavior: adding a player to an initialized bound invokes its `resize`
   immediately but does not invent a late `start`. The existing low-level Node
   adapter retains its immediate resize/start convenience for backward
   compatibility outside a runner or browser mount. This policy difference is
   internal and has an explicit lifecycle mode; it is never inferred from call
   timing.
6. If `setup` returns a cleanup function, the runner awaits it exactly once in
   `finally`, after all exports settle and before the worker exits.
7. A setup failure still disposes any space the runner created; deferred players
   do not receive `start` after a failed setup.
8. Cleanup errors are reported without hiding an earlier load/render/export
   error.
9. Output configuration returned from setup is ignored; scene code cannot
   redirect the caller's output.

### 9.6 Scene validation

Reject with a stable scene-validation error when:

- the module has no default export;
- the default export is not a plain scene object;
- `apiVersion` is unsupported;
- `setup` is not a function;
- width or height is not a positive finite integer;
- exactly one of width or height is supplied rather than both or neither;
- background is not a string;
- `assetBaseURL` is neither a valid string nor URL;
- metadata exceeds documented length limits;
- `metadata` contains a non-JSON value;
- parameters are not JSON-compatible at the CLI boundary;
- an unknown top-level scene key is present.

Unknown top-level keys fail with a message directing authors to `metadata`. This
avoids typo-driven behavior and gives scene-local extensions one explicit,
JSON-inspectable location. `defineScene` catches the same mistake in TypeScript.

For this schema, “plain object” means an object whose prototype is
`Object.prototype` or `null`, with own data properties only. Accessor
properties, symbol keys, inherited configuration, and proxies that violate
reflective invariants are rejected. Validation reads property descriptors before
values so a getter cannot run merely because the CLI is inspecting a scene. The
runner snapshots validated scalar configuration and deeply clones/freezes JSON
metadata and params before setup; mutation of the caller's objects cannot change
an active job.

### 9.7 Configuration precedence

Resolve each logical rendering option once, before canvas allocation:

```text
explicit CLI/programmatic option
  > portable scene configuration
  > legacy quickStart/setup metadata
  > deterministic CLI default
```

Initial defaults:

| Option                     | Default                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| width × height             | 800 × 600                                                             |
| background                 | transparent, unless legacy quickStart supplies one                    |
| pointer                    | space center                                                          |
| render mode                | one direct frame                                                      |
| direct-frame time          | 0 ms                                                                  |
| first delta                | 0 ms                                                                  |
| frame rate when simulating | 60 fps                                                                |
| random seed                | unset; result metadata records that no deterministic seed was applied |
| renderer                   | CPU                                                                   |

CPU is the reliable headless default and narrows cross-platform drift. `auto`
and required-GPU modes remain explicit performance choices. The requested and
actual renderer must both be printed in JSON metadata so fallback is never
invisible.

## 10. Asset service

Portable scenes should not need to choose between browser `Img` and
`skia-canvas.loadImage`. Provide a small cross-runtime service in the scene
context:

```ts
interface PtsSceneAssets {
  /** Resolve relative to the scene module, not process.cwd(). */
  resolve(specifier: string | URL): URL;

  /** Load an image accepted by the current form's image method. */
  image(specifier: string | URL): Promise<PtsSceneImage>;

  /** Register a named font before text is measured or drawn. */
  font(options: {
    family: string;
    sources: readonly (string | URL)[];
  }): Promise<void>;
}
```

Rules:

1. Relative paths resolve against the source scene or classic demo file.
2. Local files and data URLs are supported first.
3. HTTP(S) assets require an explicit network policy. `--allow-net` controls the
   asset helper only and is not a security boundary for arbitrary scene code.
4. Asset failures report the original specifier and resolved location without
   leaking credentials embedded in URLs.
5. Font registration completes before the scene draws or measures that font.
6. The runner records registered font family names and source hashes in debug
   metadata, not raw font contents.
7. Browser and Node image objects are intentionally structural; scenes should
   pass them to `form.image` rather than inspect backend-specific internals.
8. Pts `Img.blank`, pixel editing, and pattern helpers remain a separate
   compatibility project because they assume browser canvases and DOMMatrix.
9. Resolution beneath an explicit asset root rejects `..` or symlink traversal
   that escapes that root; direct arbitrary scene code still has its normal Node
   filesystem authority.
10. Only `file:`, `data:`, `http:`, and `https:` have defined behavior. Network
    schemes require the network policy; all other schemes fail explicitly.
11. A relative `assetBaseURL` string resolves against the scene URL using normal
    URL semantics. No filesystem stat is used to guess whether a base denotes a
    file or directory; authors use a trailing slash or
    `new URL(".", import.meta.url)` when they mean a directory.
12. Successful image loads and in-flight requests are deduplicated by normalized
    URL within one job. Failures are not cached permanently, and no cache
    crosses worker jobs.
13. Every fetch and decode observes the render AbortSignal, redirect limit,
    per-asset byte limit, aggregate asset byte limit, and timeout. Redirects are
    rechecked against the network policy; credentials are never forwarded to a
    newly redirected origin.
14. Browser remote images remain subject to CORS. The asset error reports this
    as a browser policy failure rather than suggesting that Node success implies
    browser portability.
15. Re-registering an identical family/source tuple is idempotent. Reusing a
    family with different sources in one job is an error unless an eventual
    explicit weight/style descriptor makes the registrations disjoint.

The asset service is convenience and reproducibility infrastructure, not a
capability sandbox. Scene modules can still import Node filesystem/network APIs.

## 11. CLI contract

### 11.1 Primary command

```text
ptsjs render <source> --out <destination> [options]
```

Examples:

```sh
ptsjs render scene.mjs --out artwork.png
ptsjs render scene.mjs --out artwork.svg --text-mode outline
ptsjs render scene.mjs --out artwork.png --out artwork.svg
ptsjs render scene.mjs --frame 120 --fps 60 --seed launch --out frame.png
ptsjs render ../pts/demo/circle.intersectCircle2D.js \
  --loader pts-demo --size 640x360 --pointer 320,180 --out circle.svg
```

`render` is the only required first-release subcommand. Reserve a subcommand
grammar so `inspect`, `doctor`, and future sequence rendering can be added
without changing `render`.

### 11.2 Core options

| Option                             | Meaning                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `-o, --out <path>`                 | Output path; repeatable; `-` means binary/text stdout                          |
| `--format <name>`                  | Explicit format for exactly one destination; must agree with a known extension |
| `--loader <auto\|scene\|pts-demo>` | Source interpretation; deterministic override for auto-detection               |
| `--size <width>x<height>`          | Override logical scene dimensions                                              |
| `--background <color>`             | Override scene or quickStart background                                        |
| `--pointer <x>,<y>`                | Set pointer state before rendering                                             |
| `--time <ms>`                      | Invoke exactly one direct frame at this timestamp                              |
| `--frame <index>`                  | Simulate frames 0 through this index, inclusive                                |
| `--fps <number>`                   | Simulation rate; valid with `--frame`                                          |
| `--events <file.json>`             | Deterministic resize/action event timeline                                     |
| `--seed <string>`                  | Seed Pts and compatible JavaScript randomness                                  |
| `--param <key=value>`              | Add a JSON-compatible scene parameter; repeatable                              |
| `--params <file.json>`             | Load scene parameters from a JSON object                                       |
| `--density <integer>`              | Raster pixels per logical unit                                                 |
| `--quality <0..1>`                 | JPEG/WebP compression quality                                                  |
| `--matte <color>`                  | Background beneath transparent raster output                                   |
| `--text-mode <preserve\|outline>`  | SVG text behavior                                                              |
| `--asset-root <path>`              | Filesystem root used for legacy root-relative asset paths                      |
| `--allow-net`                      | Permit HTTP(S) through the provided asset service                              |
| `--font <family=path>`             | Register a font before scene setup; repeatable                                 |
| `--renderer <auto\|cpu\|gpu>`      | Skia rendering preference                                                      |
| `--timeout <ms>`                   | Terminate a render worker after a deadline                                     |
| `--limit <name=value>`             | Override one documented resource ceiling; repeatable                           |
| `--force`                          | Permit replacement of existing output files                                    |
| `--json`                           | Emit one versioned machine-readable result record                              |
| `--quiet`                          | Suppress non-error human diagnostics                                           |
| `--debug`                          | Include stack traces and backend metadata                                      |

Option names must not have aliases that change semantics. Mutually exclusive
options fail during argument validation, before scene execution.

`--param key=value` parses `value` as JSON when it is valid JSON and otherwise
uses the literal string. `--params` supplies the base object; individual
`--param` entries override distinct keys. Repeating the same CLI key is an error
rather than a last-write-wins accident. Keys are literal (not dotted paths), and
prototype-polluting keys are rejected.

Renderer semantics are strict:

- `cpu` constructs the canvas with GPU disabled and is the default;
- `auto` permits Skia Canvas to choose/fallback and reports the actual engine;
- `gpu` requests GPU and fails with an environment error if the resulting engine
  is not GPU-backed—silent CPU fallback would violate caller intent.

The worker records Skia's renderer, API, device, and fallback error where
available. Tests pin `cpu`; visual output from `auto`/`gpu` is not promised
byte-identical to CPU.

### 11.3 Direct time versus frame simulation

This distinction is mandatory and visible:

- `--time 5000` calls player animation exactly once at time 5000 with delta 0.
  It is appropriate for a pure function of time.
- `--frame 300 --fps 60` calls frames 0 through 300. Frame 0 receives time 0 and
  delta 0; each later frame receives time `index * 1000 / fps` and the same
  positive delta. It is appropriate for physics, Tempo, Noise stepping, and any
  scene that accumulates state.

The CLI must never silently simulate intermediate frames for `--time`, because
there is no universal frame rate. `--time` and `--frame` are mutually exclusive.
`--fps` without `--frame` is an error.

Time is a finite non-negative number. Frame is a non-negative safe integer, and
fps is finite and greater than zero; resource ceilings apply before setup. The
scheduler computes each timestamp from its integer index rather than repeatedly
adding delta, avoiding accumulated floating-point drift. The callback delta is
zero for index 0 and exactly `1000 / fps` thereafter.

Sequence encoding and frame filename templates are deferred, but the internal
frame scheduler should accept a sequence so they can be added without changing
single-frame semantics.

### 11.4 Multiple outputs

Repeated `--out` exports the same unchanged final canvas. The scene is not run
again per format.

Infer each filesystem format independently from its extension. `--format` is
valid only when there is exactly one output destination (including stdout). If
that destination already has a recognized extension, the explicit format must
agree; otherwise it supplies the missing format. This allows the familiar
`--out art.png --format png` spelling while preventing an unclear global format
from applying to a subset of repeated outputs. Accept `jpg` as a CLI input alias
in both extensions and `--format`, and report the canonical format as `jpeg`.

Format-specific options apply only to compatible destinations:

- density and matte: raster outputs;
- quality: JPEG and WebP;
- text mode: SVG;
- PDF options: unavailable.

An option that applies to none of the requested outputs is an error. An option
that applies to a subset is accepted and recorded per output. This makes a PNG
plus SVG command useful without pretending density affects SVG.

Before rendering, validate every destination and reject duplicate normalized
paths. After rendering, encode all outputs to temporary files or buffers. Commit
filesystem outputs atomically only after every encoding succeeds. If commit
cannot be all-or-nothing on a platform, report exactly which paths were
committed and remove only temporary files owned by this run.

Version 1 encodes outputs in request order with concurrency one and returns
results in that same order. This bounds native thread/memory pressure and makes
failure ordering stable; the frozen canvas ensures a later bounded-concurrency
optimization need not change semantics. Path-bound and in-memory outputs both
use worker-owned temporary artifacts. The parent reads a temp artifact into a
Buffer only for a programmatic buffer result, avoiding large copied IPC
messages.

### 11.5 Output path policy

1. `--out` is required for the first release; there is no surprising default
   filename.
2. Parent directories are created automatically.
3. Existing destinations require `--force`.
4. A destination directory, broken format extension, or extension/format
   conflict fails before scene execution.
5. Temporary files are created beside their destinations with unique names so
   rename stays on one filesystem.
6. SIGINT, timeout, or failure removes only temporary files created by the run.
7. Symlinks and non-regular existing targets are rejected unless a later,
   explicitly documented policy supports them.

Existence checks are not overwrite protection: another process can create a
destination after validation. Without `--force`, commit must use a platform-safe
no-clobber primitive (for example, same-filesystem hard-link commit with a
tested exclusive-copy fallback), never a rename that can overwrite after a
time-of-check/time-of-use race. With `--force`, replacement uses the platform's
atomic same-filesystem replace behavior where available. Cross-platform tests
exercise both races and report any weaker filesystem guarantee explicitly.

Path bases are explicit:

- CLI source, output, events, params, font, and asset-root arguments resolve
  from the caller's current working directory;
- portable `assets.*` specifiers resolve from the scene module directory;
- legacy relative assets resolve from the classic script directory;
- legacy root-relative assets resolve beneath `--asset-root`, never the machine
  filesystem root;
- the programmatic API accepts file URLs to remove working-directory ambiguity.

### 11.6 Stdout and logging

The CLI parent owns stdout.

- Human status and scene console output go to stderr.
- `--json` writes exactly one JSON object plus a trailing newline to stdout.
- `--out -` writes only encoded output bytes to stdout.
- `--json` and `--out -` are mutually exclusive in version 1.
- More than one `--out -` is invalid.
- Scene output cannot corrupt the JSON or binary channel because scene code runs
  in a child process whose streams are captured.

### 11.7 Agent-facing JSON result

Version the record independently of the scene schema:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "source": "/absolute/path/scene.mjs",
  "loader": "scene",
  "width": 640,
  "height": 360,
  "runtime": {
    "node": "24.19.0",
    "ptsVersion": "0.12.9",
    "ptsRevision": "77420f143928d614766f13d56b2a8d7b00c44b24",
    "skiaCanvas": "3.0.8",
    "requestedRenderer": "cpu",
    "renderer": "cpu"
  },
  "render": {
    "mode": "frame",
    "frame": 120,
    "fps": 60,
    "time": 2000,
    "framesInvoked": 121
  },
  "random": {
    "seed": "launch",
    "effectiveSeed": "launch",
    "algorithm": "pts-cli-seed-v1",
    "seedApplied": true
  },
  "outputs": [
    {
      "path": "/absolute/path/art.svg",
      "format": "svg",
      "bytes": 20481,
      "sha256": "..."
    }
  ],
  "warnings": [],
  "durationMs": 143
}
```

Failure records use the same envelope with `ok: false` and an error containing
`code`, `phase`, `message`, and optional source/frame details. Stack traces are
included only with `--debug` and never replace the stable fields.

The parent recognizes `--json` before full argument validation so unknown,
missing, or contradictory arguments still produce the versioned failure record
when machine mode was requested. JSON is UTF-8, locale-independent, contains no
ANSI escapes, serializes paths as absolute platform-native strings, and emits
exactly once. A worker crash is normalized by the parent rather than leaking an
IPC/parser exception.

Runtime versions and the actual renderer are always included because they are
part of output reproducibility, not merely debug trivia. If a published Pts
package no longer carries Git revision metadata, record the exact package
version and integrity/build identifier used by this package.

## 12. Programmatic one-shot API

Keep CLI and programmatic option semantics aligned without forcing library
callers through argument strings:

```ts
const result = await renderScene("./scene.mjs", {
  loader: "scene",
  size: { width: 1200, height: 630 },
  pointer: [600, 315],
  render: { mode: "frame", frame: 120, fps: 60 },
  seed: "launch",
  outputs: [
    { path: "art.png", format: "png", density: 2 },
    { path: "art.svg", format: "svg", textMode: "outline" },
  ],
});
```

Conceptual types:

```ts
type RenderClock =
  | { mode: "direct"; time?: number }
  | { mode: "frame"; frame: number; fps?: number };

type RenderFacts =
  | {
      mode: "direct";
      time: number;
      framesInvoked: 1;
    }
  | {
      mode: "frame";
      frame: number;
      fps: number;
      time: number;
      framesInvoked: number;
    };

interface RuntimeFacts {
  node: string;
  ptsVersion: string;
  ptsRevision?: string;
  skiaCanvas: string;
  requestedRenderer: "cpu" | "auto" | "gpu";
  renderer: "cpu" | "gpu";
}

interface RenderWarning {
  code: string;
  message: string;
  phase?: string;
}

interface RandomFacts {
  seed: string | null;
  effectiveSeed: string | null;
  algorithm: string | null;
  seedApplied: boolean;
}

interface RenderOutputTarget {
  /** Omit to receive a Buffer in RenderSceneResult. */
  path?: string | URL;
}

type RenderOutputRequest =
  | (RenderOutputTarget & {
      format: "png";
      density?: number;
      matte?: string;
      msaa?: number | boolean;
    })
  | (RenderOutputTarget & {
      format: "jpeg";
      density?: number;
      matte?: string;
      msaa?: number | boolean;
      quality?: number;
      downsample?: boolean;
    })
  | (RenderOutputTarget & {
      format: "webp";
      density?: number;
      matte?: string;
      msaa?: number | boolean;
      quality?: number;
    })
  | (RenderOutputTarget & {
      format: "svg";
      textMode?: "preserve" | "outline";
    })
  | (RenderOutputTarget & {
      format: "raw";
      density?: number;
      matte?: string;
      msaa?: number | boolean;
    });

interface RenderSceneOptions {
  loader?: "auto" | "scene" | "pts-demo";
  size?: { width: number; height: number };
  background?: string;
  pointer?: readonly [number, number];
  render?: RenderClock;
  events?: readonly PtsSceneEvent[];
  seed?: string;
  params?: Readonly<Record<string, unknown>>;
  assetRoot?: string | URL;
  allowNet?: boolean;
  fonts?: readonly {
    family: string;
    sources: readonly (string | URL)[];
  }[];
  renderer?: "cpu" | "auto" | "gpu";
  limits?: Readonly<Partial<RenderResourceLimits>>;
  outputs: readonly RenderOutputRequest[];
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Replace existing path targets; defaults to false. */
  overwrite?: boolean;
}

interface RenderOutputFacts {
  readonly format: "png" | "jpeg" | "webp" | "svg" | "raw";
  readonly bytes: number;
  readonly sha256: string;
}

type RenderOutputResult = RenderOutputFacts &
  (
    | { readonly path: string; readonly buffer?: never }
    | { readonly path?: never; readonly buffer: Buffer }
  );

interface RenderSceneResult {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly loader: "scene" | "pts-demo";
  readonly width: number;
  readonly height: number;
  readonly render: Readonly<RenderFacts>;
  readonly random: Readonly<RandomFacts>;
  readonly runtime: Readonly<RuntimeFacts>;
  readonly outputs: readonly RenderOutputResult[];
  readonly warnings: readonly RenderWarning[];
  readonly logs: {
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
  };
  readonly durationMs: number;
}
```

Discriminated output requests prevent nonsensical combinations such as JPEG
quality on SVG at compile time. Runtime validation remains mandatory for plain
JavaScript and CLI callers.

The public one-shot `renderScene` accepts a scene file path or file URL and uses
the same one-job child worker as the CLI. It returns Buffers for output requests
without a path. This gives CLI and programmatic callers identical Pts isolation,
seeded `Math.random`, hard timeout, console capture, cleanup, and
concurrent-call behavior. `AbortSignal` terminates the worker; `timeoutMs` is
therefore a real hard deadline rather than a cooperative Promise race.

The options object and its nested collections are snapshotted and validated
before spawning; later caller mutation cannot change the job. `outputs` must be
non-empty. String source, output, font, and asset-root paths resolve from the
caller's captured current working directory, while file URLs remain absolute.
Results preserve output request order and use canonical `jpeg`, never `jpg`.
Scene logs are bounded and returned rather than written into the embedding
process's stdout/stderr.

Failures reject with the exported typed `PtsRenderError`; they do not return an
`ok: false` value. The error carries the same stable code/phase/details as CLI
failure JSON. If signal and timeout race, the first observed terminal cause is
retained and cleanup failures become secondary details.

An already-created scene object is deliberately not accepted by this high-level
API because functions and imported module state do not serialize into the worker
faithfully. Trusted applications that construct scenes inline already have the
low-level `SkiaCanvasSpace` and `SkiaCanvasForm` API. Do not add an in-process
one-shot overload with subtly different determinism semantics.

Programmatic path writes use the same validation and atomic-commit helpers as
the CLI; `overwrite` is the API spelling of CLI `--force`. The worker process is
still a reliability boundary, not a security sandbox.

The existing low-level classes remain available for applications that need their
own server lifecycle, repeated frames, custom output streaming, or direct Skia
access.

## 13. Rendering lifecycle

The normalized runner follows this order:

1. Validate caller options and destination policy.
2. Start the worker and install timeout/signal handling.
3. Select the source loader without executing scene code twice.
4. Apply the requested random seed before module/classic-script evaluation.
5. Ask the loader for a normalized `LoadedScene`:
   - the portable loader imports and validates the default scene object;
   - the classic loader parses source and returns an evaluator without running
     it yet.
6. Resolve size/background precedence. Classic background may still be pending
   until quickStart/setup executes; construct it as transparent unless the CLI
   already supplied an override.
7. Validate resource limits before creating a native canvas.
8. Construct the appropriate space (`SkiaCanvasSpace` or private
   `LegacyDemoSpace`) and form.
9. Set the initial pointer before registering players.
10. Create the exact-Pts scene context and asset service from the loaded
    source/base configuration.
11. Await portable setup or execute the classic evaluator exactly once. A
    classic quickStart/setup background is applied and the space cleared before
    that script registers its first player, unless the CLI override wins.
12. Await tracked asset promises and capture resulting metadata such as
    `window.demoDescription`.
13. Finish the runner's deferred initialization phase: invoke each initial
    player's `resize` in one stable pass, then invoke each initial player's
    `start` in a second stable pass.
14. For an advanced classic CanvasSpace constructor, invoke its recorded ready
    callback once with `(bound, canvasFacade)` after resize/start, matching the
    reviewed CanvasSpace `_ready` order. Lifecycle additions made by that
    callback use post-ready semantics.
15. Apply scheduled resize/action events in defined order.
16. Render the direct frame or simulated frames.
17. Freeze Space-managed mutation for export.
18. Export every requested format from the same final canvas into run-owned
    artifacts, in request order.
19. Unfreeze mutation, then await scene cleanup. Cleanup cannot change the
    already exported result.
20. Dispose the space and release loader resources.
21. Return artifact metadata to the parent.
22. Atomically commit output files or materialize requested in-memory Buffers.

The loader boundary therefore normalizes _execution_, not merely a setup
function. This is important because a classic script expects quickStart and
`new CanvasSpace(...)` to produce the already selected root space while the
script is evaluating.

Initialization snapshots player keys at the beginning of each pass. A removed
player is skipped before its callback. Players added by an initial resize/start
callback enter a pending queue and receive their own resize-then-start lifecycle
after the current snapshot, still before frame 0. The worker timeout contains a
scene that adds players without bound during initialization.

Match the latest reviewed Pts arguments: resize receives the live bound treated
as read-only, while start receives a clone plus the concrete space. Tests should
lock this intentionally rather than normalize both callbacks to the same object.

Every thrown error is tagged with one phase:

```text
arguments | load | validate | setup | input | frame | export | cleanup | commit
```

If cleanup also fails after a primary error, retain the primary error and attach
cleanup failure as structured secondary context.

## 14. Pointer, action, resize, and event semantics

### 14.1 Adapter primitives

Add genuine deterministic input primitives to the adapter rather than browser
no-ops:

```ts
space.setPointer([x, y]);
space.dispatchAction("move", [x, y]);
space.resize(width, height);
space.renderFrame(time, { delta });
```

Rules:

- `setPointer` clones the supplied value and does not dispatch an action.
- Pointer values are finite numbers and are not clamped; browser pointers can
  temporarily be outside the bound.
- `dispatchAction` visits a snapshot of current players in stable insertion
  order, then updates pointer coordinates and its `id` to the action type. This
  intentionally matches the reviewed revamp `_mouseAction` ordering: an action
  callback that reads `space.pointer` sees the prior pointer, while its `x`/`y`
  arguments carry the current event position.
- CLI/timeline action names are validated against the supported pointer values
  in the installed `UIPointerActions` object. `all`, `keydown`, and `keyup` are
  not pointer events and are rejected in version 1; keyboard input needs its own
  schema. Custom strings are allowed only in the programmatic low-level API, not
  accepted accidentally from a CLI typo.
- A player removed before its action turn is skipped. A player added during an
  action receives future actions only.
- Action callbacks receive `(type, x, y, event)` with a documented minimal event
  object in compatibility mode. No fake DOM PointerEvent class is promised.
- Resize updates bound, canvas, context state, forms, pointer policy, and player
  resize callbacks before the next animation frame.
- Resizing does not silently recenter a pointer explicitly supplied by the
  caller. The initial implicit center pointer tracks the center until the first
  explicit pointer/input event.
- Input, frame, resize, and export remain non-reentrant.

The CLI scheduler treats its explicit event timeline as active input even though
it does not run Pts's requestAnimationFrame loop. Legacy `play()` intent is
retained in diagnostics but does not suppress explicitly requested CLI frames or
events.

The synthetic event object exposes only stable data needed by reviewed demos and
Pts UI handlers: action type, `timeStamp`, coordinates, button/buttons state,
modifier booleans, `pointerType: "synthetic"`, `isPrimary`, and no-op
`preventDefault`/`stopPropagation` methods that record whether they were called.
It is structurally useful but is never advertised as `instanceof MouseEvent`.

The exact method names will be verified against the latest Pts Space surface to
avoid a future name collision. If Pts already exposes a backend-neutral action
dispatch seam at implementation time, use it rather than duplicate it.

### 14.2 Event timeline

Version the JSON event format:

```json
{
  "schemaVersion": 1,
  "events": [
    { "at": 0, "type": "move", "x": 100, "y": 100 },
    { "at": 500, "type": "down", "x": 100, "y": 100 },
    { "at": 800, "type": "drag", "x": 220, "y": 160 },
    { "at": 900, "type": "up", "x": 220, "y": 160 },
    { "at": 1000, "type": "resize", "width": 800, "height": 600 }
  ]
}
```

For each simulated frame, apply all events whose `at` is greater than the prior
frame time and less than or equal to the current frame time, ordered first by
`at` and then by source order. At time 0, apply events before frame 0. Direct
render mode applies every event with `at <= time` in order before its one frame.

The timeline root and event records reject unknown keys. `at` is finite and
non-negative; action coordinates are finite; resize dimensions are positive
integers. Input may be unsorted—the runner performs a stable `(at, sourceIndex)`
sort. Optional button/modifier fields populate the synthetic event. One action
record dispatches exactly that Pts action; it does not synthesize browser
fan-out such as `down` plus `pointerdown`.

`--pointer x,y` sets state only and does not imply a `move` callback. This
distinction lets pointer-driven demos render simply while action-driven demos
use an explicit event file.

### 14.3 Randomness

With `--seed`:

1. retain the requested string and compute the reviewed Pts effective key by
   applying its exact trim-then-control-character-removal behavior;
2. call the latest Pts `Num.seed(requestedSeed)` before setup;
3. install a seeded `Math.random` in the isolated CLI worker before scene setup;
4. inject a deterministically derived seeded Math stream into the legacy VM
   context;
5. report requested/effective seed plus algorithm version in result metadata;
6. reset/isolate state between renders by terminating the worker.

Pts `Num.random`, worker `Math.random`, and legacy-VM `Math.random` are stable
but separate named streams derived from the same seed. Consumption in one stream
therefore does not unexpectedly shift another. The derivation algorithm is
versioned as result metadata; changing it is a reproducibility-breaking change
even if the public seed string stays the same.

For `pts-cli-seed-v1`, the two Math streams hash the UTF-8 bytes of
`pts-cli-seed-v1\0<domain>\0<effective-seed>` with SHA-256, using the distinct
domains `worker-math` and `legacy-math`, to initialize xoshiro128** state. The
first 16 digest bytes become four little-endian unsigned 32-bit words; an
all-zero state is replaced by the documented fixed nonzero state. Outputs are
unsigned 32-bit fractions divided by 2^32. A specified empty/whitespace-only
seed is valid and produces the fixed Pts empty sequence; it is distinct from
omitting `--seed`. The reviewed Pts UHEPRNG now consumes no host `Math.random`
during `Num.seed`, and golden tests pin all three streams. The exact Pts
revision remains part of reproducibility metadata because Pts owns its own
sequence algorithm.

Code using cryptographic randomness, time, network data, process state, or
untracked native sources is not claimed deterministic. Scene top-level random
work is discouraged because module loading precedes schema validation; the CLI
will apply an explicit CLI seed before module import where possible, but scene
metadata cannot retroactively seed top-level work.

Do not claim that the runner can detect every source of randomness. It can warn
for statically observed standard-demo usage and manifest-known cases, while the
result always records whether a seed was applied.

Supplied animation time is not a virtual wall clock. Version 1 does not replace
`Date`, `performance`, filesystem timestamps, or timers. Portable scenes that
need repeatable visuals must derive them from the `time`/`ftime` callback values
and seeded Pts randomness. A compatibility manifest entry using `Date.now()` or
another wall-clock source is marked nondeterministic or receives a fixed
fixture-specific assertion; it is never silently advertised as reproducible.

## 15. Portable module loader

Version 1 supports:

- `.mjs` ESM scenes;
- `.js` ESM scenes according to the nearest package `type`;
- `.cjs` scenes exporting the scene object through `module.exports` or
  `exports.default`;
- a file URL or filesystem path.

TypeScript, JSX, remote modules, stdin source, and loader hooks are deferred.
Adding them later must not alter the scene object schema.

Module resolution remains normal Node resolution relative to the scene file. The
worker captures scene stdout/stderr but does not intercept filesystem or network
APIs. Importing a scene executes arbitrary Node code.

## 16. Classic Pts-demo compatibility loader

### 16.1 Invocation and detection

Explicit invocation is always available:

```sh
ptsjs render demo.js --loader pts-demo --out demo.png
```

`--loader auto` may select `pts-demo` only when a non-executing source preflight
finds strong standard-demo markers such as `window.demoDescription` and
`Pts.quickStart`, or a known advanced Pts Space constructor with no module
exports. It must not import a file as a module, observe failure, and execute it
a second time as a classic script.

Use a real JavaScript lexer/parser if needed. Do not rely on a regex that can be
fooled by comments or strings. Ambiguity produces a loader-selection error with
both explicit commands in the message.

### 16.2 Execution context

The classic script runs once in a fresh `vm` context inside the render worker.
Provide:

- `globalThis`, `window`, and top-level `this` referring to the context;
- a `Pts` object composed from the exact installed revamp exports;
- the same individual Pts symbols that `Pts.namespace(window)` exposes;
- `console` methods routed to captured scene logs;
- tracked timer functions only if a supported demo needs them;
- a compatibility `Pts.quickStart`;
- a compatibility `CanvasSpace` constructor for advanced-mode demos;
- narrowly required standard globals such as URL and text encoders.

Do not expose `require`, `process`, DOM APIs, or requestAnimationFrame merely to
make an unsupported demo proceed. The VM is a compatibility boundary, not a
security sandbox.

Create the context with string/Wasm code generation disabled unless a
manifest-tested demo demonstrates a legitimate need, and apply a short
synchronous `vm` execution timeout in addition to the parent's hard worker
deadline. These are defense-in-depth and failure-quality measures, not claims of
hostile-code isolation.

Construct the facade by copying the installed module namespace first and then
overriding `quickStart`, `namespace`, `CanvasSpace`, and any explicitly
supported compatibility types. Its `namespace(scope)` copies the facade, not the
raw module namespace, so a standard `Pts.namespace(this)` cannot accidentally
restore the browser CanvasSpace implementation.

### 16.3 `Pts.quickStart` mapping

Legacy quickStart will:

1. ignore the DOM selector after retaining it in diagnostics;
2. bind the script to the private, runner-created `LegacyDemoSpace` backed by
   `SkiaCanvasSpace`;
3. apply the background argument and clear before player registration unless a
   CLI background override already won;
4. reuse the runner-created form;
5. publish `space` and `form` in the VM context;
6. return the familiar `(animate, start, action, resize) => void` registration
   function, which also records the bind/play sequence performed by the real
   revamp quickStart helper;
7. record direct calls to bind/play methods without starting a browser loop;
8. reject a second root quickStart/CanvasSpace instead of ambiguously replacing
   the first render surface.

Omitting quickStart's background preserves the reviewed Pts default `#9ab`.
Passing an explicit falsy/invalid color follows a documented validation path; it
is not silently converted to the CLI's transparent default.

The browser revamp helper can choose CanvasSpace or SVGSpace from the mounted
DOM element. The `pts-demo` loader intentionally always chooses the Skia Canvas
surface; direct SVGSpace/SVGForm demos receive `not-applicable`, because CLI SVG
is exported from Canvas drawing commands rather than a DOM SVG renderer.

`LegacyDemoSpace` exists only in the compatibility module. It may implement:

```text
setup({ bgcolor, resize, retina, pixelDensity })
pixelScale
bindMouse()
bindTouch()
bindKeyboard()
track()
untrack()
play()
playOnce()
minFrameTime()
```

These methods record requested behavior and return `this` for chaining. They do
not appear on ordinary `SkiaCanvasSpace`, whose unsupported browser lifecycle
methods remain strict.

The CLI's explicit direct/simulated clock wins over legacy `play`, `playOnce`,
and `minFrameTime` scheduling. `play`/`playOnce` record intent;
`minFrameTime(nonzero)` emits a compatibility warning, and any demo whose output
depends on dropped browser frames is `partial` until a separate scheduler mode
is designed. This preserves the strong promise that `--frame N` invokes every
index from 0 through N.

`setup` mappings:

- `bgcolor` maps to the adapter background unless the CLI overrides it;
- `resize` records that resize callbacks are expected;
- `retina` and `pixelDensity` do not alter logical coordinates; raster density
  remains an output setting and a compatibility notice explains the mapping;
- `pixelScale` reports the compatibility surface scale (initially 1), not raster
  export density; demos whose algorithms require a browser backing-store scale
  receive a partial-support classification until tested;
- `offscreen` is rejected until a real compatible implementation exists.

The injected advanced-mode `CanvasSpace(selector, readyCallback)` constructor
returns the one runner-owned `LegacyDemoSpace`; the selector is diagnostic only.
If supplied, the ready callback is tracked and invoked once after evaluation,
tracked setup work, initial resize, and initial start, but before the first
frame. This matches the reviewed CanvasSpace `_ready` order. Its arguments are
the live bound treated as read-only and a documented narrow canvas facade, not
an HTMLCanvasElement. A second root-space construction is an error. Players
added by the ready callback receive post-ready add semantics: immediate resize,
no invented start.

`track`/`untrack` may reuse the latest Pts UI tracking semantics because
synthetic actions can drive them without a DOM. Keyboard event generation is
deferred unless a compatibility fixture requires it; binding keyboard alone does
not invent events.

### 16.4 Lifecycle compatibility

- players registered during classic evaluation are queued until evaluation and
  tracked setup work finish; their `resize` callbacks then run with initialized
  bounds before `start`, matching the reviewed browser-ready pattern.
- `start` runs once per player.
- function players retain their player-object `this` receiver.
- `play()` records intent and returns; the CLI scheduler owns actual frames.
- the function returned by quickStart performs its normal implicit
  bindMouse/bindTouch/play recording after it registers callbacks.
- `refresh(false)` is honored across simulated frames.
- script calls after `play()` continue during initial evaluation just as normal
  JavaScript; no frame runs until evaluation and tracked setup work finish.
- if `vm.Script.runInContext` returns a thenable completion value (including the
  standard demos whose final expression is an async IIFE), it is awaited.
- asset-helper promises created by compatibility shims are tracked and awaited
  even if the script does not return them directly.
- timers created through supplied timer wrappers are tracked; remaining timers
  trigger a diagnostic and are cancelled at cleanup.
- arbitrary unreturned Promises cannot be enumerated. A script whose async work
  is neither its completion value nor created through a tracked compatibility
  helper is classified partial/nondeterministic rather than falsely awaited.
- `window.demoDescription`, when assigned a string, becomes result metadata and
  never affects rendering.

### 16.5 Legacy globals and mutation

Each demo receives new globals. Never reuse one VM context across demos or
parallel render requests. This prevents `let` redeclaration failures, global
`space`/`form` leakage, Pts namespace mutation, and random state bleed.

Do not monkey-patch the imported Pts module object. Construct a compatibility
facade and inject it into the VM. Native Pts constructors remain the exact
installed revamp implementations.

### 16.6 Legacy images

Implement compatibility incrementally:

1. Map `Img.load(path)` to the scene asset service when the demo only passes the
   resulting image to `form.image`.
2. Provide compatible `loaded`, `image`, width, and height views required by
   those demos.
3. Resolve root-relative demo asset paths through an explicit `--asset-root` or
   manifest entry; never guess the machine filesystem root.
4. Test crop rectangles, filters, transforms, and image drawing against Skia.
5. Classify `Img.blank`, `Img.pattern`, pixel editing, and internal-canvas forms
   separately. Do not claim them through the simple load bridge.

## 17. Compatibility matrix and promises

Maintain a machine-readable manifest tied to the exact Pts revision. Each demo
has one status:

```text
supported | supported-with-input | partial | unsupported | not-applicable
```

Each non-supported status includes a stable reason code. Documentation is
generated from this manifest so claims cannot drift from tests.

Initial feature targets:

| Feature                          | Portable scenes  | Classic demos    | Version 1 policy                             |
| -------------------------------- | ---------------- | ---------------- | -------------------------------------------- |
| Pts geometry and numeric APIs    | yes              | yes              | Full installed-revamp behavior               |
| Space size/center/bounds         | yes              | yes              | Supported                                    |
| CanvasForm primitives            | yes              | yes              | Supported subject to Skia parity tests       |
| gradients and compositing        | yes              | yes              | Supported with visual tests                  |
| direct `form.ctx` Canvas 2D      | structural       | structural       | Supported when Skia implements the operation |
| text, textBox, paragraphBox      | yes              | yes              | Supported with registered-font guidance      |
| `start` and `resize`             | yes              | yes              | Supported with defined ordering              |
| time-only animation              | yes              | yes              | Direct or simulated modes                    |
| Tempo/physics/stateful animation | yes              | yes              | Simulated-frame mode required                |
| pointer reads                    | yes              | yes              | Static/configured pointer supported          |
| action callbacks                 | yes              | yes              | Event timeline required for behavior         |
| Pts UI interaction               | possible         | partial          | Test after synthetic actions land            |
| local image drawing              | asset helper     | bridge           | Targeted for version 1                       |
| remote image drawing             | opt-in           | opt-in           | Reproducibility warning                      |
| `Img.blank` / patterns / pixels  | backend-specific | partial          | Deferred unless implemented faithfully       |
| custom fonts                     | asset helper     | CLI registration | Supported before text layout                 |
| Canvas offscreen helpers         | no               | no               | Explicit unsupported error                   |
| Sound/microphone                 | no               | no               | Unsupported/not applicable                   |
| HTMLSpace/HTMLForm               | no               | no               | Unsupported/not applicable                   |
| SVGSpace/SVGForm                 | browser only     | no               | Not the SVG export path                      |
| recorder/video                   | no               | no               | Deferred                                     |

The first release notes must state the tested manifest revision and counts. Do
not advertise “all demos” unless the manifest says so.

## 18. SVG output

Skia Canvas retains drawing commands and can export the same canvas to raster or
SVG. SVG is therefore an exporter addition, not a second Pts renderer.

### 18.1 Adapter API

Extend format types from raster-only to discriminated output types:

```ts
type RasterFormat = "png" | "jpg" | "jpeg" | "webp" | "raw";
type VectorFormat = "svg";
type OutputFormat = RasterFormat | VectorFormat;

interface SvgExportOptions {
  /** false preserves text elements; true converts glyphs to paths. */
  outline?: boolean;
}
```

Preserve the familiar low-level calls:

```ts
await space.toBuffer("svg", { outline: true });
await space.toFile("art.svg", { outline: false });
```

Use overloads or discriminated internal requests so raster-only options cannot
be passed to SVG in TypeScript and are rejected clearly in JavaScript.

`toURL("svg")` may be supported if Skia's data URL behavior passes package and
consumer tests. PDF remains explicitly rejected.

### 18.2 Text policy

CLI vocabulary is semantic:

```text
--text-mode preserve  -> Skia outline: false
--text-mode outline   -> Skia outline: true
```

Default to `preserve` because it keeps searchable/selectable text and smaller
files. Document that viewers need the same fonts. `outline` prioritizes visual
portability at the cost of file size, accessibility, selection, and editability.

### 18.3 Fidelity boundary

Canvas-generated SVG is a serialization of Canvas drawing semantics. It is not a
Pts scene graph or hand-editable SVG DOM model. Source bitmap images remain
raster content, and backend fallbacks for filters, compositing, clipping, and
other complex operations must be measured rather than assumed.

### 18.4 SVG tests

1. Validate XML and root dimensions.
2. Verify representative geometry remains vector paths.
3. Verify preserve mode contains recoverable text where expected.
4. Verify outline mode contains paths and no recoverable scene text.
5. Render the SVG back to a bitmap and compare against direct PNG output with a
   documented tolerance.
6. Test gradients, alpha, clipping, images, transforms, and composite modes.
7. Avoid exact full-document string snapshots; Skia serialization details may
   change without visual change.
8. Scan output for unexpected external resource references.

## 19. Errors and diagnostics

Extend the existing typed-error approach. Every public error has:

- a stable code;
- a lifecycle phase;
- a concise user message;
- optional source location, output path, frame index/time, and cause;
- a remediation hint when the failure is an intentional compatibility boundary.

Proposed error families:

```text
CLI_USAGE
SOURCE_NOT_FOUND
LOADER_AMBIGUOUS
SCENE_INVALID
SCENE_API_UNSUPPORTED
PTS_INCOMPATIBLE
PTS_INSTANCE_MISMATCH
COMPAT_API_UNSUPPORTED
ASSET_NOT_FOUND
ASSET_NETWORK_DISABLED
ASSET_LIMIT
FONT_REGISTRATION_FAILED
INPUT_TIMELINE_INVALID
FRAME_IN_PROGRESS
EXPORT_IN_PROGRESS
OUTPUT_FORMAT_UNSUPPORTED
OUTPUT_OPTION_INVALID
OUTPUT_TARGET_INVALID
OUTPUT_EXISTS
OUTPUT_COMMIT_FAILED
RESOURCE_LIMIT
RENDER_ABORTED
RENDER_TIMEOUT
RENDERER_UNAVAILABLE
SCENE_FAILED
NATIVE_RENDER_FAILED
WORKER_FAILED
```

CLI exit-code groups:

| Code | Meaning                                 |
| ---: | --------------------------------------- |
|    0 | success                                 |
|    2 | CLI usage or validation error           |
|    3 | source/loader/scene compatibility error |
|    4 | setup, input, or frame error            |
|    5 | export or output commit error           |
|    6 | environment/native dependency error     |
|  124 | timeout                                 |
|  130 | interrupted by SIGINT                   |

Exact codes become part of the agent contract and require tests.

## 20. Security and resource policy

### 20.1 Trust model

Both ESM scenes and classic demos execute JavaScript. The child process and VM
protect protocol integrity and contain ordinary crashes; neither is a security
sandbox. Documentation must say to run untrusted or AI-generated code inside an
OS/container sandbox with only the intended workspace mounted.

Do not describe the absence of `process` in the legacy VM as secure isolation.

### 20.2 Limits

Use one public, versioned limits object across CLI and API:

```ts
interface RenderResourceLimits {
  maxWidth: number;
  maxHeight: number;
  maxLogicalPixels: number;
  maxRasterPixelsPerOutput: number;
  maxRasterPixelsTotal: number;
  maxFramesInvoked: number;
  maxFps: number;
  maxEvents: number;
  maxOutputs: number;
  maxSourceBytes: number;
  maxInputBytes: number;
  maxSeedBytes: number;
  maxMetadataBytes: number;
  maxAssetBytes: number;
  maxAssetBytesTotal: number;
  maxArtifactBytesTotal: number;
  maxBufferResultBytes: number;
  maxCapturedLogBytes: number;
}
```

Proposed version-1 defaults (subject to one measured native-allocation spike,
then frozen for the major version):

| Limit                          |              Default |
| ------------------------------ | -------------------: |
| width or height                | 16,384 logical units |
| logical area                   |     64 million units |
| raster pixels per output       |           64 million |
| raster pixels across outputs   |          128 million |
| frame callbacks                |               10,000 |
| fps                            |                1,000 |
| events                         |               10,000 |
| outputs                        |                   16 |
| scene source                   |                5 MiB |
| params/timeline input, each    |                5 MiB |
| UTF-8 seed string              |                4 KiB |
| scene metadata                 |              256 KiB |
| one fetched asset              |               32 MiB |
| all fetched assets             |              128 MiB |
| all encoded artifacts          |              512 MiB |
| one returned Buffer            |              128 MiB |
| captured scene logs, aggregate |                1 MiB |
| default hard timeout           |           30 seconds |
| network redirects              |                    5 |

Validate dimensions, logical area, requested densities, frame/event/output
counts, and known raw-buffer sizes before native allocation. Enforce encoded,
network, and log limits while streaming/producing data. Integer arithmetic must
check overflow before multiplication.

`--limit name=value` and programmatic `limits` accept only named fields above;
unknown names, non-safe integers, and values below one fail before execution.
The hard timeout remains its dedicated option. Every override is included in
result metadata. These are accidental-resource guards, not a replacement for an
OS memory/CPU sandbox.

### 20.3 Worker behavior

- one render job per worker process in version 1;
- kill the full child process on timeout or parent cancellation;
- forward SIGINT once, then force termination after a short grace period;
- cap captured logs and report truncation;
- treat unexpected worker exit or malformed IPC as a native/worker failure;
- never commit output files until the parent has received complete output
  metadata and verified run-owned artifact paths;
- clean only run-owned temporary files.

The parent chooses every artifact path. Destination-bound artifacts live beside
their final path; Buffer-only artifacts live in a private job temp directory.
After the worker exits successfully, the parent verifies that each artifact is a
regular file owned by this job, recomputes size/hash, and enforces aggregate
limits before any commit.

`timeoutMs` starts before worker spawn and covers load, setup, input, frames,
exports, cleanup, and artifact handoff. Killing the child makes that execution
deadline hard. The parent keeps the same deadline/cancellation state during
commit, stops before each new commit once cancelled, and reports any already
committed paths; an in-progress filesystem syscall itself is not preemptible.

## 21. Test strategy

### 21.1 Phase 0 baseline tests

1. Update this repository to the exact latest reviewed revamp commit.
2. Review every changed Pts API touched by the adapter.
3. Run current adapter tests before adding CLI behavior.
4. Remove compatibility fallbacks made obsolete by the new baseline only after
   tests prove the native revamp path.
5. Record the commit in compatibility notes and lockfile.
6. Record `/app/pts` HEAD plus a status/diff fingerprint before and after;
   verify this work introduced no delta. Pre-existing user changes are neither a
   failure nor permission to clean that checkout.

### 21.2 Unit tests

- scene schema validation and unknown-key behavior;
- option precedence;
- dimension/resource validation;
- direct versus simulated clocks;
- first-frame and subsequent deltas;
- seeded Pts and Math randomness;
- pointer cloning and implicit-center behavior;
- action ordering and player mutation during dispatch;
- resize/start ordering;
- runner versus low-level late-add lifecycle modes;
- Pts action callback versus pointer-update ordering;
- format-specific option validation;
- error serialization and exit-code mapping;
- output-path collision and overwrite policy;
- event timeline ordering;
- asset and font path resolution.

### 21.3 Adapter rendering tests

- every ordinary CanvasForm drawing category;
- gradients, compositing, alpha, transforms, clipping, dashes, and direct ctx;
- text measurement, textBox, paragraphBox, alignments, and registered fonts;
- image destination/crop rectangles and filters;
- multiple forms and style-cache invalidation;
- resize after form creation;
- PNG and SVG from one unchanged canvas;
- PNG-then-SVG, SVG-then-PNG, and repeated-export order invariance;
- concurrent exports without mutation;
- mutation rejection during exports.

### 21.4 Scene-loader integration tests

- ESM `.mjs` scene;
- package-typed `.js` scene;
- CommonJS scene;
- async setup and cleanup;
- scene-relative import and assets;
- source path containing spaces and Unicode;
- top-level and setup failures;
- console output capture;
- timeout and cancellation;
- returned output buffers and file outputs;
- worker crash/malformed response handling.

Browser-entry integration tests additionally cover:

- bundling `pts-cli/browser` with no Node built-in or Skia module in the graph;
- the exact same scene object in browser CanvasSpace and Node SkiaCanvasSpace;
- fixed and responsive size precedence;
- synchronous and async setup on both sides of the CanvasSpace ready event;
- exactly-once resize/start initialization;
- mouse/touch binding ownership;
- browser image/font assets and scene-relative URL behavior;
- awaited cleanup and idempotent disposal.

Add a lifecycle reference harness that runs an instrumented player against the
actual reviewed browser CanvasSpace and against both portable runners. Compare
the ordered trace—not pixels—for add/remove, initial resize/start, ready
callback, action arguments, pointer-before/pointer-after, animate time/delta,
function `this`, and exceptions. This catches compatibility drift that a pretty
but static image cannot reveal.

### 21.5 Classic-demo tests

Maintain two fixture layers:

1. Small attributed fixtures in this repository cover each loader behavior
   without depending on a neighboring checkout.
2. A CI compatibility job checks out the Pts repository at the exact manifest
   commit into a temporary location and runs the selected standard demos
   unchanged.

The CI job must never commit, patch, format, build into, or generate files
inside the Pts checkout. Outputs go to the CLI job's temporary directory.

For every manifest entry marked supported:

- source evaluation succeeds once;
- setup and expected lifecycle callbacks occur;
- the expected number of frames runs;
- output is non-empty and structurally valid;
- semantic pixel/vector probes pass;
- warnings match the manifest;
- no unsupported fallback was silently used.

Use fixed dimensions, pointer, events, time/frame, seed, assets, and test fonts.
For a representative Canvas subset, also run the unchanged demo in Playwright
with the same reviewed Pts build and capture semantic probes plus a reference
bitmap. Compare with documented tolerances; do not expect byte identity between
browser Canvas and Skia.

### 21.6 Visual tests

- Prefer semantic pixel probes for simple primitives.
- Use perceptual/tolerance comparisons for complex raster scenes.
- Register a repository-owned test font to avoid host font variance.
- Run SVG round-trip comparisons.
- Keep OS-specific baselines only when a documented backend difference makes a
  shared baseline unreasonable.
- Update baselines only through an explicit review command.
- Record Skia version, Pts commit, Node version, platform, and renderer in
  failure artifacts.

### 21.7 CLI black-box tests

- help and version output;
- help/version and argument errors without native-module initialization;
- successful human and JSON modes;
- stdout binary purity;
- scene log routing;
- every exit-code family;
- repeated outputs;
- atomic failure behavior;
- existing destination with and without `--force`;
- SIGINT and timeout;
- invalid/mutually exclusive flags;
- package-installed invocation through its `bin` link;
- `npx`-style packed package smoke test;
- npm and pnpm peer-resolution layouts, including a deliberate duplicate-Pts
  failure;
- destination creation races proving no-clobber behavior without `--force`.

### 21.8 Cross-platform CI

At minimum test supported Node LTS/current versions on Linux, macOS, and Windows
where Skia prebuilds are available. Separate:

- type/package tests, which should be platform-stable;
- semantic rendering tests;
- tolerance-based visual tests;
- native installation smoke tests.

Do not claim a platform until its hosted native install and at least one PNG and
SVG render pass.

Required CI always uses the lockfile/manifest commit. A separate scheduled or
manually triggered advisory job may test the then-current `revamp` head and
publish a drift report, but it must not mutate the lockfile, compatibility
manifest, baselines, or neighboring checkout automatically.

## 22. Compatibility manifest

Proposed record shape:

```json
{
  "schemaVersion": 1,
  "pts": {
    "branch": "revamp",
    "commit": "77420f143928d614766f13d56b2a8d7b00c44b24"
  },
  "demos": {
    "circle.intersectCircle2D.js": {
      "status": "supported",
      "sourceSha256": "...",
      "fixture": {
        "size": [640, 360],
        "time": 1000,
        "pointer": [320, 180],
        "seed": "compat"
      },
      "formats": ["png", "svg"],
      "warnings": []
    },
    "canvasspace.action.js": {
      "status": "supported-with-input",
      "events": "canvasspace.action.events.json"
    },
    "sound.play.js": {
      "status": "not-applicable",
      "reason": "AUDIO_UNSUPPORTED"
    }
  }
}
```

The manifest commit advances only through a deliberate baseline-upgrade change
that reviews Pts source/API deltas and reruns all compatibility tests. Each
entry's source hash prevents a mismatched fixture or locally edited checkout
from masquerading as the recorded commit. CI reads from a detached temporary
checkout; a hash mismatch fails before evaluation.

## 23. Documentation plan

Write documentation around user tasks:

1. install and verify native support;
2. render the first PNG;
3. render SVG and choose text mode;
4. convert a web demo to a portable scene object;
5. render an unchanged standard demo;
6. choose direct time versus simulated frames;
7. provide pointer and action input;
8. load local images and fonts;
9. create multiple outputs;
10. call the CLI from an AI agent using JSON mode;
11. use the low-level adapter in a Node service;
12. understand unsupported browser features and security boundaries.

Include a short side-by-side migration guide whose drawing callback is literally
unchanged. Keep compatibility status generated from the manifest, not a
hand-maintained prose list.

## 24. Implementation phases and gates

### Phase 0: Baseline and plan gate

1. Approve this public API direction.
2. Confirm the release package name; keep `ptsjs` as the executable.
3. After confirmation, update this repository's package metadata, documentation,
   internal self-references, and packed-consumer fixtures to the one selected
   package name. Do not rename a remote repository automatically.
4. Move `skia-canvas` to a normal runtime dependency and retain Pts as the
   single unbundled peer, with packed installer tests for both.
5. Update only this repository's Pts dependency/lock to the latest reviewed
   `revamp` commit.
6. Review the adapter against current Space, CanvasForm, typography, UI, and
   type changes.
7. Make all existing checks pass at the new baseline.
8. Update compatibility notes with exact revisions.

Gate: no CLI implementation begins on a stale Pts dependency.

### Phase 1: Adapter completeness for the CLI

1. Add deterministic pointer state and action dispatch.
2. Add a runner-controlled deferred player-initialization phase while preserving
   normal low-level `add` behavior.
3. Add an explicit runner late-add policy matching the latest browser Space,
   while preserving the low-level adapter's existing convenience policy.
4. Reconcile lifecycle and action/pointer ordering with the latest Space
   implementation and browser reference trace.
5. Add SVG format/types and text outlining.
6. Add renderer selection and resource validation needed before canvas
   allocation.
7. Expand CanvasForm category tests and register a deterministic test font.
8. Preserve current low-level API compatibility where it does not conflict with
   the stronger discriminated types.

Gate: low-level code can render the representative portable callback to PNG and
SVG with deterministic pointer/time.

### Phase 2: Portable scene and runner

1. Implement the versioned scene validator.
2. Implement ESM/CJS loading.
3. Implement async setup/cleanup and the asset service foundation.
4. Implement direct and simulated clocks.
5. Implement option precedence, seed, params, and result metadata.
6. Add the optional browser-safe `defineScene` entry point only if dependency
   isolation is provable.
7. Implement and browser-test the Skia-free `mountScene` entry point, including
   its instance-local registration gate and async setup versus CanvasSpace-ready
   ordering.
8. Convert `basic-card.mjs` into the canonical portable example.

Gate: one scene module is renderable unchanged by the documented browser mount
helper and `renderScene`.

### Phase 3: CLI and worker

1. Add the `ptsjs` bin and argument parser.
2. Implement the child-process protocol.
3. Implement worker-owned artifact transport and bounded parent materialization
   for Buffer results.
4. Implement logging/JSON/stdout guarantees.
5. Implement output validation, temporary encoding, atomic no-clobber/replace,
   resource limits, overwrite policy, signals, and timeout.
6. Add packed-package and black-box tests.

Gate: an agent can invoke one command, receive a stable JSON record, and find a
validated PNG or SVG at the reported path.

### Phase 4: Classic-demo compatibility

1. Implement the VM context and Pts namespace facade.
2. Implement `Pts.quickStart` and `LegacyDemoSpace`.
3. Implement advanced direct CanvasSpace construction.
4. Reproduce initial lifecycle then ready-callback ordering.
5. Await completion-value thenables and tracked work without claiming to detect
   arbitrary unreturned Promises.
6. Add pointer and event-timeline plumbing.
7. Build the exact-revision/source-hash compatibility manifest.
8. Run representative geometry, gradient, text, resize, action, Tempo, physics,
   UI, and composite demos.

Gate: every demo labeled supported is rendered unchanged in CI, and every
unsupported category has a stable diagnostic.

### Phase 5: Images and fonts

1. Complete portable image/font helpers.
2. Bridge the simple legacy `Img.load` cases.
3. Define asset roots and network policy.
4. Test crop, transform, filter, and image-backed SVG behavior.
5. Evaluate complex Img/pattern/pixel demos independently.

Gate: image and font support is deterministic, scene-relative, documented, and
covered on supported platforms.

### Phase 6: Release hardening

1. Run the full package, native, CLI, compatibility, and visual matrix.
2. Generate compatibility documentation from the manifest.
3. Verify tarball contents and executable permissions.
4. Resolve the Pts revamp publication/version requirement.
5. Remove `private` only after package-name ownership and release prerequisites
   are confirmed.
6. Publish a pre-release before claiming a stable compatibility surface.

## 25. Alternatives rejected

### Modify Pts quickStart or CanvasSpace

Rejected. It violates the repository boundary and would burden the browser
library with a Node CLI's lifecycle and native dependency concerns.

### Install browser globals in Node

Rejected for the core adapter. Global shims hide unsupported behavior, leak
between jobs, and interfere with applications. Legacy globals belong in a fresh
compatibility context only.

### Make classic demos the primary scene format

Rejected. It preserves globals and browser bootstrapping as the future API.
Classic support is valuable migration compatibility, while portable scene
modules are the maintainable contract.

### Rewrite demos into modules automatically

Rejected for version 1. AST transformations complicate source maps, comments,
scope, async behavior, and debugging. A runtime facade can execute the common
classic shape without changing source.

### Run a headless browser

Rejected as the primary renderer because it does not validate the Skia/Node
integration, has a much larger operational footprint, and does not naturally
produce Skia SVG. A browser remains useful as a reference renderer in visual
parity tests.

### Expose no programmatic adapter

Rejected. The CLI is the primary product, but the tested adapter is useful for
servers, batch systems, and custom schedulers and is the clean engine beneath
the command.

### Ship both `pts` and `ptsjs` binaries

Rejected initially. The alias would reintroduce the known command collision and
make agent documentation ambiguous. It can be revisited from real usage data.

## 26. Principal risks and mitigations

| Risk                                                                | Mitigation                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| revamp moves faster than the adapter lock                           | exact required manifest job, explicit upgrade review, separate advisory revamp-HEAD drift job |
| compatibility facade silently diverges from quickStart              | lifecycle tests against unchanged demos and reviewed `_script.ts`                             |
| async browser setup crosses CanvasSpace ready                       | instance-local registration gate plus browser/Node lifecycle trace tests                      |
| direct timestamp gives wrong stateful output                        | separate direct and simulated command modes                                                   |
| pointer demos look empty or misleading                              | center default, explicit pointer metadata, per-demo fixtures                                  |
| synthetic action looks right but exposes the wrong pointer state    | lock latest callback-before-pointer-update order in reference traces                          |
| action demos appear supported without interaction                   | `supported-with-input` status and required event timelines                                    |
| scene logs corrupt agent output                                     | child-process capture and parent-owned stdout                                                 |
| native crash takes down protocol                                    | one render per worker process                                                                 |
| VM is mistaken for a security sandbox                               | explicit trust model and container recommendation                                             |
| fonts cause cross-platform drift                                    | registered test fonts, text mode, recorded renderer metadata                                  |
| SVG is mistaken for semantic SVGForm output                         | explicit Canvas-SVG fidelity boundary                                                         |
| output failure leaves partial files or clobbers a racing writer     | run-owned artifacts, tested no-clobber commit, structured partial-commit details              |
| browser entry bundles Skia or makes web-only installation too heavy | dependency-edge test now; evaluate later package extraction without changing scene API        |
| CLI install omits a native renderer or duplicates Pts               | direct Skia dependency, Pts peer, packed npm/pnpm layout tests                                |
| reference checkout contains unrelated user work                     | compare HEAD/status/diff fingerprints; never clean or write the checkout                      |
| legacy Img grows into DOM emulation                                 | stage simple loading separately from blank/pattern/pixel APIs                                 |
| too many compatibility promises block release                       | manifest statuses and staged gates instead of blanket support                                 |

## 27. Definition of done

The first CLI milestone is complete only when:

1. this repository targets the latest explicitly reviewed Pts revamp commit;
2. the Pts repository has no task-introduced delta from its recorded initial
   HEAD/status/diff fingerprint;
3. `ptsjs render scene.mjs --out art.png` works from a packed install;
4. the same portable scene is mounted by `pts-cli/browser` without source
   changes or a Skia dependency in its browser bundle;
5. PNG and SVG export through the public adapter and CLI;
6. SVG preserve/outline text behavior is tested and documented;
7. direct and simulated clocks have stable tests;
8. pointer, resize, and action semantics are deterministic;
9. the CLI provides stable JSON success/failure records and exit codes;
10. scene logs cannot corrupt stdout protocols;
11. output writes honor collision, atomicity, timeout, and cleanup policies;
12. the compatibility manifest is tied to an exact Pts commit and per-demo
    source hashes;
13. representative unchanged demos pass in every supported compatibility
    category;
14. unsupported browser categories fail with explicit reason codes;
15. the full lint, format, type, unit, integration, package, native, and
    selected visual checks pass;
16. documentation clearly separates portable scenes, legacy demos, low-level
    Node APIs, and browser-only features;
17. release metadata does not claim a platform, format, or demo beyond tested
    evidence.

## 28. Questions intentionally deferred until release preparation

These do not block the architecture or implementation order:

1. Whether the published package is `pts-cli` or `@ptsjs/cli`, provided the
   package name is finalized before public documentation and publication.
2. Which complex Pts Img demos graduate from `partial` after the simple image
   bridge lands.
3. Whether the tested `pts-cli/browser` entry point should later be extracted
   into a separate browser-only package to avoid installing Node-native
   dependencies in web-only projects.
4. Whether a separately named, explicitly trusted in-process scene-object helper
   is useful after the worker-based `renderScene` API is established. It must
   not overload `renderScene` with different timeout or seed semantics.

None of these may weaken the hard constraints, scene schema, deterministic clock
distinction, compatibility manifest, or output protocol.

## 29. Second-pass API review record

The final review changed the draft in material ways rather than merely editing
wording:

1. made the context-supplied Pts namespace the single runtime authority and
   added duplicate-instance preflight;
2. kept the high-level API worker-only so cancellation and timeout remain hard
   guarantees;
3. added a browser mount lifecycle gate so one portable scene has deliberate,
   tested semantics on both runtimes;
4. corrected action ordering to the latest revamp behavior: callbacks run before
   `space.pointer` advances;
5. corrected advanced CanvasSpace ready ordering to resize, start, then ready
   callback;
6. separated runner late-add behavior from the existing low-level adapter
   convenience behavior;
7. replaced vague async-script detection with completion-value and tracked-work
   rules that are actually implementable;
8. made CPU the deterministic default and made required-GPU fallback an error;
9. completed discriminated output/result types and aligned CLI/programmatic
   assets, fonts, renderer, limits, overwrite, and path behavior;
10. moved all output transport through bounded worker artifacts and closed the
    destination no-clobber race;
11. specified concrete resource defaults and network/asset constraints;
12. added source hashes plus browser lifecycle/reference-render tests;
13. replaced the unsafe assumption that the neighboring Pts checkout must be
    clean with a no-task-introduced-delta fingerprint rule; and
14. re-reviewed the moving local revamp head through `77420f1…`, incorporated
    its Group/Bound and seeded-RNG implications, and made remote reachability a
    Phase 0 gate instead of falling back to stale code.

After these changes, no known API or lifecycle ambiguity blocks Phase 0. The
remaining questions are packaging/release choices or explicitly staged feature
coverage, not hidden implementation decisions.
