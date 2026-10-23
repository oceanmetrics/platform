# Changelog

## 0.3.0 (2026-10-23)

The h3 provider over a release (build week 4, step 4; decisions D4 and D5 of the week 4 plan): the OBIS layer drawn
from the obis-h3 release's own Parquet in MapLibre's worker, every indicator in each tile, no prebuilt archive.

- New: `h3ReleaseSlot({ collection, indicator, period, res, item?, keys?, base?, statsHref?, domain?, instance?, ... })`,
  the `h3` slot over a collection of the `h3` profile 1.1. `update({ indicator })` is a paint and filter change and
  fetches nothing; `update({ period })` and `update({ res })` change the tile url only when the file changes
  (`setTiles`; a new source when the maxzoom changes); a string or null is still the period (the LayerSlot contract's
  `t`). One vector source `h3r://<layer>/{z}/{x}/{y}` with `promoteId: 'h3'`, a fill filtered by `['has', indicator]`;
  with `res: 'auto'` the fill steps with the zoom, each resolution on its own domain. `instance` ids as gridSlot's.
- New: the `h3r://` protocol in the worker module (`@oceanmetrics/map/h3-worker`, beside `h3j://`): `releaseProvider`
  and `ReleaseReader` (`h3Parquet.ts`) read only the row groups whose `cell_id` statistics meet the tile's parents
  (hyparquet, column projection, ZSTD through fzstd), cache decoded row groups per worker (LRU, 64 MB), read the
  parent split at `h3:layout.parent_res` with a whole-file fallback, and treat a 403/404 as no cells, asked once.
- New: the file resolution (`h3ReleaseLayer.ts`): `releaseLayer`, `resolvePeriod` (one set or a list: a bare value,
  `'<grain>:<value>'` or `{ grain, value }`; an ambiguous value is refused), `fillTemplate`, `releaseFile`, `pickRes`
  (the release's ladder, never a roll-up), `releaseMaxzoom`, `releaseTileUrl`/`parseReleaseTileUrl`, `idColumn`,
  `indicatorColumns`.
- New: H3 by bit arithmetic (`h3Bits.ts`, no h3-js): `cellIdOf`, `h3OfCellId`, `cellIdRes`, `parentId`, `childRange`,
  `mergeRanges`, `inRanges`, `overlapsRanges`.
- New: the legend reader `readReleaseStats(url, match)` and `statsMatch(item, period)` over `stats.parquet` (lazy on
  the main thread); `releaseDomains` gives `[p02, p98]` per resolution.
- New: `openRangeFile` (a suffix range first: length and footer in one request, no HEAD; bytes counted),
  `COMPRESSORS` (ZSTD).
- New: `tileParents(z, x, y, res, parentRes)` and `marginDegFor(res)` in `h3Index.ts` (CellIndex uses them); the
  types `H3Rows` and `H3TileData`; `tileToGeoJSON`, `tileFeatures`, `tileToMvt` and `TileProvider` take multi-column
  tiles (`{ h3, columns }`, a NaN left out of the properties).
- Changed: `rollUp(cells, res, agg, { variable })` refuses a diversity metric (`NON_ADDITIVE`: sp, es, shannon,
  simpson, hill_1, hill_2) with any aggregate.
- Changed: `ZOOM_BREAKS`, `zoomToRes`, `RES_FOR_ZOOM` and `resForZoom` live in `h3Zoom.ts` (still exported from
  `h3Index.ts` and the index), so the main thread's release slot does not pull h3-js in.
- Changed: `PACKAGE.version` says 0.3.0 (it had stayed at 0.2.0 through 0.2.3).
- Dependencies: `hyparquet` ^1.31.5 and `fzstd` ^0.1.1; dev `rolldown` (the worker chunk measure).
- Size: the package budget 39,000 to 48,000 B (41,877 measured) and the worker chunk measured on its own line,
  100,215 B against a budget of 110,000 B; the reasons in the README "Size".
- Fixture: `fixtures/h3release/` (a synthetic 0.11-shaped release from `build.mjs`) and `measure.mjs` (bytes and time
  per tile; the README's table).

## 0.2.3 (2026-10-23)

For the indicators Map's compare mode (Then vs Now as two slices of one layer, build week 2 step 4).

- New: `gridSlot` option `instance?: string`: the slot's ids become `slot:grid@<instance>` and `slot:grid@<instance>:fill`
  (still `slot:`, so `isSlotLayer` and an app's `clear()` treat them as the slot's), so two slots of one layer, at two
  periods, mount on one map side by side; without it the second `addSource('slot:grid')` threw. `gridIds(instance)`
  names both ids.
- New: `gridSlot`'s `domain` may be a function, read at each slice and at `repaint()` (null = the slice's own range),
  so two slots share one colour scale (the union of their ranges); the slot returned is a `GridSlot` with `ids`,
  `cellRange()` (the last slice's own value range) and `repaint()` (the colours again under the current domain, no new
  slice). A fixed `[min, max]` behaves as before.

## 0.2.2 (2026-10-23)

Fixes found by the first two consumers (the indicators Map and the atlas).

- Fix: `cogUrl(asset)` ignored the band, so two Items that are bands of one file (`atlas:bidx` 1..9) collided in the
  protocol's colour-function cache and in MapLibre's tile cache. The `#color:` grammar of `@geomatico/maplibre-cog-protocol`
  0.10 has no band key (`<scheme>,<min>,<max>,<modifiers>`, the first band), and the protocol keys its colour function,
  reader and tile caches by the href before the `#`, so the band goes into that href as `b=<bidx>` (`?b=2`, or `&b=2`
  after an existing query), which the file's server ignores. New `cogHref(asset)`; `cogSlot` registers its colour
  function (which selects the band) under that same key. The atlas's `,b<bidx>` workaround can go. An asset without
  `atlas:bidx` keeps its href unchanged.
- New: `gridSlot` option `outline?: string | null`. Default by the axis step: the 12% black outline on grids coarser than
  0.05 degrees, none on finer ones (at 0.01 degrees it drew a visible mesh); a colour forces it, `null` removes it.
  Exported `gridOutline(spacing, outline)`, `GRID_OUTLINE`, `OUTLINE_BELOW`.
- Fix: `setupMapLibre` must receive the same maplibre-gl on every call of a page. It is now idempotent for an identical
  module (the same object, or an object rebuilt from the same `addProtocol`, `setWorkerUrl` and `importScriptInWorkers`)
  and throws only for a different one; an object literal rebuilt per call used to throw.

## 0.2.1 (2026-10-23)

The basemap tiers (build week 2 step 2b): the sea floor now serves every app globally.

- New: `BasemapTiles.regional`, a list of deeper terrain-RGB archives drawn over core from z9 (`REGIONAL_MINZOOM`), each
  its own `raster-dem` source (`gebco-regional`, `gebco-regional-2`, ..., `regionalSourceId(i)`) with relief and shade
  layers; `DEFAULT_TILES.regional` is `gebco/core-sanctuaries.pmtiles` (the 18 sanctuaries, padded 1 degree, z9-10).
  Pass `tiles: { regional: [] }` to leave core overzoomed past z8. `seaSurfaceId` and `basemapLayerIds` know the new ids.
- Changed: `core` is the globe at z0-8 (it was the regional boxes), and the contours and the land mask are global; see
  the README's Basemap section for the archives, sizes and the build.

The consumer check (build week 2 step 2a, `spikes/map-consumer`): the six README points run on a Vite page against
MapLibre 6.13 and CARTO's real styles.

- Fix: `composeStyle`'s land mask repainted the whole ocean over the data on CARTO's current tiles (protomaps schema:
  water polygons carry `kind`, not `class`); `water-inland` now leaves out `kind` or `class` ocean and sea
  (`OPEN_WATER`).
- Fix: a theme flip with `setStyle(style, { diff: true })` dropped the mounted slot. New `carrySlots` and
  `carryLayers(keep)`, the `transformStyle` that carries the slot's (or any kept) layers and sources into the next style
  under the layer they sat under.
- Fix: an h3 archive given by a relative url 404ed in the worker (resolved against the worker script);
  `h3TileUrl(url, base?)` and `h3Slot` now make it absolute against the page (`absoluteArchiveUrl`).
- New: `basemapLayerIds(style)`, the layer ids of a composed style: the rule an app's `clear()` keys on (indicators'
  `base-*` rule matches no CARTO id).
- README: the setup passes `{ addProtocol, importScriptInWorkers, setWorkerUrl }`, not the `maplibre-gl` namespace
  (+11.5 kB gzip); boot on `dem: false` (a failing tier stalls `load`); the bundle as a Vite app measures it.

## 0.2.0 (2026-10-23)

The map stack, build week 2 step 1: the layer slot contract, MapLibre 6 setup, the bathymetric basemap, the ramps and
three providers.

- **Slots** (`slot.ts`, moved in from indicators `layerSlot.ts`): `LayerSlot`, `LayerSpec`, `LegendSpec` (now with
  `ramp`, `classes`, `histogram`, `stats`, `units`); `parseLayerKey`/`formatLayerKey` for `layer=<kind>:<id>[:<variable>]`
  with kinds `grid`, `cog`, `h3`; `erddap:` parses as a deprecated alias of `grid:`; `registerSlotKind`, `slotFor`,
  `SLOT_PREFIX`; `slotBeforeId` now takes the drawn layer ids (`under` and `fallback` options).
- **MapLibre 6 setup** (`maplibre.ts`): `setupMapLibre({ maplibre, workerUrl, h3WorkerUrl, protocols })` sets the
  worker url, registers `pmtiles://` and a lazily loaded `cog://`, and imports the h3j module into MapLibre's worker;
  `workerUrl`, `h3ModuleUrl` (must end in `.mjs`), `WorkerUrlError`, `pmtilesProtocol`, `registerProtocol`.
- **Basemap** (`basemap.ts`, a port of CalCOFI explore's `composeStyle`): `composeStyle(base, opts)` with the two GEBCO
  terrain tiers, hillshade, zoom-gated isobaths, the undersea names, the OSM land mask and toned CARTO labels in both
  themes; `BasemapTiles`/`DEFAULT_TILES` (storage.oceanmetrics.io/basemap/, built by `scripts/basemap/build_gebco.sh`,
  not uploaded yet); `seaSurfaceId`, `baseStyle`, `CONTOUR_LEVELS`, `BATHY_RAMP`.
- **Ramps** (`ramps.ts`): cmocean, viridis, GEBCO and Spectral as data; `rampStops`, `classColors`, `colorAt`,
  `interpolateColors`, `rampHex`, `defaultRampFor`.
- **grid** (`grid.ts`): `gridSlot(spec, source)` over a `SliceSource`; `cellSquares` (from erddap-places),
  `gridFillColor`, `classLegend`, `gridLegend`.
- **cog** (`cog.ts`): `cogSlot(spec, asset)` over `@geomatico/maplibre-cog-protocol`, refusing non-3857 assets
  (`CogProjectionError`); `legendFromStac`, `overviewHistogram`, `pointValue`, `cogUrl`, `cogColorFunction`,
  `pickCogAssets`.
- **h3** (`h3.ts`, `h3Tiles.ts`, `h3Index.ts`, `h3Archive.ts`, the `@oceanmetrics/map/h3-worker` entry): `h3Slot(spec,
  archive)` over a PMTiles archive of h3j tiles read in the worker, or an in-memory table; the h3j tile builder
  (`tileToMvt`, `h3jSource`, `cellRing` with the PR 211 unwrap, geojson-vt `tolerance: 0`), `CellIndex`,
  `RES_FOR_ZOOM`, `rollUp`; `buildH3jArchive`, the producers' archive writer.
- Dependencies: `maplibre-gl` ^6.13 and `pmtiles` ^4 as peers; `h3-js`, `@maplibre/geojson-vt`, `@maplibre/vt-pbf`,
  `geotiff`, `@geomatico/maplibre-cog-protocol`.
- Size budget set from a measurement: 26 014 B gzip, budget 39 000 B.

## 0.1.0 (2026-10-22)

- Scaffold: the `PACKAGE` constant only. The renderer (grid slice, COG, H3 source) and the basemap arrive in build week 2
  (2026-11-06 to 11-12).
