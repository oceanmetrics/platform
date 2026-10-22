# @oceanmetrics/engine

The browser engine of Ocean Metrics: a live series for any polygon × ERDDAP grid. The place mask (which grid cells a
polygon covers, with partial-area weights), the lobe split at ±180, the ERDDAP request URLs, the SQL templates shared
with the Python engine (`om_extract`), DuckDB-WASM as the statistics engine, the chunked live preview and the map's grid
slice. TypeScript, ESM.

```ts
import { Engine, connectBrowser, placeLobes, lobeAxes, runPreview, sliceSource, toDataset } from '@oceanmetrics/engine'
```

**One rule, two engines.** The browser (this package, DuckDB-WASM) and the precompute and extractions (`om_extract`,
native DuckDB in Python) run the same mask arithmetic and the same SQL text, and the tests hold them to it: the mask
reproduces the fixtures in `extract/tests/fixtures/mask/` row for row with `===`, and `sql/*.sql` are byte-identical to
`om_extract/sql/` (see "Tests").

**Consumers.** `indicators` is the first (build week 2 step 2c): its Map's `grid` slot reads `sliceSource()` and its
live preview runs `runPreview()`. erddap-places' code is the frozen original: the app keeps its own copies of these
modules until its redirect to indicators at the end of build week 2, and nothing here edits it.

## What moved

From `oceanmetrics/erddap-places` on 2026-10-23 (app 0.3.12, commit 3b1868a):

| here | from | what changed |
|---|---|---|
| `src/mask.ts` | `app/src/lib/gridMask.ts` | nothing: byte for byte (its sha256 is the one the parity fixtures record) |
| `src/wkb.ts` | `app/src/lib/wkb.ts` | nothing: byte for byte |
| `src/lobes.ts` | `app/src/lib/gazetteer.ts` `placeLobes`, `Lobe` | `placeLobes()` word for word; it reads `LobePlace` (`place_id`, `geometry`), the slice of the gazetteer's `Place` it uses |
| `src/erddap.ts` | `app/src/lib/erddap.ts` | `.js` import specifiers only |
| `src/extent.ts` | `app/src/lib/extent.ts` | `.js` import specifiers only |
| `src/fetchRetry.ts` | `app/src/lib/fetchRetry.ts` | `.js` import specifiers only |
| `src/cells.ts` | `app/src/lib/cells.ts` | nothing (`@oceanmetrics/map` `grid.ts` has its own port of `cellSquares`; `cellPoints` and `placeMapBounds` live here) |
| `src/dataset.ts` | `app/src/lib/catalog.ts` | the pure functions word for word (`toDataset`, `valueExpr`, `statsTemplate`, `lobeLonSpan`, `resolveDataset` ...); `loadDatasets` (reads the gazetteer's catalog.json) and `linkMismatch` (the app's wording) stay in the app |
| `src/chunks.ts` | `precompute/src/stats.ts` `window`, `chunks`, `chunkDaysFor`; `precompute/src/targets.ts` `MAX_CHUNK_DAYS`, `MAX_REQUEST_VALUES` | `chunks()` word for word; `chunkDaysFor()` takes the two limits as options (defaulting to 90 and 100,000); `window()` defaults to `'all'` (the precompute's `DAYS`) |
| `src/sql.ts`, `sql/*.sql` | `app/src/lib/sql.ts`, the repo-root `sql/` | the templates come from `src/sqlTemplates.ts`, generated from `sql/*.sql` by `scripts/sql-templates.mjs` (run by `npm run build`), instead of Vite's `import.meta.glob`; `lit` and `render` unchanged |
| `src/engine.ts` | `app/src/lib/engine.ts` | the app boots DuckDB, not the package: `new Engine(connect)` with `connect() -> { db, conn }`, and `connectBrowser(duckdb, bundles)` for a browser; no `engine` singleton; `toRows` scales DECIMAL columns (below) |
| `src/preview.ts` | new: the precompute's `maskLobe` and `computeOne` chunk loop, for the browser | |

The moved tests came with them (`gridMask`, `wkb`, the lobe cases of `gazetteer`, `erddap`, `tabledap`, `extent`,
`sql`, `cells`, `catalog`, `maskPerf`, `fetchRetry`, and the precompute's `window`/`chunks`/`chunkDaysFor` cases), with
the fixtures `fixtures/{CINMS,FKNMS,HIHWNMS,PMNM}.geojson` (NOAA sanctuary boundaries), the Seascapes info table and ten
published STAC Collections (`fixtures/stac/`).

Not moved, and why:

- the live-network halves of `erddap.test.ts`, `extent.test.ts`, `catalog.test.ts`, `gazetteer.test.ts` and
  `maskPerf.test.ts` (PacIOOS, the gazetteer bucket): this package's tests run offline;
- `maskPerf.test.ts`'s Svelte-proxy case (`plainPlace` unwrapping `$state`): a Svelte concern, it stays in the app;
- the lobe cases on the gazetteer's `places.parquet` run here on the GeoJSON fixtures instead (the same PMNM and FKNMS);
- the gazetteer readers (`loadPlaces`, `placeGeometry`, `unionBbox`, `placeBbox`): they read the places gazetteer
  (`@oceanmetrics/places`), not a grid;
- the precompute's disk cache (`planChunks`, `computeOne`, `maskKey`, the provenance): Node only, they belong to the
  precompute (now `om_extract`);
- the tabledap run (`pointMask` and `tabledapUrl` moved; the preview is griddap only, as the vision's row is).

## The SQL contract shared with Python

Five templates in `sql/`, rendered by `render(name, params)` (`{{expr}}`, `{{slab}}` and `{{mask}}` spliced as they
are, any other param quoted as a literal by `lit`):

| template | over | one row per | columns |
|---|---|---|---|
| `stats_daily` | a griddap slab | UTC day | `date, n, mean, mean_wt, sd, min, max, p10, p90, weight_sum` |
| `stats_categorical` | a categorical griddap slab | day × class | `date, class, n, weight, fraction, percent_cells` |
| `last_step` | a griddap slab | masked cell of the last step | `date, latitude, longitude, weight, value` (value NULL where the step has no data) |
| `stats_tabledap` | a tabledap slab | month | `date, n, n_casts, mean, sd, min, max, p10, p90` |
| `points_tabledap` | a tabledap slab | station | `latitude, longitude, weight, value, n, date` |

- `{{expr}}` is the value expression over the slab alias `s` (`valueExpr()`: `s."CRW_SST"`, or `(s."analysed_sst" -
  273.15)` for Kelvin); `{{slab}}` a registered Parquet file or a subquery; `{{mask}}` a table of `latitude, longitude,
  weight` (0, 1].
- The join is an exact equality on `ROUND(x, 3)` (grids) or `ROUND(x, 5)` (stations): ERDDAP's axis is float32 in the
  Parquet, the mask float64.
- Days come from `epoch_ms(time)`, because DuckDB-WASM ships without ICU (`TIMESTAMPTZ::DATE` is unimplemented there).
- `om_extract/sql/` carries byte-identical copies of `stats_daily`, `stats_categorical` and `last_step` (the tabledap
  two have no Python reader yet); `test/sql.test.ts` compares the bytes when the extract and erddap-places checkouts sit
  beside platform. A change to a template is a change in all three repos.

## The preview rule

```ts
const ds    = toDataset(collection)                         // a STAC erddap/* Collection
const v     = ds.variables[0]
const lobes = placeLobes(place)                             // one griddap request per lobe
const axes  = await lobeAxes(ds, lobes, { signal })         // each lobe's axis vectors from the server
const { cells } = lobeMasks(ds, lobes, axes)                // mask once, share it with the slice
const run = await runPreview({
  dataset: ds, variable: v, axes, mask: cells, t0: '2016-01-01', t1: '2026-10-20', engine, extent, signal,
  onChunk: (rows, chunk) => chart.append(rows),             // oldest first, as each lands
})
```

- **The chunk rule is the precompute's.** `previewWindow(cells, stepDays, { maxValues = 100_000, maxDays = 90 })` is
  `chunkDaysFor`: at most 90 time steps a request (a coarser grid counts its own steps: 90 months of a monthly product),
  shrunk so one request (one lobe) stays under 100,000 values (extractr's `n_max_vals_per_req`), never under one step.
  `cells` is the largest lobe's lon × lat axis cells. A long window is `chunks(t0, t1, days)`, consecutive and
  non-overlapping.
- **Each chunk is the precompute's chunk.** One griddap Parquet request per lobe (`griddapUrl`, the lobe's axes as the
  bounds, the extent's own instants at the window's two ends via `timeInstant`), registered in DuckDB-WASM, read as
  `(SELECT DISTINCT * FROM read_parquet([...]))`, aggregated with `stats_daily` or `stats_categorical`
  (`statsTemplate(v)`), then dropped.
- **Drawn as they land, in time order.** Up to `concurrency` (default 2, the precompute's) requests are in flight, the
  next chunk fetched while this one aggregates, and `onChunk` is called strictly in time order. A step that two chunks
  snap onto (a coarse axis) is given once, as the precompute's DISTINCT merge does. `date` comes back as `yyyy-mm-dd`.
- **Abortable.** `signal` cancels the in-flight requests, nothing after the abort reaches `onChunk`, and the promise
  rejects with the signal's reason. The run's mask table (`preview_mask_<n>`) and slabs are dropped either way.
- Griddap and Parquet only: a tabledap dataset or a server without Parquet (`pickFormat` gave `csvp` or `jsonp`) is
  refused with a message. A mask with no cells asks the server nothing.

**The map's slice.** `sliceSource({ dataset, variable, lobes | mask, axes, engine, extent })` is a `SliceSource` for
`@oceanmetrics/map`'s `gridSlot(spec, source)`: `slice(t)` fetches the one step `t` (a day or an ISO instant;
`null` is the extent's end, or ERDDAP's `last` without an extent) of every lobe and returns `last_step`'s rows as
`{ lat, lon, value, weight }`, the mask's own centres, a cell without data kept with `value: null`. The mask goes into
the engine once, at the first slice.

## DuckDB-WASM: the peer and the worker setup

`@duckdb/duckdb-wasm` (>= 1.29, < 2; the apps pin 1.29 or 1.32) and `apache-arrow` (>= 17, which DuckDB-WASM itself
depends on) are peer dependencies: the package imports only `apache-arrow` at run time (the mask's Arrow IPC insert)
and never loads DuckDB itself. The app owns the bundles and the Web Worker, and hands the engine a `connect()`:

```ts
// a Vite app: the wasm and worker files served from the app's own origin
import * as duckdb from '@duckdb/duckdb-wasm'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import { Engine, connectBrowser } from '@oceanmetrics/engine'

export const engine = new Engine(() => connectBrowser(duckdb, {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh : { mainModule: ehWasm,  mainWorker: ehWorker  },
}))
```

`connectBrowser` is erddap-places' boot: `selectBundle` (eh where the browser has exceptions, else mvp), a `Worker` on
the bundle's worker script, `AsyncDuckDB.instantiate`, one connection. `new Engine()` connects at once, so construct
it (or `import()` the module that does) when the app first needs it, keeping the 7 MB of WASM off the first paint. One
connection, and every call queued on one promise chain: a query never runs before an earlier insert has finished. Any
`{ db, conn }` with the methods `DuckDbLike` and `DuckConnLike` name works; the tests use the node-blocking bundle
(`test/helpers/nodeDb.ts`).

`toRows` scales DECIMAL columns: DuckDB-WASM hands a DECIMAL back as its unscaled integer, so erddap-places' engine
would have read `points_tabledap`'s `1.0 AS weight` as 10 (the app reads `n` there, so nothing on screen was wrong).

## Size

`npm run size` measures the gzipped sum of `dist/**/*.js` (comments included, before an app minifies): 26 794 B on
2026-10-23 at 0.1.0, budget 40 000 B (about 1.5×). Only this package's own modules count: DuckDB-WASM and Apache
Arrow are peers, and turf is a dependency the app's bundler adds (as `@oceanmetrics/map`'s geotiff is). The five SQL
templates do count (`sqlTemplates.js`, 2 285 B on their own).

What an app pays, bundled and minified with its dependencies (rolldown, gzip -9, `apache-arrow` and
`@duckdb/duckdb-wasm` external, 2026-10-23):

| entry | gzip |
|---|--:|
| the URLs and the dataset (`griddapUrl`, `tabledapUrl`, `pickFormat`, `fetchTimeExtent`, `toDataset`, `chunks`) | 2.6 kB |
| the mask (`gridMask`, `placeLobes`, `wkbToGeoJSON`, with turf) | 5.7 kB |
| the preview and the slice (`Engine`, `connectBrowser`, `placeLobes`, `lobeAxes`, `runPreview`, `sliceSource`, `toDataset`) | 12.7 kB |
| everything | 16.2 kB |

## Tests

`npm test` from the repo root. One test per rule with synthetic fixtures and no network:

- **Parity with Python** (`test/parity.test.ts`): the 15 cases of `extract/tests/fixtures/mask/*.json.gz` (written by
  erddap-places' TypeScript through `make_expected.mjs`, and reproduced by `om_extract.mask`): the same WKB through
  `wkbToGeoJSON`, `placeLobes` and `gridMask` gives the same lobes and every row (76,774 in 18 lobes) in order, weights
  by `===`. The fixtures' recorded sha256 of `gridMask.ts`, `wkb.ts` and `placeLobes()` must be those of this package's
  sources, and turf's version theirs. Skipped, with the reason, when the extract checkout is not beside platform
  (`OM_EXTRACT_DIR` overrides) or when this CPU's `Math.sin` differs from the fixtures' arm64 generator
  (`v8_sin.json.gz`).
- **The originals** (`test/moved.test.ts`): the modules against erddap-places, byte for byte or function for function,
  when that checkout is beside platform (`OM_ERDDAP_PLACES_DIR` overrides).
- **The SQL** (`test/sql.test.ts`): `sqlTemplates.ts` is current, `sql/` is byte-identical to erddap-places' `sql/` and
  `om_extract/sql/`, and erddap-places' `sql.test.ts` cases (they ran the native duckdb CLI) run in DuckDB-WASM.
- **The engine** (`test/engine.test.ts`): on `fixtures/slabs/stats_3x3x2.parquet` (extract's `test_stats.py` slab,
  written by pyarrow with float32 axes: `python fixtures/slabs/make_slabs.py`) and its diagonal mask, `stats_daily`,
  `stats_categorical` and `last_step` give that test's hand-computed rows exactly; the queue survives a failed query;
  DECIMAL is scaled; `connectBrowser` boots in order.
- **The preview** (`test/preview.test.ts`): an injected fetch serves the slabs cut by a second DuckDB-WASM: the chunk
  boundaries (90 days, the value cap), `onChunk` in time order when a later chunk lands first, two lobes unioned
  DISTINCT, a snapped step given once, the Python numbers through the whole chain, abort mid-chain and during a hung
  request, the slice rows, `slice(null)`.
- the moved unit tests beside each module in `src/`.

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC. The sanctuary boundary fixtures are NOAA Office of National Marine
Sanctuaries data (public domain).
