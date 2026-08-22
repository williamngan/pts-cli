# Changelog

## 0.1.0 - Unreleased

### Added

- `ptsjs render` CLI with stable JSON records, exit codes, stdout output,
  multiple formats, no-clobber commits, hard timeouts, signals, and resource
  limits.
- Canonical output-path collision checks and explicit rejection of destination
  directories, symlinks, and other non-regular files, including with `--force`.
- Worker-isolated `renderScene()` API with path and Buffer outputs.
- Versioned portable scene contract plus browser-safe `defineScene` and
  `mountScene` entry points.
- Syntax-aware automatic selection between portable modules and classic Pts
  demos.
- Private classic-demo VM with `Pts.quickStart`, direct CanvasSpace support,
  lifecycle compatibility, completion-thenable handling, and explicit
  browser-only failure boundaries.
- Exact-revision/source-hash compatibility manifest and verifier for unchanged
  Pts demos.
- Portable local/data/network image and font asset services with bounded
  loading, explicit-root confinement, retryable image failures, idempotent font
  registration, and credential-redacted diagnostics.
- Classic non-editable `Img.load`, `Img.loadAsync`, and `Img.loadPattern`
  bridge.
- Deterministic direct and simulated clocks, static pointer state, synthetic
  action/resize timelines, and independent seeded Pts/JavaScript random streams.
- PNG, JPEG, WebP, raw RGBA, and SVG output, including preserved or outlined SVG
  text.
- CPU/auto/strict-GPU policies and reported renderer facts.
- Browser dependency-graph and real Chromium lifecycle/image smoke tests.
- Packed ESM/CommonJS, executable CLI, peer-deduplication, and duplicate-Pts
  rejection tests.
- Bounded structured error causes across the worker boundary, with cause stacks
  available only in debug JSON, plus cycle-safe and accessor-safe error details.

### Changed

- Package identity is now `pts-cli`; the remote repository name remains
  `skia-pts-canvas`.
- skia-canvas is a normal exact runtime dependency. Pts remains the single
  unbundled revamp peer.
- `SkiaCanvasSpace` now supports deterministic pointer/actions, runner-owned
  deferred initialization, explicit renderer selection, allocation ceilings, and
  SVG.
- Scene/option/metadata/parameter validation rejects accessors, unknown fields,
  malformed dimensions, non-JSON values, and ambiguous loader syntax before
  scene execution.
- Hostile or uninspectable option proxies are normalized into stable usage
  errors instead of escaping the public error contract.

### Release gates

- The reviewed local Pts `revamp` baseline
  `77420f143928d614766f13d56b2a8d7b00c44b24` is not yet available from the
  configured public Git ref, so the package remains private.
- Editable/pixel legacy Img, Sound, HTMLSpace, SVGSpace, and offscreen browser
  helpers remain outside the supported Node contract.
