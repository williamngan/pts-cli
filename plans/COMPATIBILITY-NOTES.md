# Compatibility notes

Date: 2026-08-18  
Status: Implemented baseline observations  
Adapter baseline: Pts `revamp`, skia-canvas 3.0.8, Node 24.19.0

The Pts revamp branch is authoritative for this adapter. The npm-published
`pts@0.12.9` implementation is not a supported baseline.

The committed dependency spec follows `github:williamngan/pts#revamp`; the
lockfile currently resolves it to `89205a1d8e736aee340a021f4b201034dde8e0fa`.
The neighboring `/app/pts` checkout was reviewed read-only through
`7a14a7595f061a311026d1e3c6dfeef686ef6c1f`, including two newer local commits
whose relevant change is support for named text-width estimator modes. A
temporary symlink inside this adapter's node_modules enabled a read-only test
pass and was restored afterward. No dependency install, build, or file change
was made in the Pts checkout.

## Observed behavior

### Pts revamp package

- The revamp package imports successfully in Node without a DOM.
- CanvasForm accepts a skia-canvas context at runtime and renders verified
  pixels.
- CanvasForm is generic over `S extends MultiTouchSpace` and returns `S` from
  `space`.
- A non-interactive Node renderer should extend `Space`, not `MultiTouchSpace`.
  The generic constraint is therefore narrower than the renderer extension point
  described by CanvasForm's context constructor.
- CanvasForm exposes the protected `_set` style-cache writer and the static
  `resetStyleCache` invalidation hook. The adapter uses both directly.
- The no-context CanvasForm constructor remains the subclass extension seam.
- The latest inspected revamp adds `"sample"` and `"char"` text-width estimator
  modes. SkiaCanvasForm preserves the selected mode when its font override
  reapplies an estimator. A small per-character fallback gives the locked,
  earlier revamp commit the same `"char"` behavior until the branch update is
  pushed and the lockfile advances.
- Space player storage, bounds, add, remove, and geometry accessors work in
  Node.
- Space play and playItems are not used because their browser scheduling path
  can reference requestAnimationFrame or cancelAnimationFrame.

### Versioning limitation

- The revamp package currently declares version 0.12.9, which is also the
  version of the older npm release.
- A semver peer such as `^0.12.9` cannot prove that a consumer installed the
  revamp implementation. While this package is private, both its peer and
  development requirements use `github:williamngan/pts#revamp` instead.
- The adapter checks the required form/cache hooks at runtime and reports
  `INCOMPATIBLE_PTS` if an older implementation is resolved.
- Before publication, Pts needs a distinct version containing the required
  revamp API, and the adapter's Git peer must become a semver range targeting
  that release.
- Updating the revamp lockfile resolution is treated as a dependency upgrade:
  review the commit delta and run the complete check suite.

### Fonts and text measurement

- Pts Font.value for the default font starts with empty style and weight slots.
- Assigning that value to skia-canvas does not throw, but Skia 3.0.8 ignores it
  and retains its 10px sans-serif default.
- Joining only non-empty style and weight tokens produces a font accepted and
  normalized by Skia.
- SkiaCanvasForm therefore initializes through the context-free CanvasForm
  constructor and owns font assignment.
- Its font-width estimator override records the selected revamp mode and
  reapplies the same mode after every font change.

### Resize and context state

- Assigning Canvas.width and Canvas.height preserves the skia-canvas context
  object identity.
- The assignment resets context styles and font state.
- Existing forms can remain attached to the same context if the shared Pts style
  cache is invalidated and their stored styles are reapplied after resize.

### Exports

- PNG, JPEG, WebP, and raw exports complete asynchronously.
- Raw output defaults to four-byte RGBA order.
- Density changes encoded bitmap dimensions while Canvas width and height stay
  in logical units.
- Adapter exports are separated from frame rendering and do not invoke players.

### Type declarations

- skia-canvas 3.0.8 imports the Sharp type from its declaration entry point even
  though Sharp is an optional runtime integration.
- Importing native Skia types in the adapter's public declaration would force a
  strict consumer to resolve Sharp.
- The adapter exposes a narrow local Canvas handle and the Pts Canvas context
  surface instead. Native types remain internal.
- Built declarations include a DOM reference because Pts declarations contain
  DOM names even on its Node-compatible geometry and Space surface.
- `SkiaCanvasForm` localizes the current Pts generic mismatch to
  `CanvasForm<any>` and overrides `space` as `SkiaCanvasSpace`; consumers do not
  receive an `any` space.
- NodeNext and Node16 fixtures pass with ES2022-only lib and skipLibCheck false.

### Native installation

- pnpm 11 uses allowBuilds for dependency build-script policy.
- The repository explicitly allows skia-canvas and esbuild build scripts.
- skia-canvas fetched its Linux x64 glibc prebuilt binary successfully under
  Node 24.19.0.

## Resulting implementation decisions

1. Compile and test against the Pts revamp branch, with an exact lockfile
   commit.
2. Extend Space, not CanvasSpace or MultiTouchSpace.
3. Own deterministic player traversal instead of calling Space.playItems.
4. Initialize CanvasForm through `super()` without a context.
5. Narrow both `form.space` and `form.skiaSpace` to SkiaCanvasSpace.
6. Use revamp's protected style setter and static cache invalidation directly.
7. Preserve named font-width estimator modes in the normalized-font override.
8. Preserve context identity across resize and reset each retained form.
9. Keep native skia-canvas types out of public declarations.
10. Block adapter-managed mutation while asynchronous exports are pending.
11. Keep SVG and PDF outside the raster format API.
12. Keep the adapter private until its Pts peer requirement is expressible.
13. Fail early and clearly if package resolution supplies the older 0.12.9 API.
