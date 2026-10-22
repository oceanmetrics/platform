# CLAUDE.md

Guidance for Claude Code in `oceanmetrics/platform`: the shared TypeScript packages of the Ocean Metrics platform
(`@oceanmetrics/places`, `status`, `map`, `catalog`) as npm workspaces under `packages/`. Apps import these packages
and never each other. Until the first publish on Day 5 (2026-10-26) the apps link to this checkout as
`file:../platform/packages/<name>`; the packages export from `dist/`, so run `npm run build` before an app uses them.
Publishing is `scripts/publish.sh <otp>` (see the README, "Publishing").

**This repo is public from its first commit.** Never commit secrets, private emails or internal data: nothing from
`~/data/oceanmetrics/places-internal`, no Marine Regions copies, no PPOW geometry, in code or fixtures. Fixtures are
synthetic or from public sources.

## Commands

```sh
npm install
npm test                  # vitest, one root config over packages/*/src and packages/*/test (must be green to commit)
npm run typecheck         # tsc --noEmit per package
npm run build             # tsc to packages/*/dist
npm run size              # gzip budget per package (after build)
npx vitest run packages/status/src/ecoidx.test.ts   # one file
Rscript packages/status/fixtures/ecoidx/build_iea_sd_fixtures.R ~/Github/noaa-iea/ecoidx   # regenerate the iea-sd cross-check
```

## Architecture

- **`status` is the one implementation of every status method**: the only place a status, trend, sentence or alt text
  is computed. The indicators coverage builder and viewer import it. Python never computes a status.
- **`iea-sd` is ported from ecoidx `PlotTimeSeries()`, not `plot_ts()`.** The recent window is the last `recent` rows
  (NA rows count), the SD is the sample SD, a change of exactly 1 SD is not a change.
- **`places` is the gazetteer client** (moved from `oceanmetrics/places` `client/`); its tests serve `test/fixtures/`
  over a local HTTP server.
- **`catalog` holds the STAC layer profiles** and the values contract (`values-row`, `values-provenance`): one self-contained JSON Schema per profile in `packages/catalog/schemas/`,
  read at run time by `@oceanmetrics/catalog/validate` (ajv, Node only, never imported by the index) and by the Python
  `om_extract.schemas`. Fixtures in `fixtures/<name>/{valid,invalid}/`, the expected errors in `invalid.json`; the test
  discovers every schema.
- **`map` is the map stack** (0.2.0): the `LayerSlot` contract (`slot.ts`, moved from indicators), `setupMapLibre`, the
  basemap (`composeStyle`, ported from CalCOFI explore), the ramps, and the `grid`, `cog` and `h3` providers. It never
  imports `maplibre-gl` at run time (the app passes its module to `setupMapLibre`; types only elsewhere), so tests run
  without MapLibre; the COG protocol loads lazily and the h3 tile builder runs in MapLibre's worker
  (`@oceanmetrics/map/h3-worker`). The spike conditions are tests: geojson-vt `tolerance: 0`, the antimeridian unwrap on
  `fixtures/h3/crossing55.json`, the 3857 guard, legends from STAC only. The basemap tiers come from
  `scripts/basemap/build_gebco.sh`.
- **`engine` is the browser engine** (0.1.0): erddap-places' `gridMask`, `wkb`, `placeLobes`, `erddap`, `extent`, `fetchRetry`,
  `cells`, `toDataset`, the chunk rules and the five `sql/` templates moved in byte for byte (`test/moved.test.ts` proves it
  against the erddap-places checkout; `test/parity.test.ts` reproduces the 15 Python mask fixtures exactly), plus `Engine`
  over DuckDB-WASM (a peer; the app passes its module to `connectBrowser`), `runPreview` (the chunked live preview: 90 days
  or 100,000 values a request, `onChunk` in time order, abortable) and `sliceSource` for `@oceanmetrics/map`'s `gridSlot`.
  The SQL strings are generated into `src/sqlTemplates.ts` by `scripts/sql-templates.mjs` at build; a test fails when stale.
- Source imports use `.js` specifiers (`./grid.js`) so the emitted declarations and `dist/*.js` resolve for every consumer
  and for plain Node ESM (places 0.5.1 shipped without them); `scripts/esm-load.test.ts` builds and loads each `dist/index.js` in Node.

## Conventions

2-space indent, camelCase in TypeScript, lowercase comments, `----` section headings in long files. One test per rule
with a small synthetic fixture asserting exact output; a bug fix adds a named regression test. vitest must be green
before every commit. Size budgets are raised only with the reason written in the README. A version bump in a package
gets a CHANGELOG entry in the same change. The `log` skill records milestones in `~/Github/bbest/notes/om/`.
