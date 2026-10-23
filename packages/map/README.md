# @oceanmetrics/map

The map stack of the Ocean Metrics apps: MapLibre 6 setup, the bathymetric basemap, colour ramps, and one layer slot
contract with three providers (a grid slice, a Cloud-Optimized GeoTIFF, H3 hexagons). Apps (indicators, atlas,
obis-hex, erddap-places) import it and draw their own places on top.

Version 0.3.0 (build week 4, step 4): the h3 provider over a release, below. 0.2.0 was build week 2, step 1; 0.1.0 the
scaffold published on Day 5. 0.2.1 (unreleased) holds the fixes
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
  update(t: string | null): void   // the h3 release slot also takes { indicator?, period?, res? }
  unmount(map): void
  legend(): LegendSpec | null    // title, t, via, problem, units, ramp | classes, histogram, stats
}
```

- `update(t)` draws another period. The `h3` kind's release slot (`h3ReleaseSlot`, 0.3.0) widens it to
  `update(t | { indicator?, period?, res? })`: a string or null is still the period, an object changes any of the three
  (see "The h3 provider over a release"). Its `mount(map, beforeId, t)` takes `t` only when it is a period of the
  collection, so another app's date is ignored, not thrown.
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
| `grid` (`grid.ts`) | `gridSlot(spec, source, opts)` | a `SliceSource`: `slice(t) → [{ lat, lon, value, weight }]`, the rows of `last_step.sql` (the engine's SQL in DuckDB-WASM, build week 2 step 2) | one square per cell from the axis step (`cellSquares`, erddap-places); a cell without data is a hole; across ±180 the cells go into [0, 360); a ramp fill (`rampStops`) or a class `match`; the squares' outline (12% black) only on grids coarser than 0.05° (the finer of the two axis steps), since at 0.01° it draws a mesh over the data: `outline: string \| null` overrides (a colour, or `null` for none), `gridOutline(spacing, outline)` is the rule (0.2.2); `instance` keeps a second slot's ids apart (`gridIds`: `slot:grid@<instance>`) and a `domain` function shares one scale between two slots, with `cellRange()` and `repaint()` on the `GridSlot` (0.2.3); `cellAt(lng, lat)` (the cell under a pointer, from `cellLocator` over the last slice's lattice, any world copy, across ±180), `counts()` (`sliceCounts`: cells, with a value, on a boundary), `ramp()` / `setRamp(id)` (another ramp without a new slice) and `retry()` (the same period asked again after a failure) (0.3.1) |
| `cog` (`cog.ts`) | `cogSlot(spec, asset, opts)` | the 3857 data asset of a `cog` STAC item (`pickCogAssets(item)`) | spike 3: refuse anything without `proj:code` EPSG:3857 (`CogProjectionError` names the asset); the legend from STAC `statistics` and `histogram` only (`legendFromStac`); `overviewHistogram` gives a shape, never numbers; `pointValue` reads the 4326 original; colour from `atlas:colormap` and `atlas:rescale`; nodata transparent. **Bands of one file** (items whose assets share an href and differ in `atlas:bidx`): the protocol's `#color:` grammar has no band key and it caches colour functions, readers and tiles by the href before the `#`, so `cogUrl` adds `b=<bidx>` to the href's query (`cogHref`; the file's server ignores it) and `cogSlot` selects the band in its colour function under that same key (0.2.2); no workaround in the app |
| `h3` over a release (`h3Release.ts`, `h3ReleaseLayer.ts`, `h3Parquet.ts`, `h3Stats.ts`, `h3Bits.ts`; 0.3.0) | `h3ReleaseSlot({ collection, indicator, period, res, ... })` | a collection of the `h3` profile 1.1 (the obis-h3 release), the item (`all`, an EOV, a taxon) | the release's own Parquet read in MapLibre's worker, the row groups under the tile only; every indicator in each tile; the resolution ladder of the release, never a roll-up; the colour domain from `stats.parquet`; the same tile builder and seam rules as the row below |
| `h3` (`h3.ts`, `h3Tiles.ts`, `h3Index.ts`) | `h3Slot(spec, archive, opts)` | `{ url }` of a PMTiles archive of h3j tiles (written by `buildH3jArchive`), or `{ cells }` in memory (small tables only) | spike 1: the protocol in MapLibre's worker; geojson-vt `tolerance: 0`; the resolution stepped with zoom (`RES_FOR_ZOOM`, obis-hex's zoom_to_res); the PR 211 antimeridian unwrap and the ±180 strip, tested on the 55 crossing cells of obis-h3's ES(50) |

Producers write h3 archives with `buildH3jArchive({ levels, maxzoom, metadata, gzip })`: one table per resolution (or
one table and `rollUp`), tile type 0 with `"format": "h3j"`, each tile the columnar JSON `{"h3": [...], "v": [...]}` of
the cells whose hexagon reaches it. In Node pass `gzip: (b) => zlib.gzipSync(b, { level: 9 })`.

### The h3 provider over a release

Decision D4 of the week 4 plan: the OBIS layer is drawn from the obis-h3 release's own Parquet, read in MapLibre's
worker, with every indicator in each tile, and no prebuilt archive. 7,370 taxon groups, 7 decades and the year layers
would make archives per layer, period and indicator a second copy of the release. The release already is a pyramid by
resolution and parent, and its metrics do not roll up.

```ts
import { h3ReleaseSlot } from '@oceanmetrics/map'

// once per page, with the worker (the release protocol h3r:// lives in the same chunk as h3j://)
await setupMapLibre({ maplibre: { addProtocol, importScriptInWorkers, setWorkerUrl }, workerUrl, h3WorkerUrl })

const collection = await (await fetch('https://storage.oceanmetrics.io/obis-h3/collection.json')).json()
const slot = h3ReleaseSlot({
  collection,                         // h3 profile 1.1: h3:layout, h3:periods (one set or a list), table:columns
  item: { layer: 'eov', key: 'birds' }, // { layer: 'all' } (default), { layer: 'taxon', key: 'Aves', rank: 'class' }
  indicator: 'es',                    // any numeric column of table:columns: n, sp, shannon, simpson, es
  period: '1990s',                    // null (all time), a value of one set, 'year:2015', or { grain, value }
  res: 'auto',                        // or a resolution the period publishes (pinned)
  onchange: () => renderLegend(slot.legend()),
})
slot.mount(map, beforeId, null)       // on the style recorder, as cogSlot
slot.update({ indicator: 'sp' })      // a paint and filter change: no tile is fetched
slot.update({ period: '2015' })       // a new tile url only when the file changes (setTiles)
slot.update({ res: 4 })
```

What happens, and where:

- **Main thread** (`h3ReleaseLayer.ts`, `h3Release.ts`, +5.2 kB minified with the slot). The period picks its set, the
  set's `template` (else `h3:layout.template`) and its `resolutions`; no period is the all-time layer at
  `h3:resolutions`. The keys fill the other placeholders (`{layer}`: `all`, `eov/eov=birds`,
  `taxon/rank=class/taxon=Aves`; the values go in as given, so pass them url-path-ready, as `taxon_groups.parquet`
  `url_path` holds them). The result, an `H3ReleaseLayer` (absolute templates with `{res}` and `{parent}` open, the
  ladder, the pin, the id column and the indicator columns), travels whole in the tile url
  `h3r://<encoded json>/{z}/{x}/{y}`, so the worker needs no message channel to read it (what the tiles cost comes back
  on one, see "What the tiles cost" below). One vector source with `promoteId: 'h3'`
  (feature state for hover and selection) and one fill: `filter: ['has', indicator]` (a cell without ES(50) is not
  drawn), `fill-color` the ramp on `['get', indicator]`. With `res: 'auto'` the fill is a `step` on the zoom, each
  resolution on its own domain.
- **Worker** (`h3Parquet.ts`, in `@oceanmetrics/map/h3-worker`). For a tile at zoom z: the resolution is the pin, or
  the finest of the ladder at or under `RES_FOR_ZOOM[z]`, else the ladder's coarsest. Never a roll-up: each resolution
  is its own file, and `rollUp` now refuses `sp`, `es`, `shannon`, `simpson` (`NON_ADDITIVE`) with any aggregate. The
  cells under the tile are `tileParents` at a resolution two coarser (0.3.2: the parents of the cells of `res` that
  touch the tile and geojson-vt's buffer, as `cellTouchesTile` says, listed with h3-js when the box holds at most
  `EXACT_CELLS` = 20,000 of them; past that, a pinned fine resolution at a low zoom, the parents whose own hexagon meets
  the box grown by how far a parent's descendants reach past it, `OVERHANG` = 0.25 of its edge, under one parent radius,
  plus one edge of `res`; split at ±180, densified), each parent turned into the cell_id range of its children by bit arithmetic
  (`h3Bits.ts`, spike 4's verdict, tested against h3-js on 100 random cells at res 1 to 7). The reader opens a file
  with one suffix range request (`bytes=-65536`: the length from Content-Range, which the bucket's CORS exposes, and
  the footer in one round trip, no HEAD), keeps the row groups whose `cell_id` statistics meet a range and reads only
  those (columns `cell_id` plus the indicators; the `h3` string is not read, the id gives it). Decoded row groups stay
  in the worker's cache (LRU, 64 MB), shared by every layer, period and slot of the page: the next tile in the same
  group, an indicator switch and a return to a period fetch nothing. The rows in the ranges go to the existing tile
  builder (`h3Tiles.ts`: the PR 211 unwrap, `tolerance: 0`, vt-pbf) as `{ h3, columns }`, one property per column, a
  NULL left out. At a resolution in `h3:layout.parent_res` the worker reads the files of the parents under the tile
  (`parent_template`); when none of them is there it tries the whole file once per layer and resolution and
  remembers which the layer is. A 403 or 404 is a file the release does not have: no cells, asked once.
- **Legend** (`h3Stats.ts`, a lazy 20.9 kB chunk with hyparquet and fzstd). `stats.parquet` (the collection's `stats`
  asset, else `stats.parquet` beside it) is read once per layer and period: hyparquet skips the row groups whose
  `layer` and `key` statistics cannot match, and the read returns every resolution and variable, so an indicator or
  zoom change reads nothing more. The domain is `[p02, p98]` of the layer, period, resolution and indicator, never
  the loaded cells. `legend()` reports the resolution the map's zoom draws (`zoomend`), its ramp, and `min`/`max` as
  `stats`.

**Measured** (2026-10-23, Node 26 on the Mac mini M4 Pro, `node packages/map/fixtures/h3release/measure.mjs`; local
files through a Range-honouring fetch unless said; read = fetch and decode, build = hexagons, geojson-vt, MVT):

| what | tile | requests | bytes read | row groups read / skipped | cells | read + build ms |
|---|---|--:|--:|--:|--:|--:|
| the synthetic fixture, res 3 (41,162 cells, 5 groups of 10,240) | z4 California, cold | 3 | 197,651 | 2 / 3 | 931 | 30.6 + 7.2 |
| the same | the next z4 tile, warm | 0 | 0 | 0 / 3 | 931 | 1.8 + 3.1 |
| the same | all 256 z4 tiles, one reader | 5 | 330,220 | 5 | ≤ 1,315 | mean 1.3, p95 3.0, max 7.6 |
| the synthetic fixture, res 5 (3 groups of 2,048) | z6 Fiji on the seam, cold | 1 | 65,536 (the whole file is the tail) | 1 / 2 | 1,519 | 5.3 + 6.1 |
| obis-h3 v20261012 `all/res=3` as published (747 kB, 1 group) | z4 California, cold | 2 | 778,850 | 1 / 0 | 918 | 52.9 + 8.1 |
| the same, sorted by cell_id in groups of 10,240 (771 kB, 4 groups) | z4 California, cold | 3 | 464,129 | 2 / 2 | 918 | 46.8 + 8.3 |
| v20261012 `all/res=5` as published (7.87 MB, 6 groups of up to 122,880, unsorted) | z6 Fiji, cold | 4 | 2,501,472 | 3 / 3 | 639 | 181.5 + 6.5 |
| the same, sorted, groups of 10,240 (8.09 MB, 67 groups) | z6 Fiji, cold | 4 | 367,098 | 3 / 64 | 639 | 32.6 + 5.2 |
| v20261012 `all/res=5` as published | z9 California at res 5, cold | 3 | 2,174,529 | 2 / 4 | 195 | 110.1 + 0.5 |
| the same, sorted | z9 California at res 5, cold | 2 | 226,780 | 1 / 66 | 195 | 10.9 + 0.6 |
| v20261012 over HTTP from S3 us-east-1, res 7 split by res-3 parent | z9 California, cold | 4 | 53,970 | 4 / 0 | 662 | 405 + 1.6 |
| the same, 0.3.2 (`tileParents` exact) | z9 California, cold | 3 | 43,823 | 3 / 0 | 493 | 548 + 7.5 |
| obis-h3 v20261012 over HTTP (the live `obis-h3/collection.json`, layer `all`), 0.3.1 | **the Monterey Bay view at z9** (res 7: the nine 512 px tiles of a 1280 × 800 map at -122.1, 36.75) | 9 (9 parent files) | **161,302** | 9 / 0 | 8,337 | 481 for the nine |
| the same, 0.3.2 | the same view | 8 (8 parent files) | **154,706** | 8 / 0 | 7,369 | 469 for the nine |

**Monterey z9 (0.3.2).** The atlas measured this view at 169,560 B in 11 res-3 parent files against obis-hex's 118 KB in
7 (its `docs/obis-layer.md`; its view's exact centre is not written, the 49 centres of a 0.7° × 0.6° grid over the bay
ask 7 to 12 files at 0.3.1, mean 9.5). 0.3.1's `tileParents` took every parent at res 5 whose hexagon met the tile's
box grown by two res-7 cells, so some tiles asked a res-3 file none of whose cells reaches them (832918fffffffff for
tile 9/81/200); 0.3.2 asks only the parents of cells that touch the tile: 8 files at -122.1, 36.75 (9 before), mean 8.8
over the 49 centres (min 7, max 12), and the MVT of every tile measured is byte for byte the same (California z4 39,971 B,
z9 25,685 B, Fiji z6 35,525 B, live; the fixture's too): the cells no longer read were never drawn. **Still over 118 KB**,
for two reasons outside `tileParents`: (1) MapLibre asks the 512 px tiles that meet the view, nine tiles of 1536 ×
1536 px for 1280 × 800, and their cells reach one res-3 parent past obis-hex's cover of the view (8329adfffffffff, from
tile 9/83/200); obis-hex planned from the view's own bounds (the res-3 centres in view and their ring 1: 7 here, all
among the 8); (2) the 118 KB was obis-hex's own files: **the same 7 partitions of today's release are 135,373 B**
(832834 38,953; 832830 27,823; 832835 27,174; 83291a 18,622; 83291b 8,674; 832836 7,997; 8329a9 6,130), so no tile
plan reads this view under 118 KB. The test is `h3Index.test.ts` "the Monterey Bay view at z9"; the regressions are
named for the miss.

So on today's unsorted release the provider is correct but reads whole groups of 122,880 rows; the sorted layout of
obisindicators 0.11 cuts a cold z6 tile from 2.5 MB to 0.37 MB and a z9 res-5 tile from 2.2 MB to 0.23 MB, for 2.9%
more bytes on disk (res 5: 8.09 against 7.87 MB). The res-3 file is small enough that a world view reads it whole
either way. Tile building stays under 10 ms; a cold tile's time is the fetch.

**What the provider assumes of the release** (obisindicators 0.11, step 3 of the week 4 plan, must honour):

1. Every layer file is sorted by `cell_id` (BIGINT, the H3 index) and has row-group statistics (min, max) on it;
   `h3:layout.row_group_rows` is informative only (the reader prunes by the statistics it finds).
2. One file holds one resolution: all of a file's cells share it.
3. The value columns are those of `table:columns` (numeric, not `h3` or `cell_id`); a NULL is a missing value. The
   same names in every layer and period (`n` may be BIGINT or DOUBLE).
4. Paths are `h3:layout.template` (all time) or the period set's own `template`, with `{res}` and the set's
   `placeholder`; a set's `values` are written in the path as listed (`decade=1990s` or `decade=1990`), and a value
   appears in one set only (or the caller names the grain).
5. At a resolution in `h3:layout.parent_res`, files are `parent_template` with `{parent}` the hex id of the parent at
   that resolution. A layer at that resolution is either split (no whole file) or whole (no parent files); the reader
   costs one extra request per layer and resolution to learn which. Periods with their own `template` are never split.
6. A missing file answers 403 or 404 (S3, R2), and every object answers a suffix range (`Range: bytes=-N`) with 206
   and `Content-Range`, exposed by CORS (`Access-Control-Expose-Headers: Content-Range`, as the bucket does today).
7. `stats.parquet` keeps today's columns (`layer, key, rank, decade, res, variable, min, p02, p50, p98, max,
   n_cells`) plus `year` for the year layers; `layer` is `all|eov|taxon` for all time and `<grain>_<layer>` for a
   period (`decade_all`, `year_eov`); `key` is `''` (not NULL) for `all`, `rank` `''` outside taxa; the period column
   is named by the grain and holds the year of the period (1990 for `1990s`), NULL for all time. Sorted by `layer,
   key`, so the legend reads only its row groups; smaller row groups than today's 122,880 would make that read small
   (today the first group of the 2.18 MB file holds `all`, `eov` and half the taxa).
8. The collection names `stats.parquet` as an asset `stats`, its `self` link is absolute (or the reader is given the
   base), and the heads are ordinary taxon layers under `taxon/rank=<rank>/taxon=<name>/` (`h3:heads.layer: taxon`).

The h3j PMTiles form (`h3Slot` with `{ url }`) stays for single-value archives.

#### What the tiles cost (`stats()`, `onStats()`, 0.3.3)

The reader runs in MapLibre's worker and counts its requests and bytes, but a protocol action cannot tell the page.
The package had no worker-to-page channel (the tile url is one way), so the worker posts one message per built tile on
`BroadcastChannel('om-h3')` (guarded by `typeof BroadcastChannel !== 'undefined'`: without it nothing is posted, the layer
draws as before and `stats()` stays at zero). The message, `H3TileStats`:

```ts
{ tile: { z, x, y }, file,            // the layer file at the tile's resolution (split layers: read under this name)
  tap,                                // the slot that asked (its layer's `tap`)
  requests, bytes,                    // range requests this tile made and their response bytes
  rowGroupsRead, rowGroupsSkipped,    // row groups it decoded / its cell_id statistics ruled out
  ms,                                 // tile request to rows (the read; the geometry is built after)
  cached }                            // no request: footer and row groups came from the worker's cache
```

A tile is billed for what it alone read: the tile that opens a file pays for its footer, the one that decodes a row
group pays for it, and a tile served from the cache (or from another tile's read in flight) is `cached: true`, 0 bytes.
`rowGroupsSkipped` counts again each time (the statistics are checked per tile).

The slot totals its own tiles (its layer carries a random `tap`, which the worker copies into each message, so another
slot, map or tab on the channel is not counted):

```ts
slot.stats()          // H3ReleaseStats, a snapshot: since mount
// { tiles, cachedTiles, requests, bytes, rowGroupsRead, rowGroupsSkipped, ms,   // ms is the sum over tiles
//   file,               // the file of the latest tile counted, or null
//   files: [{ file, period, res, current, tiles, cachedTiles, requests, bytes, rowGroupsRead, rowGroupsSkipped, ms }] }
const off = slot.onStats((stats, tile) => { ... })   // after each tile is counted; off() stops
```

`update({ indicator })` fetches nothing and resets nothing. A period or resolution change keeps the totals and the old
file's counts, and marks the new file: `files[i].current` is true for the files the view reads now (any resolution of
its ladder), `period` is `{ grain, value }` or null for all time. `h3ReleaseSlot({ ..., stats: false })` turns it off.
The totals reset when the slot is mounted; `unmount` stops listening but keeps what was counted. Tiles read in parallel
overlap, so `ms` (a sum of the tiles' own times) can exceed the wall time.

A one-line footer, `N requests, X KB in Y ms, Z row groups skipped`:

```ts
const footer = (s: H3ReleaseStats) =>
  `${s.requests} requests, ${(s.bytes / 1000).toFixed(1)} KB in ${Math.round(s.ms)} ms, ${s.rowGroupsSkipped} row groups skipped`
el.textContent = footer(slot.stats())
slot.onStats((s) => { el.textContent = footer(s) })
```

**For the atlas author** (`src/lens/collection/h3/`, the OBIS layer's footer): build the slot once with
`h3ReleaseSlot(...)`, and call `slot.stats()` (or subscribe with `slot.onStats`) where the footer is rendered, in the
same component that mounts the slot. Read it after the slot is mounted (before, it is zeros), and drive the footer from
`onStats` rather than polling: it fires per tile, so throttle the DOM write (one per animation frame) while a view
loads. Do not reset anything on an indicator change: the counts are the page's session total for this slot, and
`files` splits them by period and resolution if the footer wants "this file" instead.

### The species of a cell (`speciesForCell`, 0.3.2)

```ts
import { ReleaseReader, speciesForCell } from '@oceanmetrics/map'

const reader = new ReleaseReader({ tail: 262_144 })   // one per page: each file's footer is read once
const got = await speciesForCell(`${base}species_flat/res=3.parquet`, '81197ffffffffff', { res: 3, reader })
// { cell, cellRes: 1, fileRes: 3, scope: 'children', range, rows: [{ cell_id, name_key, aphiaid, n, year_min, year_max }, ...],
//   groupsRead, groupsSkipped, requests, bytes }   or null when the file is not there
```

The Cell pane's read of a species table sorted by `cell_id` (the release's `species_flat/res=3.parquet`): the row
groups whose `cell_id` statistics meet the cell's range, and only those. A cell at the file's resolution is its own id;
a coarser cell is the ids of its children at the file's resolution, which are **one contiguous range**: a parent's
children share its base cell and digits and run the finer digits 0 to 6 (`childRange`), and over all 41,162 res-3 cells
the range of a parent holds its children and nothing else (`h3Species.test.ts`, for res-0, res-1 and res-2 parents,
pentagons among them), so in a file sorted by `cell_id` they are one run of rows. A finer cell returns its parent's rows
(`scope: 'parent'`). The rows are the file's (a coarser cell's are one per child and species: summing them is the
caller's). `columns` limits the read; the id comes back as a bigint, the INT64 columns as numbers.

**Measured** (2026-10-23, Node 26 on the Mac mini, `node packages/map/fixtures/h3release/measure_species.mjs
<href>`, the live `v20261012/species_flat/res=3.parquet` on S3 us-east-1: 23.9 MB, 3,788,665 rows in 370 row groups of
about 10,240, **a 245,010 B footer**; columns `aphiaid, n, name_key, year_min, year_max`; a warm HTTPS connection, the
first request of a cold one adds about 0.5 s):

| cell | tail | footer | requests | bytes | row groups read / skipped | rows (species) | ms |
|---|--:|---|--:|--:|--:|--:|--:|
| `8329a9fffffffff` (res 3, Monterey) | 64 KiB | read | 3 | 311,769 | 1 / 369 | 196 (196) | 476 to 482 |
| the same | 256 KiB | read | 2 | 328,895 | 1 / 369 | 196 | 313 to 319 |
| the same | either | kept (a second cell of the page) | 1 | 66,751 | 1 / 369 | 196 | 143 to 171 |
| `81197ffffffffff` (res 1, 49 res-3 children) | 64 KiB | read | 11 | 813,075 | 9 / 361 | 76,751 (9,123 AphiaIDs) | 710 to 1,369 |
| the same | 256 KiB | read | 10 | 830,201 | 9 / 361 | 76,751 | 353 to 386 |
| the same | either | kept | 9 | 568,057 | 9 / 361 | 76,751 | 200 to 289 |

**The bar (0.6 MB, 0.3 s) is met only once the footer is kept**: a page's first cell pays the 245 kB footer (79% of a
res-3 read), and a res-1 cell reads 9 row groups of 10,240 rows (568 kB) for its 77,000 child rows. The atlas passes a
256 KiB tail (one request for the footer, not two) and keeps one reader per page. What the release must change
(obisindicators, `species_flat`), in order of effect:

1. **A `species_flat` per resolution** (`res=1.parquet`, `res=2.parquet` beside `res=3`, one row per cell and species:
   `n` summed, `year_min` the least, `year_max` the greatest, as the atlas's `sumBySpecies` does): a res-1 cell then
   reads its own 9,123 rows (about one 10,240-row group, ~60 kB) instead of its children's 76,751 (568 kB).
2. **A footer under the 64 KiB tail**, so the first read is one request: split each file by a coarse parent as the
   layer files are (`species_flat/res=3/p=<res-1 parent>.parquet`: 23.9 MB over the res-1 parents with records, so
   most files come whole in the tail and a dense one has a footer of a few groups), and drop the `h3` column (the
   `cell_id` gives it; it is one of the seven columns every row group's metadata repeats, with string statistics).
3. Smaller row groups are not the fix on their own: 370 groups already make the footer; halving the rows doubles it.


### The basemap

`composeStyle(cartoStyle, { theme, tiles?, parts?, opacity?, land?, names?, baseLabels? })` (`basemap.ts`, a port of
CalCOFI explore's `composeStyle`) returns one style for `map.setStyle(style, { diff: true })`: CARTO's style with the
ocean moved to the bottom, the GEBCO sea floor as colour relief and igor hillshade from terrain-RGB tiers (`gebco-far`
at z0-5, `gebco` at z6-8, the `regional` tiers from z9; one tier draws a zoom, 0.3.4), isobaths gated by level and zoom (`CONTOUR_LEVELS`: 1000 m multiples from z0, 500 from
z5, 100-750 from z7, 50 from z9), the OSM land mask, the GEBCO undersea names, and CARTO's own text toned down, in both
themes. `dem: false` gives the boot style (first paint does not wait for terrain). `baseStyle(theme)` fetches CARTO's
style once.

The tiers live at `DEFAULT_TILES`, under `https://storage.oceanmetrics.io/basemap/<set>/v<BASEMAP_VERSION>/` (0.3.5: `BASEMAP_VERSION` is the build
date, `'20261023'`, and `tilesAt(version?, base?)` builds the six urls of a build; a `v<digits>/` folder is immutable at the storage Worker's
edge cache, so a rebuild is a new folder and a new `BASEMAP_VERSION`, never a rewrite; the unversioned `basemap/gebco/core.pmtiles` etc. stay for
0.3.4 and earlier). All are global except the regional
tier, built from GEBCO 2025 (`GEBCO_2025` grid, 15 arc-second, ice-surface version, downloaded 2026-10-23 from
`dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/`, 4.2 GB zip of eight GeoTIFFs) on the Mac mini by
`scripts/basemap/build_gebco.sh` (about 1 h 20 min end to end with 10 parallel blocks):

| part | url | zooms | tiles | bytes | what |
|---|---|---|---|---|---|
| far | `gebco/v20261023/far.pmtiles` | 0-5 | 1,365 | 205,342,212 (196 MB) | terrain-RGB, the globe; a small tier for first paint |
| core | `gebco/v20261023/core.pmtiles` | 0-8 | 87,381 | 5,690,322,235 (5.3 GiB) | terrain-RGB, the globe (z0-5 are far's tiles; z6 449.6 MB, z7 1.30 GB, z8 3.78 GB of PNG) |
| regional | `gebco/v20261023/core-sanctuaries.pmtiles` | 9-10 | 6,742 | 457,140,143 (436 MiB) | terrain-RGB, the 18 sanctuaries' boxes padded 1° (PMNM in two), z9 1,430 tiles, z10 5,312 |
| contours | `gebco/v20261023/contours.pmtiles` | 0-10 | 582,050 | 640,315,888 (611 MiB) | isobaths, source layer `contours` (`ele`, `level`): z0-6 the 500/1000 m lines of a ~4.6 km grid, z7-10 every level at the full 15" resolution, gated by zoom as `CONTOUR_LEVELS` |
| land | `osm/v20261023/land.pmtiles` | 0-10 | 610,484 | 161,505,661 (154 MiB) | OpenStreetMap land polygons (osmdata.openstreetmap.de, 2026-08-31 extract), source layer `land` |
| names | `gebco/v20261023/names.pmtiles` | 0-10 | 56,614 | 11,075,106 (10.6 MiB) | IHO-IOC GEBCO gazetteer, 5,412 records (2,632 points, 1,128 lines, 1,652 polygons as inside points), source layer `names` (`label`, `rank` 1-3) |

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
scripts/basemap/build_gebco.sh raw/gebco out upload        # versioned keys first (basemap/<set>/v<date>/), then the unversioned ones;
                                                           # both stores through om-publish.sh; UPLOAD_MODE=--dry-run only lists
```

The `upload` step takes the version from `BASEMAP_VERSION` or the newest archive's date, and publishes each set to
`basemap/<set>/v<date>/<file>.pmtiles` and then to `basemap/<set>/<file>.pmtiles`. A version folder is never rewritten
(om-publish exits 3 on other bytes under a date already published); a rebuild gets a new date, and then `BASEMAP_VERSION`
in `basemap.ts` and a new package version follow. The 2026-10-23 archives were copied server-side to their versioned
keys on both stores (`rclone copyto`, checked with `rclone check`).

Check a terrain tile against the source with `python3 -I scripts/basemap/check_tile.py <archive> <z> <lon> <lat> <gebco.tif>`
(from z8 a pixel is the bilinear source value rounded to 1 m: Monterey Bay z8 −461 m against −461.3 m; Stellwagen Bank
−87 m against −87.3 m; Maui z9 −1,325 m against −1,325.3 m). The scripts' rules (isobath levels and the zoom gate,
name ranks) are held to `basemap.ts` by `scripts/basemap.test.ts`.

**A global z9 would cost about 11-15 GB** (3-4 times z8's 3.78 GB: 262,144 tiles at 40-56 KB; the sanctuaries' z9 is 92
KB a tile, with the boxes on the shelf), taking core to about 17-21 GB and about 100 minutes of the same build: a later
decision. Until then z9 and z10 are core overzoomed outside the sanctuaries.

Since the storage cutover of 2026-10-23 (17:55 PT) `https://storage.oceanmetrics.io/basemap/...` is served by the Worker from R2 (206 by range, CORS); a resolver that still caches the old record of that host (a home router, for a few hours after the switch) sees msens' Caddy and its 404 for `basemap/`: the 404 noted earlier on the mini was that cache, not the host.
of the storage vhost in `MarineSensitivity/server` `caddy/Caddyfile` (`^/(marine-atlas|gazetteer|...|basemap)(/|$)`), a deploy on msens
that waits for Ben. The objects are in S3 (range reads answer 206 at `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/basemap/gebco/far.pmtiles`)
and mirrored in R2.

One tier draws one zoom (0.3.4; before it, far drew under core at z0-5 and far, core and the regional tier overlapped from
z6, so the relief was a little denser there and the first view fetched two archives for the same pixels). A layer's
`minzoom` is inclusive and its `maxzoom` exclusive: the far layers have `maxzoom: 6` (`CORE_MINZOOM`), the core layers
`minzoom: 6` and, while a regional tier is configured, `maxzoom: 9` (`REGIONAL_MINZOOM`), the regional layers `minzoom: 9`.
With `regional: []` core has no `maxzoom` and is overzoomed past z8. MapLibre fetches no tiles for a source whose layers
are all out of range, so the gate is also the saving; the isobaths (one archive, gated by level), the land mask and the
names are as before. `src/basemap.test.ts` asserts the ranges from the composed style at every quarter zoom from 0 to 10.

First view, bytes on the wire per tier, live archives, headless Chrome 156 on a real MapLibre 6.13 (`spikes/map-consumer`,
`node scripts/tiers.mjs before|after` after `npm run build` in both; it boots the README flow centred on Monterey Bay,
waits for idle and counts every response by archive, CARTO's style and tiles apart; results in `results/tiers-before.json`
and `tiers-after.json`). "Before" is 0.3.3 and "after" 0.3.4; each line is far / core (bytes, requests), the regional tier
costs one 16,384 B header read in both, and the idle tier of 0.3.4 costs one 16,384 B header read too.

| view | far before | far after | core before | core after | relief before | relief after | saved |
|---|---|---|---|---|---|---|---|
| 1280 px, z2 | 2,590,836 (10) | 2,590,836 (10) | 2,590,031 (11) | 16,384 (1) | 5,197,251 | 2,623,604 | 2,573,647 (49.5%) |
| 1280 px, z8 | 421,028 (3) | 16,384 (1) | 779,228 (10) | 779,228 (10) | 1,216,640 | 811,996 | 404,644 (33.3%) |
| 390 px, z2 | 1,796,037 (7) | 1,796,037 (7) | 1,795,252 (8) | 16,384 (1) | 3,607,673 | 1,828,805 | 1,778,868 (49.3%) |
| 390 px, z8 | 103,733 (2) | 16,384 (1) | 632,241 (8) | 632,241 (8) | 752,358 | 665,009 | 87,349 (11.6%) |

(relief = far + core + regional, the regional 16,384 B included.) With CARTO's style and tiles, the land mask and the
names the whole first view at z2 on a desktop screen went from 8,375,779 B to 5,802,141 B (390 px: 5,925,087 B to
4,146,197 B); at z8 from 1,776,036 B to 1,371,383 B (390 px: 1,345,824 B to 1,258,480 B). The tiers are read from the S3
host (`TIERS_BASE`), the same objects the storage host serves once `basemap` is allowed (the Open note above).

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
2026-10-23 at 0.2.0, 27 203 B with 0.2.1's fixes, 28 589 B at 0.2.3, budget 39 000 B (about 1.5×). Every module counts,
the h3 worker module and the COG and geotiff code included.

0.3.2: 45 109 B (42 836 B at 0.3.1): `h3Species.ts` and the new `tileParents`; the worker chunk 100 672 B (+457 B).

0.3.3: 47 148 B (+2 039 B: `h3Tap.ts`, the per-tile tally in the reader and `stats()` on the slot); the worker chunk 101 057 B (+385 B).

0.3.4: 47 403 B (+255 B: the tier ranges in `seaFloorLayers`); the worker chunk is unchanged (101 057 B).

0.3.5: 47 735 B (+332 B: `BASEMAP_VERSION` and `tilesAt`); the worker chunk is unchanged (101 057 B).

**0.3.0 raises the package budget to 48 000 B**: 41 877 B measured, +13.3 kB for the seven modules of the release
provider (`h3Bits`, `h3Zoom`, `h3ReleaseLayer`, `h3Release`, `h3Parquet`, `h3Stats`, `parquetFile`), comment-heavy as
the rest. What an app pays eagerly for `h3ReleaseSlot` is +5.2 kB minified over the base (h3Slot: +3.0 kB): the zoom
table moved to `h3Zoom.ts` so the slot does not pull h3-js onto the main thread (it did, +61.6 kB, before the move); the
reader runs in the worker and the legend reader is a lazy chunk of 20.9 kB (hyparquet's reader and fzstd).

**The h3 worker chunk is measured on its own line** (`scripts/h3-worker-size.mjs`: `src/h3Worker.ts` bundled with
rolldown, minified, gzip -9, one chunk; also `src/h3Worker.size.test.ts`): 76 808 B at 0.2.3, **100 215 B** at 0.3.0, budget
**110 000 B**. The growth is hyparquet's reader (16.7 kB bundled alone: its metadata path imports the geoparquet, wkb
and bloom modules unconditionally, so it does not tree-shake further), fzstd (3.4 kB, the release's ZSTD) and the
reader (about 3 kB). The week 4 plan held 100 kB as provisional ("measure, then set"); 110 000 is about 10% over the
measure. The atlas's static path and its 150 KB runtime-worker budget do not change: the chunk loads from the OBIS
layer's lazy chunk by a second `setupMapLibre({ h3WorkerUrl })`.

What an app pays, bundled and minified with its dependencies (rolldown, gzip -9, `maplibre-gl` and `pmtiles`
external, 2026-10-23):

| entry | eager | on demand |
|---|--:|---|
| `setupMapLibre` + `composeStyle` + the slot codec | 3.9 kB | the COG protocol (113 to 129 kB) on the first `cog://` request |
| + `gridSlot` | 4.5 kB | the same |
| + `cogSlot`, `legendFromStac`, `pointValue`, `overviewHistogram` | 22.2 kB (geotiff's core) | the protocol; geotiff's decoders (LERC, ZSTD, deflate ...) only for files that use them |
| + `h3Slot` | 3.9 kB | the tile builder (h3-js, geojson-vt, vt-pbf) only for an in-memory table |
| + `h3ReleaseSlot` | 9.0 kB (base + 5.2) | the legend reader (hyparquet, fzstd) 20.9 kB on the first legend |
| `@oceanmetrics/map/h3-worker` (in MapLibre's worker) | 100.2 kB (0.3.0, with the release reader; 76.4 kB at 0.2.x; 100.7 kB at 0.3.2; 101.1 kB at 0.3.3) | spike 1 measured 68.7 kB for the h3j code |
| `buildH3jArchive` (producers) | 65.2 kB | |

## Tests

`npm test` from the repo root. One test per rule with synthetic fixtures and no network: the key codec and its alias,
the setup against a stand-in MapLibre, the style's layer order and each contour level's `minzoom`, a theme switch
changing only the expected layers, the ramp stop counts, squares from a 2×2 lattice, the colour expressions, a
categorical legend, the 3857 guard, a legend from a synthetic STAC asset, a histogram and point values from an
in-memory GeoTIFF written with geotiff.js, the cog url, the h3 regression tests (tolerance 0 at z1, the unwrap and the
strip on the 55 crossing cells in `fixtures/h3/crossing55.json`, the lookup missing no cell, the resolution table),
an archive read back through `pmtiles`, the release provider over the synthetic release in `fixtures/h3release/`
(`build.mjs` writes it with h3-js and the DuckDB CLI: cell-sorted files with small row groups, the decade and year sets,
a res-6 split by res-2 parent, a whole taxon file, the 55 crossing cells, `stats.parquet`; served by a fetch that answers
as S3 does): file resolution per period set, the zoom to res to path table, row-group pruning (a tile under one of three
groups reads one), the cache (a second tile fetches nothing), the parent split and the whole-file fallback, the
multi-indicator MVT round trip, the crossing-55 seam, the legend's quantiles against the file, the slot's update rules on
a stand-in map, the bit-arithmetic parents against h3-js, `tileParents` against an h3-js derivation (the parents of
the cells that touch the tile, the Monterey Bay view at z9 and the two 0.3.1 regressions), `speciesForCell` over
`fixtures/h3release/species_flat/res=3.parquet` (a res-3 cell across two row groups, a res-1 cell's 49 children as one
run of the file, a res-5 cell's parent, the footer once per reader), and the worker chunk's size, and the consumer check's regressions (`water-inland` on protomaps-shaped tiles,
`carryLayers` across a style change, `basemapLayerIds` as the clear rule, a relative archive url made absolute).

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC. The h3j source is a port of INSPIDE/h3j-h3t (MIT, (c) 2020 INSPIDE) with
walkerke/mapgl PR 211's antimeridian fix; the basemap and ramps are ports of CalCOFI explore; the ramps' colours are
cmocean (MIT), viridis, oce's GEBCO and ColorBrewer (Apache 2.0).
