# @oceanmetrics/map

The map stack of the Ocean Metrics apps: MapLibre 6 setup, the bathymetric basemap, colour ramps, and one layer slot
contract with three providers (a grid slice, a Cloud-Optimized GeoTIFF, H3 hexagons). Apps (indicators, atlas,
obis-hex, erddap-places) import it and draw their own places on top.

Version 0.2.0 (build week 2, step 1). 0.1.0 was the scaffold published on Day 5. 0.2.1 (unreleased) holds the fixes
of the consumer check (step 2a, `spikes/map-consumer`, `results/checklist.md`). 0.2.2 (unreleased) holds the fixes of the
first two consumers (the indicators Map and the atlas): see the three notes below and the CHANGELOG.

## The contract

### Slots

A **slot** is one data layer under an app's places, at the period `t` the app's URL shares with every view
(`src/slot.ts`, moved in from indicators `viewer/src/lib/map/layerSlot.ts`):

```ts
interface LayerSlot {
  id: string; kind: 'grid' | 'cog' | 'h3'; title: string; credit?: string
  mount(map, beforeId: string | null, t: string | null): void   // adds sources and layers, ids prefixed `slot:`
  update(t: string | null): void
  unmount(map): void
  legend(): LegendSpec | null    // title, t, via, problem, units, ramp | classes, histogram, stats
}
```

- The URL key is `layer=<kind>:<id>[:<variable>]` (`parseLayerKey`, `formatLayerKey`). `erddap:` (indicators' Day 6
  links) still parses, as a deprecated alias of `grid:`, and is written back as `grid:`.
- `registerSlotKind(kind, factory)` and `slotFor(spec)`: the app registers a factory per kind (it knows where the data
  comes from); `slotFor` throws at once for a kind nothing registered.
- `slotBeforeId(drawnLayerIds, { under?, fallback? })`: the slot goes under the first vector part's fill
  (`p<i>:fill`, or the app's own `under` rule), else under the first drawn layer, else under `fallback`. Pass
  `seaSurfaceId(style)` as `fallback`, so the data stays under the land mask and the labels.
- Across a style change: `carrySlots` (or `carryLayers(keep)`) is the `transformStyle` of `setStyle`. MapLibre's diff
  removes every layer the next style does not name, and `composeStyle` names only the basemap's, so a theme flip without
  it drops the slot (measured: `slot:grid:fill` before, gone after).
- What is the basemap's: `basemapLayerIds(style)` of the composed style. An app's `clear()` removes the layers not in it,
  a click tests those that are neither in it nor `isSlotLayer`. indicators' `clearsLayer` (`!id.startsWith('base-')`)
  matches none of CARTO's ids and would clear the whole basemap; it stays exported until indicators moves to the rule
  (`carryLayers((id) => !basemap.has(id))` keeps its parts across the flip as well).

### Providers

Each provider is one module: a slot factory plus the pure functions it rests on.

| kind | factory | what the app gives it | rules kept (tested) |
|---|---|---|---|
| `grid` (`grid.ts`) | `gridSlot(spec, source, opts)` | a `SliceSource`: `slice(t) → [{ lat, lon, value, weight }]`, the rows of `last_step.sql` (the engine's SQL in DuckDB-WASM, build week 2 step 2) | one square per cell from the axis step (`cellSquares`, erddap-places); a cell without data is a hole; across ±180 the cells go into [0, 360); a ramp fill (`rampStops`) or a class `match`; the squares' outline (12% black) only on grids coarser than 0.05° (the finer of the two axis steps), since at 0.01° it draws a mesh over the data: `outline: string \| null` overrides (a colour, or `null` for none), `gridOutline(spacing, outline)` is the rule (0.2.2) |
| `cog` (`cog.ts`) | `cogSlot(spec, asset, opts)` | the 3857 data asset of a `cog` STAC item (`pickCogAssets(item)`) | spike 3: refuse anything without `proj:code` EPSG:3857 (`CogProjectionError` names the asset); the legend from STAC `statistics` and `histogram` only (`legendFromStac`); `overviewHistogram` gives a shape, never numbers; `pointValue` reads the 4326 original; colour from `atlas:colormap` and `atlas:rescale`; nodata transparent. **Bands of one file** (items whose assets share an href and differ in `atlas:bidx`): the protocol's `#color:` grammar has no band key and it caches colour functions, readers and tiles by the href before the `#`, so `cogUrl` adds `b=<bidx>` to the href's query (`cogHref`; the file's server ignores it) and `cogSlot` selects the band in its colour function under that same key (0.2.2); no workaround in the app |
| `h3` (`h3.ts`, `h3Tiles.ts`, `h3Index.ts`) | `h3Slot(spec, archive, opts)` | `{ url }` of a PMTiles archive of h3j tiles (written by `buildH3jArchive`), or `{ cells }` in memory (small tables only) | spike 1: the protocol in MapLibre's worker; geojson-vt `tolerance: 0`; the resolution stepped with zoom (`RES_FOR_ZOOM`, obis-hex's zoom_to_res); the PR 211 antimeridian unwrap and the ±180 strip, tested on the 55 crossing cells of obis-h3's ES(50) |

Producers write h3 archives with `buildH3jArchive({ levels, maxzoom, metadata, gzip })`: one table per resolution (or
one table and `rollUp`), tile type 0 with `"format": "h3j"`, each tile the columnar JSON `{"h3": [...], "v": [...]}` of
the cells whose hexagon reaches it. In Node pass `gzip: (b) => zlib.gzipSync(b, { level: 9 })`.

### The basemap

`composeStyle(cartoStyle, { theme, tiles?, parts?, opacity?, land?, names?, baseLabels? })` (`basemap.ts`, a port of
CalCOFI explore's `composeStyle`) returns one style for `map.setStyle(style, { diff: true })`: CARTO's style with the
ocean moved to the bottom, the GEBCO sea floor as colour relief and igor hillshade from terrain-RGB tiers (`gebco-far`
under `gebco` under the `regional` tiers from z9), isobaths gated by level and zoom (`CONTOUR_LEVELS`: 1000 m multiples from z0, 500 from
z5, 100-750 from z7, 50 from z9), the OSM land mask, the GEBCO undersea names, and CARTO's own text toned down, in both
themes. `dem: false` gives the boot style (first paint does not wait for terrain). `baseStyle(theme)` fetches CARTO's
style once.

The tiers live at `DEFAULT_TILES`, under `https://storage.oceanmetrics.io/basemap/`. All are global except the regional
tier, built from GEBCO 2025 (`GEBCO_2025` grid, 15 arc-second, ice-surface version, downloaded 2026-10-23 from
`dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/`, 4.2 GB zip of eight GeoTIFFs) on the Mac mini by
`scripts/basemap/build_gebco.sh` (about 1 h 20 min end to end with 10 parallel blocks):

| part | url | zooms | tiles | bytes | what |
|---|---|---|---|---|---|
| far | `gebco/far.pmtiles` | 0-5 | 1,365 | 205,342,212 (196 MB) | terrain-RGB, the globe; a small tier for first paint |
| core | `gebco/core.pmtiles` | 0-8 | 87,381 | 5,690,322,235 (5.3 GiB) | terrain-RGB, the globe (z0-5 are far's tiles; z6 449.6 MB, z7 1.30 GB, z8 3.78 GB of PNG) |
| regional | `gebco/core-sanctuaries.pmtiles` | 9-10 | 6,742 | 457,140,143 (436 MiB) | terrain-RGB, the 18 sanctuaries' boxes padded 1° (PMNM in two), z9 1,430 tiles, z10 5,312 |
| contours | `gebco/contours.pmtiles` | 0-10 | 582,050 | 640,315,888 (611 MiB) | isobaths, source layer `contours` (`ele`, `level`): z0-6 the 500/1000 m lines of a ~4.6 km grid, z7-10 every level at the full 15" resolution, gated by zoom as `CONTOUR_LEVELS` |
| land | `osm/land.pmtiles` | 0-10 | 610,484 | 161,505,661 (154 MiB) | OpenStreetMap land polygons (osmdata.openstreetmap.de, 2026-08-31 extract), source layer `land` |
| names | `gebco/names.pmtiles` | 0-10 | 56,614 | 11,075,106 (10.6 MiB) | IHO-IOC GEBCO gazetteer, 5,412 records (2,632 points, 1,128 lines, 1,652 polygons as inside points), source layer `names` (`label`, `rank` 1-3) |

Total 7,165,701,245 bytes (6.7 GiB) in `s3://oceanmetrics.io-public/basemap/` (mirrored to R2 by the hourly
`io.oceanmetrics.r2sync`, `basemap` is in its prefix list). The terrain tiers are PNG, 512 px, the custom 1 m encoding
(`DEM_ENCODING`: elevation = R·65536 + G·256 + B − 10000), land clamped to 0 m, each zoom warped to its exact tile grid
before encoding. The encoding saturates at −10,000 m: the Challenger Deep floor (−10,580 m at 142.19 E, 11.35 N)
decodes as −10,000 m; the depth ramp ends at −6,500 m, so nothing shows. Attribution is in each archive's metadata
(`GEBCO Compilation Group (2025) GEBCO 2025 Grid (doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29)`, the gazetteer's
and OpenStreetMap's).

Rebuild and publish (the Mac mini, `/Volumes/msens_big/_big/oceanmetrics/basemap/`; downloads in `raw/`, work in
`build/`, archives in `out/`):

```sh
cd /Volumes/msens_big/_big/oceanmetrics/basemap
curl -L -o raw/gebco_2025_geotiff.zip 'https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff/gebco_2025_geotiff.zip?download=1'
unzip -q raw/gebco_2025_geotiff.zip -d raw/gebco        # land: raw/land-polygons-split-4326.zip (osmdata.openstreetmap.de)
JOBS=10 WORK=$PWD/build RAW=$PWD/raw ~/Github/oceanmetrics/platform/scripts/basemap/build_gebco.sh raw/gebco out \
  prep,far,core,regional,contours,land,names,verify         # tmux om:basemap, log basemap.log, marker basemap.done
for f in gebco/far gebco/core gebco/core-sanctuaries gebco/contours gebco/names osm/land; do
  aws s3 cp out/$f.pmtiles s3://oceanmetrics.io-public/basemap/$f.pmtiles --content-type application/vnd.pmtiles; done
~/.config/oceanmetrics/rclone-r2.sh sync s3:oceanmetrics.io-public/basemap r2:oceanmetrics-io-public/basemap
```

Check a terrain tile against the source with `python3 -I scripts/basemap/check_tile.py <archive> <z> <lon> <lat> <gebco.tif>`
(from z8 a pixel is the bilinear source value rounded to 1 m: Monterey Bay z8 −461 m against −461.3 m; Stellwagen Bank
−87 m against −87.3 m; Maui z9 −1,325 m against −1,325.3 m). The scripts' rules (isobath levels and the zoom gate,
name ranks) are held to `basemap.ts` by `scripts/basemap.test.ts`.

**A global z9 would cost about 11-15 GB** (3-4 times z8's 3.78 GB: 262,144 tiles at 40-56 KB; the sanctuaries' z9 is 92
KB a tile, with the boxes on the shelf), taking core to about 17-21 GB and about 100 minutes of the same build: a later
decision. Until then z9 and z10 are core overzoomed outside the sanctuaries.

Open (2026-10-23): `https://storage.oceanmetrics.io/basemap/...` answers 404 until `basemap` joins the `@atlas path_regexp` allow-list
of the storage vhost in `MarineSensitivity/server` `caddy/Caddyfile` (`^/(marine-atlas|gazetteer|...|basemap)(/|$)`), a deploy on msens
that waits for Ben. The objects are in S3 (range reads answer 206 at `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/basemap/gebco/far.pmtiles`)
and mirrored in R2.

Known: the sea floor is drawn by two or three translucent layers where tiers overlap (far under core at z0-5, regional
over core inside the sanctuaries from z9), so the relief is slightly denser there than outside; far duplicates core's
z0-5 tiles and could be dropped (or core's layers gated from z6) once the look is checked.

CARTO's styles read the protomaps schema since 2026 (source `protomaps`, `kind` where OpenMapTiles had `class`): the
mask's `water-inland` leaves out both (`OPEN_WATER`: ocean, sea). The island labels still read OpenMapTiles' `place`
layer and draw nothing on these tiles (the islands are `earth` polygons of kind `island`); open, see the checklist.

### Ramps

`ramps.ts` holds the ramps as data: 22 cmocean ramps, viridis, GEBCO (oce) and ColorBrewer Spectral, eleven stops each,
`_r` reversed. `rampStops(min, max, id, n)` for MapLibre expressions, `classColors(values)` (reversed Spectral, as
seascapeR), `colorAt(stops, t)`, `defaultRampFor(variable)`. A grid, a COG and the hexagons all use the same ramps.

## What the app implements

- **The data.** A `SliceSource` per grid layer (the engine), the STAC item of a COG, the archive url of an h3 layer.
- **The registry.** `registerSlotKind('grid', async (spec) => gridSlot(spec, mySource(spec)))`, and the same for `cog`
  and `h3`.
- **The setup, once per page, before the first map:**

```ts
import { addProtocol, importScriptInWorkers, setWorkerUrl } from 'maplibre-gl'  // named imports: MapLibre 6 has no default export
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'     // not plain ?url: its shared chunk 404s
import h3WorkerUrl from '@oceanmetrics/map/h3-worker?worker&url'
import { setupMapLibre } from '@oceanmetrics/map'

// pmtiles://, cog:// (loaded on first use), h3j in the worker
await setupMapLibre({ maplibre: { addProtocol, importScriptInWorkers, setWorkerUrl }, workerUrl, h3WorkerUrl })
```

  Pass the three functions, not `import * as maplibre`: the namespace object as an argument keeps every export of
  `maplibre-gl` in the bundle (+11.5 kB gzip measured in a Vite 8 app).

  Give `setupMapLibre` the same maplibre-gl on every call of a page: calling it again with the same module (the same
  object, or an object rebuilt from the same three functions, as above) adds only what the first call did not, and
  only a different maplibre-gl throws (0.2.2; 0.2.1 threw for an object literal rebuilt per call).

  and in `vite.config.ts`, worker chunks named `.mjs`, because MapLibre 6's `importScriptInWorkers` `import()`s a
  module only when its url ends in `.mjs` (`setupMapLibre` throws a `WorkerUrlError` otherwise):

```ts
worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].mjs', chunkFileNames: 'assets/[name]-[hash].mjs' } } },
```

- **The style.** Boot on CARTO's own style (`composeStyle(base, { theme, dem: false })`), then `composeStyle` on `load`
  and again on a theme change, with `setStyle(style, { diff: true, transformStyle: carrySlots })`. Boot on the
  composed style only when every tier answers: MapLibre schedules no frame when a source fails, so with the tiers
  unreachable `load` did not fire until the next repaint in 4 of 4 boots.

The package never imports `maplibre-gl` at run time (only its types), so its tests run without MapLibre and an app
bundles one copy. `maplibre-gl` (^6.13) and `pmtiles` (^4) are peer dependencies; `h3-js`, `@maplibre/geojson-vt`,
`@maplibre/vt-pbf` (the versions MapLibre 6 itself depends on, so they dedupe), `geotiff` and
`@geomatico/maplibre-cog-protocol` are dependencies. `sideEffects` lists only `h3Worker`, which registers its protocol
when it loads; everything else tree-shakes.

### What a consumer verifies in step 2 (not covered by these tests)

The rules are tested as pure functions; the MapLibre wiring (`mount`, `unmount`, `setupMapLibre` against the real
`maplibre-gl`, the worker module in a real worker) is typed against `maplibre-gl` 6. Step 2a ran all six points on a
Vite page against MapLibre 6.13 and CARTO's real styles, at 1280 and 390 px (`spikes/map-consumer`,
`results/checklist.md`, 2026-10-23): all pass with 0.2.1's fixes. Check again in the indicators Map and the atlas, both
themes, 390 px:

1. a vector feature renders after `setupMapLibre` (the worker url is right) and an h3 layer draws from the worker:
   the `h3Worker-<hash>.mjs` request shows, and no `h3j` request on the main thread;
2. `composeStyle` with real CARTO styles: the stack order, `setStyle(..., { diff: true })` on a theme flip keeps the
   slot, the land mask covers the coast (needs the tiers uploaded, or CalCOFI's tiers in a California view);
3. a grid slot's squares land on the dataset grid, holes show, and `update(t)` replaces the data without a flash;
4. a COG slot draws the 3857 copy in place, nodata is transparent, `atlas:bidx` > 1 draws the right band, and a 4326
   asset is refused with the asset's name in the message;
5. the antimeridian at Fiji and PMNM, for both the grid and the hexagons;
6. the bundle: the main thread gains about 4 kB (gzip) per provider, the COG protocol arrives on the first `cog://`
   request.

## Size

Measured in a Vite 8 app (step 2a, `spikes/map-consumer/results/bundle.json`, minified, gzip -9, `maplibre-gl` and
`pmtiles` bundled): the base (setup, `composeStyle`, the codec) +5.1 kB over `maplibre-gl` with the pmtiles protocol;
over that `gridSlot` +3.6 kB, `cogSlot` +3.4 kB (+21.6 kB with `pointValue` and `overviewHistogram`: geotiff's core),
`h3Slot` +3.4 kB, all three +5.8 kB; the COG protocol 112.6 kB on the first `cog://`; the h3 worker chunk 76.4 kB.

`npm run size` measures the gzipped sum of `dist/**/*.js` (comments included, before an app minifies): 26 014 B on
2026-10-23 at 0.2.0, 27 203 B with 0.2.1's fixes, budget 39 000 B (about 1.5×). Every module counts, the h3 worker module and the COG and geotiff code
included.

What an app pays, bundled and minified with its dependencies (rolldown, gzip -9, `maplibre-gl` and `pmtiles`
external, 2026-10-23):

| entry | eager | on demand |
|---|--:|---|
| `setupMapLibre` + `composeStyle` + the slot codec | 3.9 kB | the COG protocol (113 to 129 kB) on the first `cog://` request |
| + `gridSlot` | 4.5 kB | the same |
| + `cogSlot`, `legendFromStac`, `pointValue`, `overviewHistogram` | 22.2 kB (geotiff's core) | the protocol; geotiff's decoders (LERC, ZSTD, deflate ...) only for files that use them |
| + `h3Slot` | 3.9 kB | the tile builder (h3-js, geojson-vt, vt-pbf) only for an in-memory table |
| `@oceanmetrics/map/h3-worker` (in MapLibre's worker) | 76.4 kB | spike 1 measured 68.7 kB for the same code |
| `buildH3jArchive` (producers) | 65.2 kB | |

## Tests

`npm test` from the repo root. One test per rule with synthetic fixtures and no network: the key codec and its alias,
the setup against a stand-in MapLibre, the style's layer order and each contour level's `minzoom`, a theme switch
changing only the expected layers, the ramp stop counts, squares from a 2×2 lattice, the colour expressions, a
categorical legend, the 3857 guard, a legend from a synthetic STAC asset, a histogram and point values from an
in-memory GeoTIFF written with geotiff.js, the cog url, the h3 regression tests (tolerance 0 at z1, the unwrap and the
strip on the 55 crossing cells in `fixtures/h3/crossing55.json`, the lookup missing no cell, the resolution table),
an archive read back through `pmtiles`, and the consumer check's regressions (`water-inland` on protomaps-shaped tiles,
`carryLayers` across a style change, `basemapLayerIds` as the clear rule, a relative archive url made absolute).

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC. The h3j source is a port of INSPIDE/h3j-h3t (MIT, (c) 2020 INSPIDE) with
walkerke/mapgl PR 211's antimeridian fix; the basemap and ramps are ports of CalCOFI explore; the ramps' colours are
cmocean (MIT), viridis, oce's GEBCO and ColorBrewer (Apache 2.0).
