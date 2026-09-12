# Changelog

## 0.1.0 - Unreleased

### Added

- `npx pts-cli <source>` and `ptsjs <source>` CLI forms, with an explicit
  `render` alias, stable JSON records, exit codes, stdout output, multiple
  formats, no-clobber commits, hard timeouts, signals, and resource limits.
- Collision-safe default PNG destinations with source-derived names, UUID render
  IDs, explicit trailing-slash directory targets, and format-selectable
  generated outputs.
- Canonical output-path collision checks and explicit rejection of destination
  directories, symlinks, and other non-regular files, including with `--force`.
- Worker-isolated `renderScene()` API with path and Buffer outputs.
- Portable render files with a default-exported `run` function, an optional
  configured-object form, and browser-safe `defineScene` and `mountScene` entry
  points.
- Syntax-aware automatic selection between portable files and classic Pts demos.
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

- Package and repository identity are now `pts-cli`.
- Logical dimensions are optional, default to `800x600`, and remain overridable
  through `--size` or the programmatic `size` option.
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
- Synthetic Pts action dispatch derives its event parameter from the installed
  revamp `IPlayer` contract, supporting both the earlier `Event` signature and
  the latest `UIActionEvent` signature without patching Pts.

### Release gates

- The reviewed local Pts `revamp` baseline
  `7031a246c6870b8175160e62baf1193967d029c9` is not yet available from the
  configured public Git ref, so the package remains private.
- Editable/pixel legacy Img, Sound, HTMLSpace, SVGSpace, and offscreen browser
  helpers remain outside the supported Node contract.
