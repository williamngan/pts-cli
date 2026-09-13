# Changelog

## 0.1.1 - Unreleased

### Fixed

- A consumer that closes stdout early, such as `head`, no longer produces an
  unhandled EPIPE stack trace and exit status 1; the CLI stops writing and keeps
  the render's exit status.
- `--background`, `--matte`, `renderScene()` background/matte options,
  scene-file backgrounds, and `SkiaCanvasSpace` colors are validated against the
  syntax skia-canvas accepts. Previously an unparseable color such as
  `notacolor` or a hex value missing its `#` rendered with an arbitrary color or
  silently disabled the matte.
- `--out somedir` for an existing directory now reports `OUTPUT_TARGET_INVALID`
  with a trailing-slash hint instead of "Cannot infer output format".
- `pts-render` with no arguments is a usage error (exit 2) that points at
  `--help` instead of printing help with exit 0.
- `mountScene()` keeps an explicit `size` or the scene file's width/height
  instead of letting the default `resize: true` replace it with the container
  size on the first ResizeObserver tick; `resize` now defaults to `true` only
  when no size is known.
- `mountScene()` styles the canvas it creates `display: block`, which stops the
  canvas from growing a few pixels per resize cycle in a container without an
  explicit height.
- `mountScene()` rejects a `target` selector that matches no element instead of
  letting Pts append a new container to `<body>`.

### Changed

- `--help` notes that `--out -` needs `--format`, lists the accepted color
  forms, and documents `--param` value parsing.
- `pts-output/` is ignored by Git.

### Documentation

- Fixed the "ender a file" typo, documented `pts-render/scene` and
  `defineScene()`, explained that `npx` and global installs require the `Pts`
  namespace from `run` rather than a direct `pts` import, described
  bare-specifier resolution and every `mountScene()` option for browser use,
  documented `--param` JSON parsing, `--out -` needing `--format`, the full JSON
  result shape, preserved-SVG font naming, npm 11's install-scripts warning, and
  `CI=true` for non-TTY pnpm installs.
- The site's "ecosystem guide" link points at the Pts ecosystem guide.

## 0.1.0 - 2026-09-12

### Added

- `npx pts-render <source>` and `pts-render <source>` CLI forms, with an
  explicit `render` alias, stable JSON records, exit codes, stdout output,
  multiple formats, no-clobber commits, hard timeouts, signals, and resource
  limits.
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

- Package, executable, and repository identity are now `pts-render`.
- Seeded JavaScript streams use the `pts-render-seed-v1` namespace, so their
  sequences differ from earlier development builds for the same seed.
- Logical dimensions are optional, default to `800x600`, and remain overridable
  through `--size` or the programmatic `size` option.
- skia-canvas is a normal exact runtime dependency. Pts is an unbundled `^1.0.0`
  registry peer, with development locked to published `1.0.0`.
- `SkiaCanvasSpace` now supports deterministic pointer/actions, runner-owned
  deferred initialization, explicit renderer selection, allocation ceilings, and
  SVG.
- Scene/option/metadata/parameter validation rejects accessors, unknown fields,
  malformed dimensions, non-JSON values, and ambiguous loader syntax before
  scene execution.
- Hostile or uninspectable option proxies are normalized into stable usage
  errors instead of escaping the public error contract.
- Synthetic Pts action dispatch derives its event parameter from the Pts 1.0
  `IPlayer` contract without patching Pts.

### Fixed

- Classic `Util.isMobile()` works on Node 20 without depending on a global
  browser `navigator`; the actual Pts implementation is left untouched.
- Windows drive paths are no longer mistaken for URL schemes.
- Filtered Canvas drawing is preserved in SVG through an explicit whole-canvas
  PNG fallback, reported as `SVG_RASTER_FALLBACK`.
- Direct CommonJS Pts imports and separate Pts bundles cannot silently split
  instance state or seeded randomness. CommonJS scenes can use `context.Pts` or
  dynamic ESM imports instead.
- Browser aborts dispose resources promptly and invoke cleanup returned by
  asynchronous setup exactly once, even if setup completes after cancellation.
- Source import and scene cleanup failures use the documented CLI exit groups.
- Blank numeric options and empty JSON input filenames are rejected.
- Buffer limits are checked before any output file is committed.
- Rejected HTTP asset responses and aborted streams are canceled; mid-fetch
  cancellation retains the structured abort error.

### Release verification

- Clean-source packing builds distribution files automatically; publishing
  reruns the full release gate. The package is no longer marked private.
- Fresh npm consumers verify published Pts resolution, ESM/CommonJS exports,
  native rendering, the installed executable, and duplicate-instance rejection.
- Coverage thresholds guard the runtime tests, with separate CLI/Chromium
  end-to-end suites. CI runs native tests on Linux, macOS, and Windows with Node
  20, 22, and 24.
- All 26 compatibility cases now use byte-exact Pts 1.0.0 source and image
  fixtures, source/asset hashes, and decoded output assertions. Input is
  supplied to the interactive Bezier demo so a blank output cannot count as
  success.

### Known boundaries

- Editable/pixel legacy Img, Sound, HTMLSpace, SVGSpace, and offscreen browser
  helpers remain outside the supported Node contract.
