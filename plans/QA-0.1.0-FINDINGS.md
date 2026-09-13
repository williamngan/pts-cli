# pts-render 0.1.0 QA findings

Status: every bug and documentation gap below is addressed in 0.1.1 (one commit
per bug, one documentation commit); the two-mounts-in-one-container growth case
is inherent to Pts container measurement and is documented instead.

Date: 2026-09-13. Tested the published npm package (`pts-render@0.1.0`,
`pts@1.0.0`, `skia-canvas@3.0.8`) on Node 24.20 / npm 11.19 / Linux, following
the README and https://cli.ptsjs.org. The checkout gate (`pnpm check`) passes:
14 files, 183 tests, browser, CLI, compatibility, types, pack, and publint all
green.

## What works

- `npx pts-render drawing.mjs`, `npx --yes pts-render@0.1.0 … --json`, global
  `npm install --global pts-render` + `pts-render`, and local
  `npm install pts-render`
  - `node_modules/.bin/pts-render` all render the README examples correctly.
- Site example `interpolate.mjs` renders to PNG/SVG and to a 1200x630 card as
  shown on cli.ptsjs.org.
- All documented CLI options: `--out` (file, trailing-slash dir, `-`, nested
  dirs, repeatable), `--format` (png/jpeg/webp/raw/svg), `--size`,
  `--background`, `--pointer`, `--time`, `--frame/--fps`, `--events`, `--seed`
  (deterministic hashes), `--params/--param`, `--density`, `--quality`,
  `--matte`, `--text-mode`, `--asset-root` (path and URL), `--allow-net`,
  `--font`, `--renderer`, `--timeout`, `--limit`, `--force`, `--json`,
  `--quiet`, `--debug`, `render` alias, `--help`, `--version`.
- Exit codes match the README (2, 3, 4, 5, 6, 124, 130) and JSON error records
  are well-formed; SIGINT reports `RENDER_ABORTED`.
- Output-path protection: existing files, symlinks, directories, duplicate
  canonical paths all rejected.
- Programmatic `renderScene()` (ESM and CommonJS require), the low-level
  `SkiaCanvasSpace` example (PNG density 2, SVG, `toBuffer`, `play()` throws),
  `defineScene`.
- Assets: local image, local TTF and WOFF2 fonts, `data:` URL, HTTP(S) with
  `--allow-net`, URL `--asset-root`, `assetBaseURL` in file, explicit-root
  confinement, 404 reporting, credential/query redaction, idempotent and
  conflicting font registration.
- Scene formats: `.mjs`, `.cjs` (`module.exports`), `.js` in both package types;
  `require("pts")` rejected with `PTS_INSTANCE_MISMATCH`; direct `import "pts"`
  works when the scene resolves the runner's own Pts install.
- Classic loader: `circle.intersectCircle2D.js`, `guide.image_load.js` with
  `--asset-root` (path and URL), ambiguous-source rejection, SVGSpace boundary.
- Browser `mountScene` via an import map and via
  `https://esm.sh/pts-render@0.1.0/browser`: mounts, animates, honours file
  width/height, `dispose()` removes the canvas, unknown scene keys rejected.
- TypeScript consumer types compile under node16, nodenext, and bundler
  resolution when `@types/node` is present; the browser entry compiles with only
  the DOM lib.

## Software bugs

1. **Unhandled EPIPE crash when stdout closes early.** (medium)
   `pts-render x.mjs --out - --format png | node -e 'process.exit(0)'` and the
   same with `--json` print a Node "Unhandled 'error' event … write EPIPE" stack
   trace and exit 1. `writeStdout` in `dist/cli.mjs:472` should attach an error
   handler and exit quietly (or map to a stable code).

2. **Invalid colors are silently accepted.** (medium) `--background notacolor`
   renders as rgb(255,0,51) with exit 0; `--matte notacolor` silently yields
   transparent. skia-canvas's parser falls through. Validate colors at argument
   time (usage error) or at least emit a warning.

3. **`mountScene` `size` option is immediately overridden.** (medium) With the
   default `resize: true`, `size: {width:300,height:150}` is applied and then
   replaced by the container size on the first ResizeObserver tick. Either
   default `resize` to `false` when `size` is given, or document that `size`
   requires `resize: false`.

4. **Canvas height creeps in an unsized container.** (medium, upstream-shaped)
   Mounting into a `<div>` with no explicit height makes the canvas grow a few
   px per ResizeObserver cycle (154 → 170 → 174 → 178 …), with repeated
   "ResizeObserver loop completed with undelivered notifications" errors; with
   two mounts in one container it reached 33,554,432 px. Plain Pts 1.0
   `CanvasSpace` with `resize: true` behaves identically, so the root cause is
   the inline `<canvas>` in Pts (fix upstream with `display:block`), but
   `mountScene` defaults `resize` to `true` and the README's browser example
   does not say the target needs a fixed height.

5. **Missing browser target is not an error.** (low)
   `mountScene(run, { target: "#nope" })` resolves and Pts appends a new
   container to `<body>`. A mount helper should reject an unmatched selector.

6. **Directory target reports the wrong error.** (low) README says a directory
   passed without a trailing slash is "treated as an exact target and rejected",
   but `--out adir` fails with "Cannot infer output format from adir; pass
   --format"; only `--out adir --format png` reaches "Output target is a
   directory". Check the directory case first.

7. **No-argument invocation prints help with exit 0.** (low) `pts-render` alone
   should probably exit 2 like `pts-render a b` does.

## Documentation gaps

1. **npm README is stale.** The README on npmjs.com is an older version: it
   still has "Why skia-canvas", lacks "Quick testing in browser", and orders
   sections differently. Needs a republish (0.1.1) or an npm README refresh.

2. **Typo:** "You can ender a file without installing" → "render" (README,
   Command line section).

3. **Site "ecosystem guide" link is dead-ended.** cli.ptsjs.org "More" section
   links "ecosystem guide" to `github.com/williamngan/pts-render#readme`, but
   the README has no ecosystem section and never mentions Python or React.

4. **`pts-render/scene` and `defineScene` are undocumented** in the README (only
   the CHANGELOG mentions them). Also note that a scene file importing
   `pts-render/scene` fails under `npx`/global installs with "Cannot find
   package 'pts-render'"; only `context.Pts`-style scenes are install-agnostic.

5. **`import "pts"` in scenes practically never works with npx or global
   installs**, since the runner's Pts lives in the npx cache or global prefix.
   The README's `PTS_INSTANCE_MISMATCH` paragraph is accurate but should say
   plainly: with `npx`/global, use `context.Pts`.

6. **Browser section does not explain bare-specifier resolution.** The
   `mountScene` example imports `pts-render/browser` and (transitively) `pts`,
   which needs a bundler, an import map, or a CDN such as
   `https://esm.sh/pts-render@0.1.0/browser` (all verified). Also list the
   `mountScene` options (`size`, `background`, `resize`, `retina`, `bindMouse`,
   `bindTouch`, `autoplay`, `signal`, `onWarning`, `assetBaseURL`) and the
   `{ space, form, warnings, dispose }` return shape.

7. **`--param` value parsing is undocumented.** Values are JSON-parsed when
   possible: `radius=48` → number, `flag=true` → boolean, `obj={"a":1}` →
   object, otherwise string. The README example `Number(params.radius ?? 40)`
   suggests strings.

8. **`--out -` requires `--format`.** The table says `-` writes to stdout but
   not that a format is mandatory; the first attempt fails with a usage error.

9. **JSON result shape is larger than documented.** Real output also has
   `source`, `render`, `random`, `runtime`, `logs`, `durationMs`; failures carry
   `schemaVersion` and `renderId`. `renderScene()` results have no `renderId`
   while CLI JSON does. Worth a note that the example is abridged.

10. **SVG `preserve` text uses the font's internal name.** A scene using
    `assets.font({ family: "Project Sans", … })` emits
    `font-family="DejaVu Serif"` (the file's real name) and `sans-serif` becomes
    `Liberation Sans`. Viewers without those fonts will substitute; mention that
    `outline` is the portable choice.

11. **npm 11 install-scripts warning.** `npm install -g pts-render` now prints
    "skia-canvas@3.0.8 has install scripts not yet covered by allowScripts"; the
    script still runs today, but the README should mention it (and the suggested
    `--allow-scripts=skia-canvas`) before npm starts blocking.

12. **Repo hygiene:** running the README's "From this checkout" command creates
    `pts-output/` inside the repo, which is not in `.gitignore` (`out/` is).
    `pnpm install --frozen-lockfile` from the README aborts in a non-TTY shell
    unless `CI=true` is set; worth a note for agents/CI.

13. **`--help` vs README mismatch, minor:** README's "Exit groups" and the JSON
    contract are not in `--help`; fine, but `--help` says `--format` default
    "for generated output: png" while omitting that `--out -` needs it.

## Repro material

Scratch files used for the runs live under the session scratchpad (`npx-test/`,
`consumer/`, `assets-test/`, `classic/`, `site-test/`), including
`web-importmap.html`, `web-cdn.html`, `web-configured.html`, and
`web-unsized.html` for the browser cases.
