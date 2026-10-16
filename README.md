# PrintPath (working title)

One guided Three.js piece that tells the whole 3D-printing story:
**Design → STL → Slice → Print**. Mobile-first (390×844), desktop builds on the same layout.

Runs fully offline: all code is bundled; no CDN, fonts, analytics or network calls.
The single-file build (`dist-single/printpath.html`) carries a CSP with `connect-src 'none'`.

## Run

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # vitest: slicer + CSG part
npm run build      # tsc + dist/ + dist-single/printpath.html (self-contained, opens from file://)
npx vite preview --port 5191
node tools/shots.mjs   # Playwright screenshots (390x844@3x touch + 1440x900) -> /workspace/printpath-shots
node tools/single-check.mjs  # opens the single HTML from file:// and downloads an STL
node tools/clip.mjs    # frame-captured print clip (encode with ffmpeg)
```

## Steps

1. **Design** – plate (W/D/H sliders, chamfered corners toggle) + optional boss − through hole, via `three-bvh-csg`.
2. **STL** – `STLExporter` (Z-up, as slicers expect). Triangle wireframe, five highlighted facets with normal arrows,
   the ASCII text of the selected facet, triangle count, binary vs ASCII size, local blob download.
3. **Slice** – own slicer (`src/slicer.ts`, pure TS): plane/triangle intersection with normal-oriented segments
   (outer loops CCW, holes CW), chained into contours, 1–2 miter-offset walls, ±45° alternating scanline infill,
   solid bottom/top skins. Layer scrubber uses `drawRange` on one prebuilt geometry. Time is an estimate
   (path length / per-feature speed + layer changes).
4. **Print** – CoreXY-style gizmo (bed drops per layer, head moves XY). The bead is one preallocated
   `InstancedMesh`; playback only changes `count` and rewrites the one partial instance (`addUpdateRange`).
   Ghost part, play/pause, 1–100× speed, layer counter, progress, clipping-plane cut-away, optional Web Audio hum.

## Educator theme, Projects, Favourites

- **Theme switch** (header): *Studio* (dark) | *Educator* (light, ≥16 px type, larger controls, emoji step icons,
  plain-language explainers and a Teacher tip per step, softer 3D palette). CSS variables in `src/style.css`
  + a scene palette in `src/theme.ts`; saved in `localStorage` (`printpath.theme.v1`). `?theme=educator` also works.
  `tests/contrast.test.ts` computes WCAG ratios from the real CSS variables.
- **Projects** (`📚 Projects`): 12 classroom ideas in `src/projects/catalog.ts` (typed), filter by grade
  (K-2/3-5/6-8/9-12) and subject; print times are approximate. Six have a designer preset (*Load in designer*),
  the rest are marked *Idea only*. No external links, no company attributions.
- **Designer presets** (`src/presets.ts`): mounting plate, name keychain (built-in 5×7 block font), cookie cutter
  (circle/star/heart + grip rim), phone stand (wedge), pencil holder (round/hex), spur gear (trapezoid teeth + hub),
  geometric solids. `tests/presets.test.ts` slices every preset at defaults and slider extremes.
- **Favourites** (`src/projects/favourites.ts`): project ids only, `localStorage` key `printpath.favourites.v1`
  (`{"v":1,"ids":[...]}`), newest first; corrupted/missing storage and unknown ids are handled.
- Sync with the box mirror: see `docs/SYNC.md`.

## Simplifications (labelled)

- Walls are miter offsets without self-intersection cleanup (fine for this part family).
- Top skins are detected by a drop in layer area (no per-region skin), no supports/brim/retraction/acceleration.
- Print time is a rough estimate, not a G-code simulation. No G-code export yet.
- Bead is a 6-sided prism per move, not a swept tube.
- Gear teeth are trapezoids, not involutes; keychain letters are a 5×7 pixel font; pointed solids have a 0.6 mm flat tip.

## Reference

Prior art: Kody Wildfeuer's open-source "3D Printer Sim" (learnwithkody) starts from an existing STL;
PrintPath adds the design and STL-anatomy steps in front. No code was copied.
