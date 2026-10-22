# @oceanmetrics/map 0.2.0 against real MapLibre: the consumer checklist

Build week 2, step 2a (2026-10-23). The six points of `packages/map/README.md` ("What a consumer verifies in step 2")
run on a Vite 8 page that wires the package the way an app will (`src/main.ts`), against `maplibre-gl` 6.13.0 and
`pmtiles` 4.5.0 as an app installs them, CARTO's live positron and dark-matter styles, and the package linked as
`file:../../packages/map` after `npm run build`. Playwright 1.64 drives the system Chrome (`channel: 'chrome'`,
headless, Chrome 156.0.8078.47) at 1280×800 and 390×844, DPR 1 (`scripts/run.mjs`; raw numbers in `run.json`, the
generated table in `table.md`). Static files and the data come from `scripts/serve.mjs` with HTTP Range.

**Result: 48 of 48 checks pass with the package at 0.2.1 (unreleased, commit `92c9288`). On 0.2.0, three checks
failed; they were package bugs, fixed in that commit with a named regression test each (see "Bugs fixed").**

## The six points

| point | pass/fail | the number | shot |
|---|---|---|---|
| 1. setup, a vector feature, h3 from the worker | pass (0.2.0 and 0.2.1) | the app's part fill pixel 230,0,126 = `#e6007e`; main-thread protocols `[pmtiles, cog]`, no `h3j`; 357 hexagons drawn at Fiji; `es5.pmtiles` reads 13 in the worker, 2 on the page (h3Slot's header and metadata read); `h3Worker-<hash>.mjs` requested by the worker | [p1-h3-worker-fiji-1280](../shots/p1-h3-worker-fiji-1280.jpg), [390](../shots/p1-h3-worker-fiji-390.jpg) |
| 2. composeStyle on CARTO, tiers 404, the stack, the theme flip | **fail on 0.2.0** (ocean painted over the data; the flip drops the slot); pass on 0.2.1 | 112 layers, `background < water < gebco-far-relief < gebco-relief < gebco-contour-3 < land < water-inland < landcover <` CARTO's first label; 5 tier fetches fail, base and land draw (sea pixel 212,218,220 = CARTO water `#d4dadc`); flip to dark with `transformStyle: carrySlots`: `slot:grid:fill` before and after, still under `land`, cell pixel 253,231,37 both themes; diff alone: slot gone | [p2-flip-dark-carrySlots-1280](../shots/p2-flip-dark-carrySlots-1280.jpg), [390](../shots/p2-flip-dark-carrySlots-390.jpg), [before: ocean over the data](../shots/bug1-water-inland-before.jpg), [before: flip drops the slot](../shots/bug2-flip-drops-slot-before.jpg) |
| 3. gridSlot: lattice, holes, update(t), ±180 | pass | 921/925 points (99.6 %) on 185 cells at their ramp stop (4 misses, all on coastal cells, where CARTO draws labels and lines above the slot); 19/19 holes = the unmounted pixel; `update(t)`: 91 frames, 0 mixed or blank, all at t2 from frame 4, screenshots 50 ms apart identical; PMNM lattice across ±180: 18/18 seam cells in place, 0 gap rows | [p3-grid-gulf-t1-1280](../shots/p3-grid-gulf-t1-1280.jpg), [t2](../shots/p3-grid-gulf-t2-1280.jpg), [pmnm](../shots/p3-grid-pmnm-180-1280.jpg), [390](../shots/p3-grid-gulf-t1-390.jpg) |
| 4. cogSlot on a real 3857 COG | pass | AquaMaps native (spike 3's 3857 copy): inside the range (-18.81, 48.11, value 100) 253,231,37 = viridis at 100; outside (nodata 0) = basemap; two-band synthetic with `atlas:bidx` 2: 4/4 stripes on band 2's colour (band 1 would paint 72,37,118), nodata 255 transparent; the 4326 asset refused: `CogProjectionError: cog asset "am4326" is EPSG:4326, not EPSG:3857 ...`; the protocol chunk requested 2 ms after the first mount, never before | [p4-cog-am-native-1280](../shots/p4-cog-am-native-1280.jpg), [bidx 2](../shots/p4-cog-two-band-bidx2-1280.jpg), [390](../shots/p4-cog-am-native-390.jpg) |
| 5. h3Slot: archive and in-memory, ±180, RES_FOR_ZOOM, frame time | **fail on 0.2.0** for a relative archive url (0 hexagons, worker 404s); pass on 0.2.1 | Fiji and PMNM centred on 180°, both forms: 0 gap rows (74 and 33 rows with one hexagon across the seam at 1280); zoom 1 draws only res 1 (862 archive / 125 memory), zoom 7 only res 5 (212); p95 frame time over the 5 s Fiji pan 16.7 to 16.8 ms (archive and memory, both widths; display interval 16.7 ms) | [p5-h3-archive-fiji-1280](../shots/p5-h3-archive-fiji-1280.jpg), [pmnm](../shots/p5-h3-archive-pmnm-1280.jpg), [memory](../shots/p5-h3-memory-fiji-1280.jpg), [z7](../shots/p5-h3-archive-z7-1280.jpg), [390](../shots/p5-h3-archive-fiji-390.jpg), [before: relative url](../shots/bug3-relative-archive-before.jpg) |
| 6. the bundle | pass | eager gzip over the base: grid +3 559 B, cogSlot +3 410 B, h3 +3 365 B, all three +5 817 B; the COG protocol 112 613 B on demand; `h3Worker.mjs` 76 400 B | (numbers: [bundle.json](bundle.json)) |

## Every check

| point | width | check | pass | number | shot |
|---|--:|---|---|---|---|
| 1 | 1280 | vector part renders after setupMapLibre (GeoJSON parsed in the worker) | pass | pixel 230,0,126 vs 230,0,126; CARTO water features drawn 7 | [p1-setup-part-1280.jpg](../shots/p1-setup-part-1280.jpg) |
| 1 | 1280 | h3 tiles from the worker: no h3j protocol on the main thread, archive reads in the worker | pass | main-thread protocols [pmtiles,cog]; 357 hexagons drawn; es5.pmtiles requests page 2 / worker 13; h3Worker module requested by worker | [p1-h3-worker-fiji-1280.jpg](../shots/p1-h3-worker-fiji-1280.jpg) |
| 1 | 390 | vector part renders after setupMapLibre (GeoJSON parsed in the worker) | pass | pixel 230,0,126 vs 230,0,126; CARTO water features drawn 8 | [p1-setup-part-390.jpg](../shots/p1-setup-part-390.jpg) |
| 1 | 390 | h3 tiles from the worker: no h3j protocol on the main thread, archive reads in the worker | pass | main-thread protocols [pmtiles,cog]; 168 hexagons drawn; es5.pmtiles requests page 2 / worker 7; h3Worker module requested by worker | [p1-h3-worker-fiji-390.jpg](../shots/p1-h3-worker-fiji-390.jpg) |
| 2 | 1280 | `load` with the composed style at construction and every tier failing (MapLibre schedules no frame on a failed source) | pass | load without a repaint nudge in 0 of 4 boots (6290, 6296, 6291, 6279 ms); the README flow (boot dem: false, setStyle on load) never stalled | - |
| 2 | 1280 | positron composed, tiers 404: base and land layers draw, stack order | pass | 112 layers; background < water < gebco-far-relief < gebco-relief < gebco-contour-3 < land < water-inland < landcover < first symbol: true; CARTO features drawn 7; sea pixel 212,218,220 (water #d4dadc); 5 tier errors | [p2-positron-tiers-404-1280.jpg](../shots/p2-positron-tiers-404-1280.jpg) |
| 2 | 1280 | theme flip setStyle(composeStyle(dark), { diff: true, transformStyle: carrySlots }) keeps the slot; the slot under the land mask shows over the open sea (water-inland fix) | pass | slot ids before [slot:grid:fill] after [slot:grid:fill], under land; cell pixel light 253,231,37 dark 253,231,37 (expected 253,231,37); basemap ids the same set across themes: true (order differs: true) | [p2-flip-dark-carrySlots-1280.jpg](../shots/p2-flip-dark-carrySlots-1280.jpg) |
| 2 | 1280 | regression evidence: the 0.2.0 README flip (diff alone) drops the slot | pass | diff alone: slot ids before [slot:grid:fill] after [] (MapLibre's diff removes every layer the next style does not name) | [p2-flip-light-diff-only-1280.jpg](../shots/p2-flip-light-diff-only-1280.jpg) |
| 2 | 390 | positron composed, tiers 404: base and land layers draw, stack order | pass | 112 layers; background < water < gebco-far-relief < gebco-relief < gebco-contour-3 < land < water-inland < landcover < first symbol: true; CARTO features drawn 8; sea pixel 212,218,220 (water #d4dadc); 5 tier errors | [p2-positron-tiers-404-390.jpg](../shots/p2-positron-tiers-404-390.jpg) |
| 2 | 390 | theme flip setStyle(composeStyle(dark), { diff: true, transformStyle: carrySlots }) keeps the slot; the slot under the land mask shows over the open sea (water-inland fix) | pass | slot ids before [slot:grid:fill] after [slot:grid:fill], under land; cell pixel light 253,231,37 dark 253,231,37 (expected 253,231,37); basemap ids the same set across themes: true (order differs: true) | [p2-flip-dark-carrySlots-390.jpg](../shots/p2-flip-dark-carrySlots-390.jpg) |
| 2 | 390 | regression evidence: the 0.2.0 README flip (diff alone) drops the slot | pass | diff alone: slot ids before [slot:grid:fill] after [] (MapLibre's diff removes every layer the next style does not name) | [p2-flip-light-diff-only-390.jpg](../shots/p2-flip-light-diff-only-390.jpg) |
| 3 | 1280 | squares on the lattice: cell centre and ±0.35° inside each cell = the ramp stop of its value | pass | 921/925 points (99.6%) on 185 cells; misses: -88.5,18.5#0 212,206,213≠49,104,141; -81.5,19.5#0 139,192,166≠56,183,119; -81.5,23.5#2 182,219,142≠144,214,67; -81.5,25.5#4 119,154,178≠49,104,141 | [p3-grid-gulf-t1-1280.jpg](../shots/p3-grid-gulf-t1-1280.jpg) |
| 3 | 1280 | holes transparent: a null cell shows the basemap pixel underneath | pass | 19/19 hole centres equal the unmounted pixel | [p3-grid-gulf-t1-1280.jpg](../shots/p3-grid-gulf-t1-1280.jpg) |
| 3 | 1280 | update(t) without a flash: every frame t1 or t2 at 8 cells, then two screenshots 50 ms apart identical | pass | 91 frames sampled, 0 mixed or blank, all-t2 from frame 4; screenshots identical: true | [p3-grid-gulf-t2-1280.jpg](../shots/p3-grid-gulf-t2-1280.jpg) |
| 3 | 1280 | grid across ±180 (PMNM lattice 170.5°E..170.5°W): cells either side of the seam in place, no gap | pass | 18/18 cells at 179.5°E/179.5°W (read at 180.5°) on their colour; seam column: 278/292 rows coloured, 0 gap rows | [p3-grid-pmnm-180-1280.jpg](../shots/p3-grid-pmnm-180-1280.jpg) |
| 3 | 390 | squares on the lattice: cell centre and ±0.35° inside each cell = the ramp stop of its value | pass | 919/925 points (99.4%) on 185 cells; misses: -88.5,18.5#0 153,172,189≠49,104,141; -87.5,18.5#1 160,196,195≠33,144,140; -81.5,22.5#3 42,149,145≠33,144,140; -81.5,22.5#4 124,182,180≠33,144,140; -81.5,23.5#1 176,207,146≠144,214,67; -81.5,23.5#2 182,220,141≠144,214,67 | [p3-grid-gulf-t1-390.jpg](../shots/p3-grid-gulf-t1-390.jpg) |
| 3 | 390 | holes transparent: a null cell shows the basemap pixel underneath | pass | 19/19 hole centres equal the unmounted pixel | [p3-grid-gulf-t1-390.jpg](../shots/p3-grid-gulf-t1-390.jpg) |
| 3 | 390 | update(t) without a flash: every frame t1 or t2 at 8 cells, then two screenshots 50 ms apart identical | pass | 91 frames sampled, 0 mixed or blank, all-t2 from frame 4; screenshots identical: true | [p3-grid-gulf-t2-390.jpg](../shots/p3-grid-gulf-t2-390.jpg) |
| 3 | 390 | grid across ±180 (PMNM lattice 170.5°E..170.5°W): cells either side of the seam in place, no gap | pass | 18/18 cells at 179.5°E/179.5°W (read at 180.5°) on their colour; seam column: 139/146 rows coloured, 0 gap rows | [p3-grid-pmnm-180-390.jpg](../shots/p3-grid-pmnm-180-390.jpg) |
| 4 | 1280 | COG (AquaMaps native, 3857 copy) in place: inside the range coloured, outside transparent | pass | inside -18.81,48.11 (value 100) 253,231,37 vs ramp 253,231,37; outside 85.96,60.5 (nodata) 250,250,248 = basemap 250,250,248; legend 81.235 mean from STAC | [p4-cog-am-native-1280.jpg](../shots/p4-cog-am-native-1280.jpg) |
| 4 | 1280 | COG protocol lazy: its chunk arrives on the first cog:// request, not at setup | pass | cog protocol chunk requests before mount 0, after 1 (esm-h_GWLP_A.js, at +2 ms after mount) | [p4-cog-am-native-1280.jpg](../shots/p4-cog-am-native-1280.jpg) |
| 4 | 1280 | atlas:bidx 2 draws band 2 (four stripes 0/33/66/100), not band 1 (10 everywhere); nodata 255 transparent | pass | 4/4 stripes on band 2's colour (-135°: 68,1,84 vs 68,1,84; -45°: 50,103,141 vs 50,103,141; 45°: 54,182,121 vs 54,182,121; 135°: 253,231,37 vs 253,231,37); band 1 would paint 72,37,118; nodata rows at 70°S = basemap: true | [p4-cog-two-band-bidx2-1280.jpg](../shots/p4-cog-two-band-bidx2-1280.jpg) |
| 4 | 1280 | a 4326 asset is refused with CogProjectionError naming the asset | pass | CogProjectionError: cog asset "am4326" is EPSG:4326, not EPSG:3857: the cog protocol would draw it in the wrong place; draw its EPSG:3857 copy | - |
| 4 | 390 | COG (AquaMaps native, 3857 copy) in place: inside the range coloured, outside transparent | pass | inside -18.81,48.11 (value 100) 253,231,37 vs ramp 253,231,37; outside 85.96,60.5 (nodata) 250,250,248 = basemap 250,250,248; legend 81.235 mean from STAC | [p4-cog-am-native-390.jpg](../shots/p4-cog-am-native-390.jpg) |
| 4 | 390 | COG protocol lazy: its chunk arrives on the first cog:// request, not at setup | pass | cog protocol chunk requests before mount 0, after 1 (esm-h_GWLP_A.js, at +2 ms after mount) | [p4-cog-am-native-390.jpg](../shots/p4-cog-am-native-390.jpg) |
| 4 | 390 | atlas:bidx 2 draws band 2 (four stripes 0/33/66/100), not band 1 (10 everywhere); nodata 255 transparent | pass | 2/2 stripes on band 2's colour (-45°: 50,103,141 vs 50,103,141; 45°: 54,182,121 vs 54,182,121); band 1 would paint 72,37,118; nodata rows at 70°S = basemap: true | [p4-cog-two-band-bidx2-390.jpg](../shots/p4-cog-two-band-bidx2-390.jpg) |
| 4 | 390 | a 4326 asset is refused with CogProjectionError naming the asset | pass | CogProjectionError: cog asset "am4326" is EPSG:4326, not EPSG:3857: the cog protocol would draw it in the wrong place; draw its EPSG:3857 copy | - |
| 5 | 1280 | h3 archive at fiji, centred on ±180: no gap at the seam | pass | 357 hexagons; seam column 114/381 rows coloured, 74 rows with one hexagon across the seam, 0 gap rows | [p5-h3-archive-fiji-1280.jpg](../shots/p5-h3-archive-fiji-1280.jpg) |
| 5 | 1280 | h3 archive at pmnm, centred on ±180: no gap at the seam | pass | 112 hexagons; seam column 45/393 rows coloured, 33 rows with one hexagon across the seam, 0 gap rows | [p5-h3-archive-pmnm-1280.jpg](../shots/p5-h3-archive-pmnm-1280.jpg) |
| 5 | 1280 | RES_FOR_ZOOM (archive): zoom 1 draws res 1, zoom 7 res 5 | pass | z1: {"1":862} (tile z1); z7: {"5":212} | [p5-h3-archive-z7-1280.jpg](../shots/p5-h3-archive-z7-1280.jpg) |
| 5 | 1280 | h3 memory at fiji, centred on ±180: no gap at the seam | pass | 357 hexagons; seam column 114/381 rows coloured, 74 rows with one hexagon across the seam, 0 gap rows | [p5-h3-memory-fiji-1280.jpg](../shots/p5-h3-memory-fiji-1280.jpg) |
| 5 | 1280 | h3 memory at pmnm, centred on ±180: no gap at the seam | pass | 112 hexagons; seam column 45/393 rows coloured, 33 rows with one hexagon across the seam, 0 gap rows | [p5-h3-memory-pmnm-1280.jpg](../shots/p5-h3-memory-pmnm-1280.jpg) |
| 5 | 1280 | RES_FOR_ZOOM (memory): zoom 1 draws res 1, zoom 7 res 5 | pass | z1: {"1":125} (tile z1); z7: {"5":212} | [p5-h3-memory-z7-1280.jpg](../shots/p5-h3-memory-z7-1280.jpg) |
| 5 | 1280 | h3 relative at fiji, centred on ±180: no gap at the seam | pass | 357 hexagons; seam column 114/381 rows coloured, 74 rows with one hexagon across the seam, 0 gap rows | [p5-h3-relative-fiji-1280.jpg](../shots/p5-h3-relative-fiji-1280.jpg) |
| 5 | 1280 | frame time p95 during a 5 s pan at Fiji (archive) | pass | p95 16.8 ms, mean 16.67, max 16.8, 302 frames (display interval 16.7 ms) | - |
| 5 | 1280 | frame time p95 during a 5 s pan at Fiji (memory) | pass | p95 16.8 ms, mean 16.67, max 16.8, 302 frames (display interval 16.7 ms) | - |
| 5 | 390 | h3 archive at fiji, centred on ±180: no gap at the seam | pass | 168 hexagons; seam column 102/191 rows coloured, 91 rows with one hexagon across the seam, 0 gap rows | [p5-h3-archive-fiji-390.jpg](../shots/p5-h3-archive-fiji-390.jpg) |
| 5 | 390 | h3 archive at pmnm, centred on ±180: no gap at the seam | pass | 71 hexagons; seam column 93/196 rows coloured, 90 rows with one hexagon across the seam, 0 gap rows | [p5-h3-archive-pmnm-390.jpg](../shots/p5-h3-archive-pmnm-390.jpg) |
| 5 | 390 | RES_FOR_ZOOM (archive): zoom 1 draws res 1, zoom 7 res 5 | pass | z1: {"1":355} (tile z1); z7: {"5":115} | [p5-h3-archive-z7-390.jpg](../shots/p5-h3-archive-z7-390.jpg) |
| 5 | 390 | h3 memory at fiji, centred on ±180: no gap at the seam | pass | 168 hexagons; seam column 102/191 rows coloured, 91 rows with one hexagon across the seam, 0 gap rows | [p5-h3-memory-fiji-390.jpg](../shots/p5-h3-memory-fiji-390.jpg) |
| 5 | 390 | h3 memory at pmnm, centred on ±180: no gap at the seam | pass | 67 hexagons; seam column 93/196 rows coloured, 90 rows with one hexagon across the seam, 0 gap rows | [p5-h3-memory-pmnm-390.jpg](../shots/p5-h3-memory-pmnm-390.jpg) |
| 5 | 390 | RES_FOR_ZOOM (memory): zoom 1 draws res 1, zoom 7 res 5 | pass | z1: {"1":125} (tile z1); z7: {"5":115} | [p5-h3-memory-z7-390.jpg](../shots/p5-h3-memory-z7-390.jpg) |
| 5 | 390 | h3 relative at fiji, centred on ±180: no gap at the seam | pass | 168 hexagons; seam column 102/191 rows coloured, 91 rows with one hexagon across the seam, 0 gap rows | [p5-h3-relative-fiji-390.jpg](../shots/p5-h3-relative-fiji-390.jpg) |
| 5 | 390 | frame time p95 during a 5 s pan at Fiji (archive) | pass | p95 16.7 ms, mean 16.67, max 16.8, 302 frames (display interval 16.7 ms) | - |
| 5 | 390 | frame time p95 during a 5 s pan at Fiji (memory) | pass | p95 16.7 ms, mean 16.67, max 16.8, 302 frames (display interval 16.7 ms) | - |
| 6 | - | eager gzip per provider over base (expected about 4 kB) | pass | grid +3559 B, cogSlot +3410 B (+21606 B with pointValue and overviewHistogram: geotiff's core), h3 +3365 B; all three +5817 B; base +5061 B over maplibre-gl and pmtiles | - |
| 6 | - | the COG protocol lazy, the h3 worker chunk about 76 kB | pass | cog protocol on demand 112613 B; h3Worker.mjs 76400 B; maplibre-gl-worker.mjs 143630 B | - |
| 6 | - | the README snippet passes the namespace object (keeps every maplibre-gl export) | pass | +11480 B gzip over named imports | - |

## Bugs fixed (commit `92c9288`, packages/map 0.2.1 unreleased)

1. **The land mask repainted the whole ocean over the data.** CARTO's styles now read the protomaps schema (source
   `protomaps`, water polygons with `kind`: ocean, sea, lake, no `class`). `composeStyle`'s `water-inland` (CARTO's
   water again, over the mask, for lakes and rivers) filtered `['!=', 'class', 'ocean']`, which every protomaps polygon
   passes, so any slot under `land` (the atlas case: no app parts) was hidden at sea and showed only on land
   ([before](../shots/bug1-water-inland-before.jpg), [hexagons before](../shots/bug1-water-inland-before-h3-fiji.jpg),
   [after](../shots/p2-slot-light-1280.jpg)). The filter is now `kind` or `class` not in `OPEN_WATER` (ocean, sea).
   Test: `basemap.test.ts` "regression: water-inland on CARTO's protomaps tiles".
2. **A theme flip dropped the slot.** `setStyle(composeStyle(dark), { diff: true })` (the README's flow) diffs against
   a style that names only the basemap, so MapLibre removed `slot:grid:fill` and its source
   ([before](../shots/bug2-flip-drops-slot-before.jpg)). New `carrySlots` / `carryLayers(keep)`: the `transformStyle`
   that carries the kept layers and their sources into the next style, each under the layer it sat under. Test:
   `slot.test.ts` "regression: carryLayers keeps the slot across setStyle".
3. **A relative h3 archive url 404ed in the worker.** `h3Slot({ url: './data/es5.pmtiles' })` read the header on the
   page, then the worker resolved the url against its own script (`/assets/`): 0 hexagons
   ([before](../shots/bug3-relative-archive-before.jpg), [after](../shots/p5-h3-relative-fiji-1280.jpg)).
   `h3TileUrl(url, base?)` and `h3Slot` now make it absolute against the page (`absoluteArchiveUrl`). Test: `h3.test.ts`
   "regression: a relative archive url reaches the worker absolute".

Gates after the fix: `npm test` 763 passed, `npm run typecheck`, `npm run build`, `npm run size` (map 27 203 B, budget
39 000 B).

## The indicators gap: `clear()` and CARTO's ids

indicators' `clearsLayer` keeps the layers whose id starts with `base-`. No layer of a `composeStyle` basemap does
(CARTO's ids are `background`, `water`, `landcover`, ...; the package's are `gebco-*`, `land`, `water-inland`), so on
the new basemap `clear()` would remove the whole style. The rule: take `basemapLayerIds(style)` (new in 0.2.1: the
layer ids of the composed style, the same set in both themes, though CARTO orders positron and dark-matter
differently) when the style is set; `clear()` removes `id => !basemap.has(id)`; a click tests
`id => !isSlotLayer(id) && !basemap.has(id)`; the flip keeps the parts with `carryLayers((id) => !basemap.has(id))`.
On the live page with a slot and one part this clears `[slot:grid:fill, p0:fill, p0:line]` and hits
`[p0:fill, p0:line]` (unit test `basemap.test.ts` "basemapLayerIds: the rule an app's clear() keys on").
`clearsLayer` stays exported until indicators moves (its doc now says so).

## Other findings (not package bugs, or open)

- **`load` stalls when the composed style boots with failing tiers.** MapLibre fires `load` (and `idle`) from a render,
  and schedules no frame when a source fails: with the composed style given to the constructor and every tier
  unreachable, `load` had not fired after 6 s in 4 of 4 boots, and fired on the first `triggerRepaint()`. The README's
  flow (boot on `dem: false`, `setStyle(composeStyle(...))` on `load`) never stalled; the README now says to boot that
  way. `DEFAULT_TILES.names` points at an archive with no build date yet ("not yet" in the README); worth `null` until
  it exists, so one missing tier cannot stall an app that boots composed.
- **The README's setup snippet costs 11.5 kB gzip.** `setupMapLibre({ maplibre })` with `import * as maplibre` passes
  the namespace object, which keeps every export of `maplibre-gl`: +11 480 B over passing
  `{ addProtocol, importScriptInWorkers, setWorkerUrl }`. README and the `maplibre.ts` doc now show the named form.
- **The island labels draw nothing on CARTO's tiles (open).** `composeStyle` adds `place_island*` on OpenMapTiles'
  `place` layer (class `island`); the protomaps tiles carry islands as `earth` polygons of kind `island` with a name
  (the Channel Islands at z9: 5 features), and no `place` layer. Harmless (two empty layers) but the feature is gone;
  the port needs an `earth`/`kind` branch and a look at the placement, a design call.
- **CARTO's two styles order their layers differently** (`waterway_label` sits in another place), so a flip is a
  diff with moves; ids are the same set.
- **h3 archives need the producer's roll-up.** `buildH3jArchive` takes the coarsest table it is given for zooms under
  its resolution; with one res-5 table z1 would carry res-5 cells. `scripts/build-data.mjs` passes `rollUp` to res 1-4
  plus the res-5 table (1.23 MB, 3 325 tiles, z0-6), and z1 then draws only res 1. The README says "one table and
  `rollUp`"; worth stating that the producer calls `rollUp`.
- **A `file:` link needs `resolve.dedupe` and a TS `paths` entry.** Linked from the platform checkout, the package's own
  imports resolve from `platform/node_modules`: Vite would bundle a second `pmtiles` without
  `resolve.dedupe: ['pmtiles', 'maplibre-gl']`, and `tsc` sees two `maplibre-gl` type trees (the platform's 6.15 dev
  copy against the app's 6.13: `Map` not assignable) without `paths: { "maplibre-gl": ["./node_modules/maplibre-gl"] }`.
  A published install has one copy (peer dependencies); apps on `file:` until Day 5 need both (this page's
  `vite.config.ts`, `tsconfig.json`).
- `update(t)` showed no flash even though `gridSlot` sets the paint after `setData` (the new range applies to the old
  tiles for a moment in principle): 0 mixed frames in 91 at both widths. Kept as measured, not changed.

## Bundle (Vite 8 build, minified, gzip -9; `scripts/bundle.mjs`, each entry built as its own app)

| entry | eager JS | over |
|---|--:|---|
| `maplibre-gl` alone (`size-zero`) | 273 771 B | |
| + the pmtiles protocol (`size-pmtiles`) | 280 885 B | +7 114 B |
| base: setupMapLibre, composeStyle, the codec, carrySlots, named imports (`size-base`) | 285 946 B | +5 061 B over pmtiles |
| base as the 0.2.0 README wrote it, the namespace object (`size-ns`) | 297 426 B | +11 480 B over the base |
| + gridSlot | 289 505 B | +3 559 B |
| + cogSlot | 289 356 B | +3 410 B |
| + cogSlot, pointValue, overviewHistogram (geotiff's core) | 307 552 B | +21 606 B |
| + h3Slot | 289 311 B | +3 365 B |
| + all three slots | 291 763 B | +5 817 B |

On demand: the COG protocol 112 613 B (126 726 B when nothing else loaded geotiff), requested on the first `cog://`
(point 4); the h3 tile builder (`h3Tiles`, 70 357 B) only for an in-memory table. Workers: `h3Worker.mjs` 76 400 B
(the README's 76.4 kB), `maplibre-gl-worker.mjs` 143 630 B. With one `cog://` the protocol is the biggest piece an
app fetches; the providers' eager cost is what the README expected (about 4 kB each).

## What could not run

- **The land mask covering the coast**: needs the OSM land tier (`osm/land.pmtiles`), not uploaded (the tiers are built
  in parallel tonight); every tier 404s or fails CORS here, so points 2 and 3 check the base, the stack and the slots
  with the mask layer present but empty. CalCOFI's California tiers were not tried.
- **Dark theme beyond the flip**: points 3-5 ran on positron; dark-matter ran in point 2's flip (slot kept, cell colour
  unchanged, [shot](../shots/p2-flip-dark-carrySlots-1280.jpg)).
- **The indicators Map and the atlas themselves**: this is the package in a stand-in app; the README's list stays the
  check for those two apps when they are wired.
- The seam-gap measure was not given a negative control (a page with a deliberate gap); it is a pixel rule (one colour
  both sides of 180°, another on it) and passed with 33 to 91 rows straddling the seam per view.

## Reproduce

```sh
cd platform && npm run build                    # the package's dist/
cd spikes/map-consumer && npm install
node scripts/build-data.mjs                     # data/es5.pmtiles, data/cells-pacific.json (obis-h3 res-5 all)
uv run --with rasterio --with numpy python scripts/make_cogs.py <spike 3's 3857 dir>   # data/cogs/
npx vite build && node scripts/bundle.mjs && node scripts/run.mjs
```
