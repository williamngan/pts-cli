# Compatibility notes

- Date: 2026-08-21
- Status: implementation baseline
- Runtime: Node 24.19.0, skia-canvas 3.0.8, Pts `revamp`

## Authoritative Pts baseline

The requested authority is the latest committed local `revamp` snapshot:

```text
commit: 77420f143928d614766f13d56b2a8d7b00c44b24
package version: 0.12.9
```

The npm-published implementation is not the baseline. At this review, the public
`refs/heads/revamp` still points to `1c0256b26191ba54a8e8ecce4bc4dc9151676f4a`,
so `77420f1…` cannot yet be recorded as a reproducible Git dependency. This
repository's lockfile therefore still resolves the earlier revamp snapshot
`89205a1d8e736aee340a021f4b201034dde8e0fa`. The package remains private and
release-blocked rather than pretending that older resolution is the requested
baseline.

All latest-baseline verification used a `git archive` snapshot outside both
repositories and a temporary `node_modules/pts` symlink that was restored after
each run. No install, build, formatter, generator, or write command ran inside
`/app/pts`.

The neighboring checkout stayed at `77420f1…`. Its externally owned dirty state
was unchanged across the compatibility work; the recorded read-only fingerprints
were:

```text
git status --short: aa1b0979614e8e1f3dc61bd2fae0e892e1d4589b
git diff:         7b2385e136843f48b1db43352a1222f97635321d
```

These hashes describe preservation evidence, not input to the build. Only the
committed archive is a baseline.

## Latest-revamp findings incorporated

- Bound updates preserve live corner identity; resize callbacks receive the live
  bound while start callbacks receive a clone.
- Space action callbacks run before the pointer is updated. Synthetic action
  dispatch preserves that ordering.
- Initial CanvasSpace readiness performs resize before start. Runner setup uses
  stable two-pass initialization, including players added by lifecycle
  callbacks.
- Adding a player to an already-ready browser Space invokes resize but does not
  invent a late start. Runner-managed Node spaces follow that policy; direct
  low-level adapter use retains its earlier eager convenience behavior.
- CanvasForm is not ready during the browser's initial resize pass. The private
  classic loader reproduces this detail because `ui.track.js` depends on it.
- Canvas resize resets native context state and Pts style caches. Retained Skia
  forms are reset after resize.
- The final local Pts commits change Group/Bound behavior and seeded RNG
  behavior. Compatibility output and random goldens were regenerated only
  against `77420f1…`.
- Named text-width estimator modes (`"sample"` and `"char"`) are retained when
  the Skia form changes fonts.

## Adapter and runner decisions

1. Extend backend-neutral Pts Space, not browser CanvasSpace.
2. Supply a real CanvasForm subclass bound to a skia-canvas 2D context.
3. Keep Pts as one unbundled peer and skia-canvas as a runtime dependency.
4. Default to CPU and report requested and actual renderer facts.
5. Validate dimensions and logical area before native allocation.
6. Own explicit frame time, pointer state, synthetic actions, resize, and runner
   lifecycle.
7. Export raster and SVG from the same retained Skia canvas.
8. Keep native Skia types out of public declarations where they would expose
   optional Sharp typing; portable image results are typed for direct CanvasForm
   use.
9. Execute one-shot renders in fresh child processes for hard deadlines and
   isolated Pts/random state.
10. Reject a direct scene import that resolves to a second Pts installation.

## Asset and output boundaries

- Node and browser assets accept local/browser-relative and `data:` images;
  HTTP(S) remains opt-in in Node.
- Successful/in-flight image requests and identical font registrations are
  deduplicated per render. Failed image/font loads may be retried; reusing a
  font family with different sources is an error.
- Explicit Node asset roots reject lexical traversal and canonical file-symlink
  escape. CLI `--font` paths remain caller-working-directory relative as the CLI
  contract specifies.
- Asset diagnostics omit data payloads and redact URL credentials and query
  strings. Browser failures name loading/CORS policy without exposing them.
- Output parents are canonicalized before rendering. Aliased duplicates,
  destination directories, symlinks, and other non-regular targets are rejected
  even when overwrite is requested.
- Worker error causes cross IPC as a bounded chain; arbitrary details are
  cycle/accessor safe and stacks appear only in debug JSON.

## Classic demo compatibility

The compatibility manifest is
[`compatibility/pts-revamp.json`](../compatibility/pts-revamp.json). It pins the
exact Pts commit and SHA-256 of every selected unchanged demo.

Current checked results:

| Status               | Count | Coverage                                                                                                                        |
| -------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------- |
| supported            |    18 | geometry, color, curves, gradients, text, composite, Tempo, physics, direct/quickStart spaces, and simple image/pattern loading |
| supported-with-input |     3 | action, resize, and UI timelines                                                                                                |
| partial              |     1 | editable/pixel Img requires a broader backend abstraction                                                                       |
| not-applicable       |     4 | audio/microphone, HTMLSpace, and SVGSpace                                                                                       |

Every supported entry renders unchanged to PNG and SVG with fixed size, clock,
pointer, seed, input, warnings, and assets. Unsupported behavior is invoked in
the negative checks so it cannot pass merely because a branch remained idle.

The private VM facade supports:

- `Pts.namespace` and standard Pts globals;
- `Pts.quickStart` and one root CanvasSpace constructor;
- setup/background, bind/play intent, refresh, lifecycle, pointer, actions, and
  ready callbacks;
- async-IIFE completion values;
- Skia DOMMatrix/DOMPoint/DOMRect/ImageData/Path2D globals; and
- non-editable `Img.load`, `Img.loadAsync`, and `Img.loadPattern` through the
  bounded asset service.

It explicitly rejects multiple root spaces, editable/pixel Img operations,
Sound, HTMLSpace, SVGSpace, and arbitrary document access. The VM disables
string and Wasm code generation and has a synchronous evaluation deadline; it is
a compatibility boundary, not a hostile-code sandbox.

## Browser portability

`pts-cli/browser` imports only Pts plus browser-safe scene validation. A
Chromium product smoke verifies:

- the exact Pts namespace and real CanvasSpace/Form instances;
- async setup crossing the ready event;
- stable resize/start passes;
- duplicate IDs, removal, lifecycle additions, and function-player `this`;
- post-ready late-add behavior;
- portable browser image loading;
- drawing and playback; and
- cleanup/disposal idempotence.

The built browser dependency graph is parsed and fails if it reaches a Node
built-in, skia-canvas, or an unexpected bare import.

## Native/type observations

- skia-canvas 3.0.8 returns RGBA raw bytes and asynchronously encodes PNG, JPEG,
  WebP, and SVG.
- CPU mode reports Skia's actual engine facts; strict GPU mode fails on
  fallback.
- Skia retains commands needed for SVG, including preserved or outlined text.
- Raster images may be embedded in SVG output.
- Pts Font values with empty style/weight tokens need normalization before
  assignment to Skia.
- The current Pts CanvasForm generic is narrower than its documented custom
  context extension point. The internal `CanvasForm<any>` bridge is isolated;
  public form/space types remain concrete.
- Pts declarations require DOM library names even for Node-compatible geometry,
  so package declaration entry points carry a DOM reference.
- NodeNext and Node16 strict fixtures use `skipLibCheck: false`.

## Remaining release gates

1. Make `77420f1…` or a reviewed successor available through an immutable
   dependency source and update only this repository's lockfile.
2. Rerun every normal, packed, browser, native, and compatibility check at that
   exact lock.
3. Add the exact detached-checkout compatibility job once CI can fetch it.
4. Complete hosted Linux/macOS/Windows native results before advertising those
   platforms.
5. Decide publication ownership for `pts-cli`, then remove `private` and replace
   the Git peer with a distinct Pts revamp semver range.
6. Expand editable/pixel Img only behind a faithful backend contract; do not
   emulate it with misleading no-ops.
