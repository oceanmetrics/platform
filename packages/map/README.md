# @oceanmetrics/map

The map stack of the Ocean Metrics apps: MapLibre 6 setup, the bathymetric basemap, colour ramps, and one layer slot
contract with three providers (a grid slice, a Cloud-Optimized GeoTIFF, H3 hexagons). Apps (indicators, atlas,
obis-hex, erddap-places) import it and draw their own places on top.

Version 0.2.0 (build week 2, step 1). 0.1.0 was the scaffold published on Day 5.

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

### Providers

Each provider is one module: a slot factory plus the pure functions it rests on.

| kind | factory | what the app gives it | rules kept (tested) |
|---|---|---|---|
| `grid` (`grid.ts`) | `gridSlot(spec, source, opts)` | a `SliceSource`: `slice(t) → [{ lat, lon, value, weight }]`, the rows of `last_step.sql` (the engine's SQL in DuckDB-WASM, build week 2 step 2) | one square per cell from the axis step (`cellSquares`, erddap-places); a cell without data is a hole; across ±180 the cells go into [0, 360); a ramp fill (`rampStops`) or a class `match` |
| `cog` (`cog.ts`) | `cogSlot(spec, asset, opts)` | the 3857 data asset of a `cog` STAC item (`pickCogAssets(item)`) | spike 3: refuse anything without `proj:code` EPSG:3857 (`CogProjectionError` names the asset); the legend from STAC `statistics` and `histogram` only (`legendFromStac`); `overviewHistogram` gives a shape, never numbers; `pointValue` reads the 4326 original; colour from `atlas:colormap` and `atlas:rescale`; nodata transparent |
| `h3` (`h3.ts`, `h3Tiles.ts`, `h3Index.ts`) | `h3Slot(spec, archive, opts)` | `{ url }` of a PMTiles archive of h3j tiles (written by `buildH3jArchive`), or `{ cells }` in memory (small tables only) | spike 1: the protocol in MapLibre's worker; geojson-vt `tolerance: 0`; the resolution stepped with zoom (`RES_FOR_ZOOM`, obis-hex's zoom_to_res); the PR 211 antimeridian unwrap and the ±180 strip, tested on the 55 crossing cells of obis-h3's ES(50) |

Producers write h3 archives with `buildH3jArchive({ levels, maxzoom, metadata, gzip })`: one table per resolution (or
one table and `rollUp`), tile type 0 with `"format": "h3j"`, each tile the columnar JSON `{"h3": [...], "v": [...]}` of
the cells whose hexagon reaches it. In Node pass `gzip: (b) => zlib.gzipSync(b, { level: 9 })`.

### The basemap

`composeStyle(cartoStyle, { theme, tiles?, parts?, opacity?, land?, names?, baseLabels? })` (`basemap.ts`, a port of
CalCOFI explore's `composeStyle`) returns one style for `map.setStyle(style, { diff: true })`: CARTO's style with the
ocean moved to the bottom, the GEBCO sea floor as colour relief and igor hillshade from two terrain-RGB tiers
(`gebco-far` under `gebco`), isobaths gated by level and zoom (`CONTOUR_LEVELS`: 1000 m multiples from z0, 500 from
z5, 100-750 from z7, 50 from z9), the OSM land mask, the GEBCO undersea names, and CARTO's own text toned down, in both
themes. `dem: false` gives the boot style (first paint does not wait for terrain). `baseStyle(theme)` fetches CARTO's
style once.

The tiers live at `DEFAULT_TILES`, under `https://storage.oceanmetrics.io/basemap/`:

| part | url | built by |
|---|---|---|
| far | `gebco/far.pmtiles` | `scripts/basemap/build_gebco.sh`: the globe, z0-5 |
| core | `gebco/core.pmtiles` | the same script: the 18 sanctuaries' boxes (padded 1°), z0-8 |
| contours | `gebco/contours.pmtiles` | the same script: 500/1000 m globally, every level in the boxes, z0-10 |
| land | `osm/land.pmtiles` | the same script: OSM land polygons clipped to the boxes, z0-12 |
| names | `gebco/names.pmtiles` | not yet: CalCOFI workflows `libs/reference_layers.R` (the IHO-IOC gazetteer, rank 1-3) |

**None of these exists yet (2026-10-23).** The script is written and smoke-tested on a synthetic raster, not run on
GEBCO: it runs on the mini in build week 2 (2026-11-06 to 11-12), then uploads. Until then an app passes its own
`tiles` (CalCOFI's California tiers at `storage.googleapis.com/calcofi-db/bathymetry/` work for a California view).

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
import * as maplibre from 'maplibre-gl'                                         // named imports: MapLibre 6 has no default export
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'     // not plain ?url: its shared chunk 404s
import h3WorkerUrl from '@oceanmetrics/map/h3-worker?worker&url'
import { setupMapLibre } from '@oceanmetrics/map'

await setupMapLibre({ maplibre, workerUrl, h3WorkerUrl })   // pmtiles://, cog:// (loaded on first use), h3j in the worker
```

  and in `vite.config.ts`, worker chunks named `.mjs`, because MapLibre 6's `importScriptInWorkers` `import()`s a
  module only when its url ends in `.mjs` (`setupMapLibre` throws a `WorkerUrlError` otherwise):

```ts
worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].mjs', chunkFileNames: 'assets/[name]-[hash].mjs' } } },
```

- **The style.** `composeStyle` on `load`, again on a theme change, with `setStyle(style, { diff: true })`.

The package never imports `maplibre-gl` at run time (only its types), so its tests run without MapLibre and an app
bundles one copy. `maplibre-gl` (^6.13) and `pmtiles` (^4) are peer dependencies; `h3-js`, `@maplibre/geojson-vt`,
`@maplibre/vt-pbf` (the versions MapLibre 6 itself depends on, so they dedupe), `geotiff` and
`@geomatico/maplibre-cog-protocol` are dependencies. `sideEffects` lists only `h3Worker`, which registers its protocol
when it loads; everything else tree-shakes.

### What a consumer verifies in step 2 (not covered by these tests)

The rules are tested as pure functions; the MapLibre wiring (`mount`, `unmount`, `setupMapLibre` against the real
`maplibre-gl`, the worker module in a real worker) is typed against `maplibre-gl` 6 but runs for the first time in an
app. Check in the indicators Map and the atlas, both themes, 390 px:

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

`npm run size` measures the gzipped sum of `dist/**/*.js` (comments included, before an app minifies): 26 024 B on
2026-10-23, budget 39 000 B (about 1.5×). Every module counts, the h3 worker module and the COG and geotiff code
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
and an archive read back through `pmtiles`.

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC. The h3j source is a port of INSPIDE/h3j-h3t (MIT, (c) 2020 INSPIDE) with
walkerke/mapgl PR 211's antimeridian fix; the basemap and ramps are ports of CalCOFI explore; the ramps' colours are
cmocean (MIT), viridis, oce's GEBCO and ColorBrewer (Apache 2.0).
