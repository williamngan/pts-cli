# Compatibility notes

## Release baseline

- CLI: `pts-render@0.1.0` release candidate; executable `pts-render`.
- Pts: published npm `1.0.0`, release source commit
  `034e5f6ac8bcf54d2121ef88799ac43fc4b2c827`.
- Runtime: Node.js 20+, skia-canvas `3.0.8`; unbundled `pts@^1.0.0` peer.
- Development: exact registry Pts version and integrity locked in pnpm.

The prior local `revamp`/unpublished-Git release blockers are resolved. No
neighboring Pts checkout is patched, rebuilt, or needed for verification.
Historical plans retain their original implementation context; the README and
these notes describe the current contract.

## Compatibility matrix

[`compatibility/pts-revamp.json`](../compatibility/pts-revamp.json) retains its
original filename but now describes the released Pts 1.0.0 source. The selected
unchanged demo files, two image assets, and upstream license are vendored under
`test/fixtures/pts-1.0.0`. Demo and asset SHA-256 hashes pin exact upstream
bytes; Git attributes disable text conversion for those fixtures. They are not
shipped in the npm package.

| Status               | Count | Scope                                                                                                    |
| -------------------- | ----: | -------------------------------------------------------------------------------------------------------- |
| supported            |    17 | geometry, color, gradients, text, compositing, Tempo, physics, direct/quickStart spaces, images/patterns |
| supported-with-input |     4 | action, resize, UI, and interactive Bezier timelines                                                     |
| partial              |     1 | editable/pixel Img reaches a named unsupported boundary                                                  |
| not-applicable       |     4 | audio/microphone, HTMLSpace, and SVGSpace                                                                |

`pnpm test:compatibility` runs all 26 cases against the installed npm runtime.
Supported entries produce both PNG and SVG with fixed clock, size, pointer,
seed, assets, events, and expected warnings. It decodes output to verify
dimensions and visible foreground, checks image content in image-demo SVGs, and
verifies that fallback SVG embeds the corresponding complete PNG. Negative cases
invoke unsupported behavior rather than leaving the relevant branch idle. This
is representative semantic coverage, not a claim of pixel-perfect browser
equivalence or support for every upstream demo.

An optional external checkout of the exact release can be supplied as an
argument or through `PTS_COMPAT_ROOT`. Its commit, hashes, and before/after Git
status/diff fingerprints are checked; all output goes to a temporary directory.

## Important behavior

- Node spaces use Pts's backend-neutral Space and a real CanvasForm subclass.
  Resize/start ordering, live bounds, pointer/action ordering, shared style
  caches, and named font-width estimator modes follow Pts 1.0.0.
- One-shot renders run in fresh child processes with hard deadlines and separate
  seeded Pts and JavaScript random streams. Direct literal Pts imports are
  checked for installation and module identity. CommonJS scenes use
  `context.Pts` or `await import("pts")`; `require("pts")` selects a separate
  implementation and is rejected. Arbitrary transitive dependency graphs are not
  inspected; scene authors must avoid introducing another Pts instance.
- SVG normally records vector Canvas commands. A non-`none` Canvas filter
  activates a conservative whole-canvas PNG fallback at density 1 because the
  native SVG encoder otherwise omits filtered content. CLI/API warnings report
  `SVG_RASTER_FALLBACK`; text is also rasterized regardless of text mode.
- Asset roots reject lexical and canonical symlink escapes. Network use is
  opt-in, redirects are policy-checked, byte limits are bounded, canceled or
  rejected bodies are released, and diagnostics redact credentials/query data.
- Output verification and Buffer limits run before any file commit. Each file
  commit is atomic, but a multi-file commit is not a transaction; errors report
  any already committed paths. Symlinks, duplicate canonical destinations,
  directories, and other non-regular targets are rejected, even with `--force`.
- Browser mounting uses real CanvasSpace/Form and a browser-only dependency
  graph. Abort disposes resources promptly and executes late-arriving async
  setup cleanup exactly once.

## Verification and remaining operational gates

`pnpm check` includes formatting, lint, source types, coverage-enforced runtime
tests, Chromium lifecycle/assets/abort tests, CLI subprocess tests, the full
compatibility matrix, strict consumer types, clean-source packing, a fresh npm
consumer install, and package export checks. The fresh consumer uses real
registry/native dependencies instead of symlinking development dependencies.

Coverage includes runtime modules; browser, CLI, and worker process entry points
are exercised separately. HTML/JSON reports are generated in `coverage/`.
Minimums are 82% lines, 80% statements, 85% functions, and 70% branches.

CI configures native tests on Linux, macOS, and Windows with Node 20, 22,
and 24. A local Linux pass does not certify the other hosts: require green
hosted jobs before publication. Confirm npm ownership/version/release notes
before the actual publish. Verification does not publish anything.

## Explicit limits

Editable/pixel legacy Img, browser offscreen helpers, audio, microphone, video,
HTMLSpace, SVGSpace, arbitrary DOM access, and browser timer scheduling remain
outside the Node contract. Classic demos run in a compatibility VM, not a
hostile-code security sandbox. Only render trusted code.

Native deployment and fonts can vary across platforms. Strict GPU mode fails if
Skia falls back; CPU is the default. SVG is Canvas output, not a semantic
SVGSpace graph. Public type fixtures use NodeNext/Node16 with library checking
enabled; the source build retains its existing `skipLibCheck` for upstream
declaration self-check incompatibilities.
