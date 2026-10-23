# CLAUDE.md

Guidance for Claude Code in `oceanmetrics/platform`: the shared TypeScript packages of the Ocean Metrics platform
(`@oceanmetrics/places`, `status`, `map`, `catalog`) as npm workspaces under `packages/`. Apps import these packages
and never each other. Until the first publish on Day 5 (2026-10-26) the apps link to this checkout as
`file:../platform/packages/<name>`; the packages export from `dist/`, so run `npm run build` before an app uses them.
Publishing is the `publish` workflow (npm trusted publishing, `docs/publishing.md`); the token route,
`scripts/publish.sh <otp>` (README, "Publishing"), is retired once Ben revokes the token; `scripts/publish-check.mjs` lists what would publish.

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
  discovers every schema. Since 0.3.0 it also holds the **indicator cards**, one implementation for the indicators viewer
  and the places record page: `@oceanmetrics/catalog/indicators` (the readers of `indicators.json` and `coverage.parquet`,
  hyparquet, plus every card rule) and `@oceanmetrics/catalog/cards` (the pure rules alone: cards, the three absences, the
  OBIS fold, Reproduce, rollups). The root index stays types and constants. The status words come from `status`.
- **`catalog/storage` is the one storage url rule** (0.5.1): the hosts as constants, `DEFAULT_STORAGE_HOST` (path-style
  S3 until the DNS cutover flips it), `storageUrl()`, `rewriteStorageUrls()`; no app keeps a base url of its own. The
  python twin `om_extract.storage` runs the same `fixtures/storage/cases.json`. Uploads go through
  `scripts/om-publish.sh` (both stores, never a delete; tested with the fakes in `scripts/om-publish/fake/`).
- **`map` is the map stack** (0.3.0): the `LayerSlot` contract (`slot.ts`, moved from indicators), `setupMapLibre`, the
  basemap (`composeStyle`, ported from CalCOFI explore), the ramps, and the `grid`, `cog` and `h3` providers; the `h3`
  kind also reads a release itself (`h3ReleaseSlot`: the obis-h3 Parquet in the worker over `h3r://`, row groups pruned
  by `cell_id` statistics, tested on the synthetic release in `packages/map/fixtures/h3release/`; its worker chunk has
  its own size line). It never
  imports `maplibre-gl` at run time (the app passes its module to `setupMapLibre`; types only elsewhere), so tests run
  without MapLibre; the COG protocol loads lazily and the h3 tile builder runs in MapLibre's worker
  (`@oceanmetrics/map/h3-worker`). The spike conditions are tests: geojson-vt `tolerance: 0`, the antimeridian unwrap on
  `fixtures/h3/crossing55.json`, the 3857 guard, legends from STAC only. The basemap tiers come from
  `scripts/basemap/build_gebco.sh`.
- **`engine` is the browser engine** (0.1.1): erddap-places' `gridMask`, `wkb`, `placeLobes`, `erddap`, `extent`, `fetchRetry`,
  `cells`, `toDataset`, the chunk rules and the five `sql/` templates moved in byte for byte (`test/moved.test.ts` proves it
  against the erddap-places checkout; `test/parity.test.ts` reproduces the 15 Python mask fixtures exactly), plus `Engine`
  over DuckDB-WASM (a peer; the app passes its module to `connectBrowser`), `runPreview` (the chunked live preview: 90 days
  or 100,000 values a request, `onChunk` in time order, abortable) and `sliceSource` for `@oceanmetrics/map`'s `gridSlot`.
  The SQL strings are generated into `src/sqlTemplates.ts` by `scripts/sql-templates.mjs` at build; a test fails when stale.
- **`nav` is the one bar of the apps and the site** (0.2.0, decision D7): `<om-nav>`, a framework-free custom element
  in Shadow DOM. Since 0.2.0 it is also the one analytics loader (`src/ga.ts`, `data-ga`, `@oceanmetrics/nav/ga`): no
  GA id in any repo, every hit a rebuilt `page_location` (README "Analytics"). The rules are pure in `items.ts` (items, search url, collapse, scheme); colour values live only in
  `tokens.ts` (each role: `--om-nav-<role>`, then the host's semantic token, then the brand light-dark() pair); the mark
  and glyphs are generated into `src/glyphs.ts` by `packages/nav/scripts/glyphs.mjs` from the site checkout's brand kit
  (a test fails when stale). The element tests run in happy-dom (`// @vitest-environment happy-dom`); `dist/index.js`
  loads in plain Node (the class extends an empty base without a DOM).
- **`workers/alerts/` is the `om-alerts` Worker** (a workspace, not a package: private, never published): the email
  alerts over the indicators change files, filtered by `@oceanmetrics/catalog/report` (the rules the Report view
  expands). Its tests run in workerd (`@cloudflare/vitest-plugin`) from its own `npm test`, which the root `npm test`
  runs after the packages' vitest. No address in any file but `alerts@mail.oceanmetrics.io` and RFC 2606 examples
  (`scripts/no-addresses.mjs`); the KV `ALERTS` holds the list, addresses AES-GCM encrypted; secrets only via
  `wrangler secret put`. Its README has the routes and the runbook.
- **`workers/usage/` is the weekly usage script** (a workspace, not a Worker): `usage.mjs` posts the Analytics Engine SQL
  (`om_gazetteer` per prefix, `om_alerts` routes and digests) for 7 and 30 days, prints a Markdown table and writes
  `<out>/usage/<date>.json` outside the repo. The token `CF_AE_TOKEN` comes from the environment or `~/.config/oceanmetrics/cf-ae.env`,
  never the repo. Plain Node, no dependency; its README has the token scope and the launchd plist.
- Source imports use `.js` specifiers (`./grid.js`) so the emitted declarations and `dist/*.js` resolve for every consumer
  and for plain Node ESM (places 0.5.1 shipped without them); `scripts/esm-load.test.ts` builds and loads each `dist/index.js` in Node.

## Conventions

2-space indent, camelCase in TypeScript, lowercase comments, `----` section headings in long files. One test per rule
with a small synthetic fixture asserting exact output; a bug fix adds a named regression test. vitest must be green
before every commit. Size budgets are raised only with the reason written in the README. A version bump in a package
gets a CHANGELOG entry in the same change. The `log` skill records milestones in `~/Github/bbest/notes/om/`.
