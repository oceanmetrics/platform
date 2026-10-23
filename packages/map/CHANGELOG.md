# Changelog

## 0.3.4 (2026-10-23)

The basemap's relief tiers no longer overlap: a first view at z2 fetched both `far` and `core` for the same pixels.

- Fixed: `composeStyle` gates the sea-floor layers so one tier draws one zoom. The `gebco-far` layers get `maxzoom: 6`
  (they draw z0-5 alone), the `gebco` (core) layers `minzoom: 6` and, while a regional tier is configured, `maxzoom: 9`,
  the regional layers keep `minzoom: 9`. With `tiles.regional: []` the core layers have no `maxzoom` and core is overzoomed
  past z8, as before. The relief and hillshade layers of a tier share its range. The isobaths, the land mask and the
  undersea names are unchanged, and the composed style has the same layer ids in the same order and the same sources
  (only the far and core layers gained `minzoom` or `maxzoom`).
- Saving, measured on a real MapLibre 6.13 in headless Chrome over the live archives (`spikes/map-consumer`,
  `scripts/tiers.mjs`, Monterey Bay, relief = far + core + regional): the first view at z2 went from 5,197,251 B to
  2,623,604 B of relief (2,573,647 B, 49.5%, at 1280 px; 1,778,868 B at 390 px) and from 8,375,779 B to 5,802,141 B for
  everything the first view fetches; at z8 the far tier's z5 tile is no longer fetched under core (404,644 B at 1280 px).
  The idle tier costs one 16,384 B header read. Table in the README ("Known" note).
- New (export): `CORE_MINZOOM` (6), beside `REGIONAL_MINZOOM` (9).
- Tests: the zoom range of each tier from the composed style, exactly one tier at every quarter zoom from 0 to 10 (also
  with two regional tiers, and with none), and a snapshot of the layer ids and their order.
- Size: package 47 403 B (47 148 B at 0.3.3; budget 48 000 B), the worker chunk unchanged.

## 0.3.3 (2026-10-23)

What the tiles cost, for the atlas OBIS layer's footer (obis-hex parity row 80): the release reader keeps request and
byte counts inside MapLibre's worker and had no way to tell the page.

- New: the worker posts, per built `h3r://` tile, `{ tile: { z, x, y }, file, tap, requests, bytes, rowGroupsRead,
  rowGroupsSkipped, ms, cached }` (`H3TileStats`) on `BroadcastChannel('om-h3')`. There was no worker-to-page channel
  (the tile url carries the layer one way, and `setupMapLibre` only `importScriptInWorkers` the module), so this is the
  channel; every use is guarded by `typeof BroadcastChannel !== 'undefined'`, and without one the layer draws as before
  and the counts stay zero. Each tile is billed for what it alone read (a tile that opens a file pays for its footer,
  the tile that decodes a row group pays for it, one served from the worker's cache pays nothing, `cached: true`),
  also when tiles are in flight together.
- New: `h3ReleaseSlot` `stats()` (the totals since mount, and per file with its period, resolution and whether the
  slot's view reads it now) and `onStats(cb)` (called with the totals and the tile after each tile is counted; returns
  the unsubscribe). `update({ indicator })` fetches nothing and resets nothing; a period or resolution change keeps the
  totals and the old file's counts and marks the new file (`current`). Option `stats: false` turns it off.
- Changed: a release slot's layer (so its tile url) now carries a random `tap`, which the worker copies into each
  message; the slot counts only its own tap, so another slot, map or tab of the same origin on the channel is not
  counted. `H3ReleaseLayer.tap` is optional; `releaseLayer()` itself is unchanged.
- New (exports): `releaseProvider(layer, reader, { onTile })`, `newTileTally`, `H3_CHANNEL`, `postTileStats`,
  `listenTileStats`, `newTap`, `TileTotals` and the types `H3TileStats`, `H3ReleaseStats`, `H3FileStats`, `H3Counts`.
  `RangeFile.counting(tally)` and `ReleaseReader.open/groupsFor/group/rows` take an optional tally; what is fetched
  does not change.
- Size: package 47 148 B (45 109 B at 0.3.2; budget 48 000 B), the worker chunk 101 057 B (+385 B; budget 110 000 B).

## 0.3.2 (2026-10-23)

The two reads the atlas's OBIS layer measured over their bars (atlas `docs/obis-layer.md`).

- Fixed: `tileParents` returns only the parents whose cells can touch the tile. When the tile holds at most
  `EXACT_CELLS` (20,000) cells of `res` (every tile of the auto rule) it lists them with h3-js, keeps those
  `cellTouchesTile` keeps, and returns their parents; past that (a pinned fine resolution at a low zoom) the parents
  whose hexagon meets the tile's box grown by how far their descendants reach past it (`OVERHANG`, 0.25 of the parent's
  edge, measured at most 0.203) plus one edge of `res`. 0.3.1 took every parent overlapping the box grown by two cells
  of `res`: at Monterey z9 (res 7) the view's nine tiles asked 9 res-3 parent files, now 8 (161,302 B to 154,706 B over
  the live release); the MVT of every tile measured is unchanged. Regression tests named for the miss.
- Fixed: at a pinned resolution three or more levels finer than the parents (`res` 6 under res-2 parents at z5),
  0.3.1's two-cell margin fell short of how far a parent's descendants reach (46 km at res 2 against 7 km): 2 parents
  were missed at Fiji, so cells of theirs near the tile's edge could be left out.
- New: `speciesForCell(href, cell, { res, columns?, reader?, fetch?, tail? })`: the rows of one hexagon from a species
  table sorted by `cell_id` (the release's `species_flat/res=3.parquet`), reading only the row groups whose `cell_id`
  statistics meet the cell (its own id, its children's contiguous range for a coarser cell, its parent's id for a finer
  one: `scope`), with the requests and bytes of the call; `cellRange(cell, fileRes)` and `rowCell(row)`. A reader passed
  in keeps each file's footer. Over the live file a page's first res-3 cell reads 329 kB (the 245 kB footer) and a res-1
  cell 830 kB; with the footer kept, 67 kB and 568 kB: the README says what the release must change.
- Fixtures: `fixtures/h3release/species_flat/res=3.parquet` (synthetic, `build.mjs species_flat`), `measure.mjs` the
  Monterey view case and a live `collection.json` source, `measure_species.mjs`.

## 0.3.1 (2026-10-23)

For the indicators Map's build week 2 gate (the erddap-places parity rows: the cell readout, the counts, a retry, a palette).

- New: `cellLocator(squares)`: the cell of a slice whose square holds a point (`CellProps`, a null value where the step has
  no data), from the squares' own lattice (at most nine lookups whatever the slice's size), the point brought into the
  squares' longitude frame (a world copy, a cell drawn at 180.05 in the 0..360 frame). `GridSlot.cellAt(lng, lat)` reads the
  last slice drawn: a hover or tap readout without `queryRenderedFeatures`, which cannot tell the two halves of a scissor
  swipe apart and finds nothing in a hidden slot.
- New: `sliceCounts(cells)` and `GridSlot.counts()`: the cells of the last slice, those with a value, those on a place's
  boundary (weight below 1), for a legend line.
- New: `GridSlot.ramp()` and `setRamp(id | null)`: paint the squares (and a categorical grid's classes) and the legend with
  another ramp, without a new slice; null goes back to `opts.ramp`.
- New: `GridSlot.retry()`: the slice of the period drawn asked again (after the legend's `problem`), the problem cleared
  while it loads.

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
