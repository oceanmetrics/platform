# Changelog

## 0.6.0 (unreleased)

- **`DEFAULT_STORAGE_HOST` is now `STORAGE_HOST` (`https://storage.oceanmetrics.io`)**, the one-line flip of build week
  6 step 0. Why: the storage cutover of 2026-10-23 is done: `storage.oceanmetrics.io` is served by the om-gazetteer
  Worker from R2 (a Custom Domain, no longer Caddy's 302 to S3) and `platform/scripts/storage-check.sh` passes 21 of 21
  on it (range reads with `Content-Range`, the CORS preflight, content types, keyed and restricted prefixes). Every
  `storageUrl()` without a host, and every app that passes no `VITE_OM_STORAGE` / `OM_STORAGE` / `data-om-storage`,
  now reads the bucket from the storage host at its next build. The default changes, so this is a minor bump for a
  0.x package. Rollback per app: set the override to `s3`; for all: flip the line back in a release.
- `DEFAULT_INDICATORS_BASE` is `${DEFAULT_STORAGE_HOST}/indicators/` (the same value as before,
  `https://storage.oceanmetrics.io/indicators/`), so it follows the one setting instead of keeping a host of its own.
- The case table `fixtures/storage/cases.json`: the two default-host cases expect the storage host (the python twin
  `om_extract.storage` 0.6.3 flips with it).

## 0.5.1 (unreleased)

- `@oceanmetrics/catalog/storage` (new, pure, no dependency; build week 6 step 0): the one rule for where the public
  bucket is read. The hosts `STORAGE_HOST` (`https://storage.oceanmetrics.io`), `S3_PATH_STYLE`
  (`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public`), `S3_VIRTUAL_HOST`, `WORKER_PREVIEW` (the om-gazetteer
  Worker on workers.dev) and `STORAGE_HOSTS` by name; `DEFAULT_STORAGE_HOST` (path-style S3 until the DNS cutover,
  which flips this one line); `STORAGE_ENV` (the override each app reads once: `VITE_OM_STORAGE`, `OM_STORAGE`, the
  `data-om-storage` attribute); `parseStorageHost`, `resolveStorageHost(...candidates)`, `storageUrl(key, { host?,
  apiKey? })`, `rewriteStorageUrls(text | json, { from, to })`, `rewriteStorageUrlsCounted` and `countStorageUrls`.
  A url on any other host (Marine Regions, ERDDAP, a host that only begins with a storage host's name) is never changed.
- The case table `fixtures/storage/cases.json`, which the python twin `om_extract.storage` (oceanmetrics/extract 0.6.1)
  is held to as well.
- `om-catalog rewrite-storage --from <host>[,<host>] --to <host> [--write] <file...>`: the urls each file would move, a
  total, and with `--write` the files rewritten in place (scripts/om-publish.sh `rewrite` calls it).

## 0.5.0 (unreleased)

- `@oceanmetrics/catalog/changes` (new, pure): `diffCoverage(before, after, { seen?, manifest? })` -> `ChangeRow[]`, one
  row per place x indicator at the card's row, of kind `new` (a first value), `status` (the status word changed) or
  `period` (a later period); `changeSentence(row, manifest?)`, the one wording for feeds, mails and the front page;
  `atomFeed(rows, { title, id, updated, link, self?, subtitle?, max? })` (RFC 4287, stable entry ids `entryId`);
  `feedsFor(rows, { places, sets?, colls? }, { base?, appUrl? })` (all, `coll=`, `set=`, `place=` feeds) and
  `feedsIndex`; `countKinds`, `mergeChanges`, `changeKey`, `feedFile`, `CHANGE_KINDS`.
- `@oceanmetrics/catalog/report` (new, pure): the selection rules moved from oceanmetrics/indicators `src/report/spec.ts`
  (`matchPlaces`, `expandPlaces`, `matchIndicators`, `expandIndicators`, `seriesLeads` and their types), plus
  `rulesFromParams`/`rulesParams` (the `pi px ii ix` keys, `DEFAULT_RULES`), `selectRows` and `matchesRules` (the rows a
  watch selects). `IndicatorLike.category` is optional.
- Four schemas join `PROFILES`, each with valid and invalid fixtures: `changes-row`, `changes-latest`, `feeds-index`,
  `alerts-subscription` (no address: a plain `email` key fails).
- A test fails on any address in `fixtures/` outside example.org, example.com and oceanmetrics.io.
- Size budget 15 000 B (was 10 000; measured 11 610), the reason in the README.

## 0.4.0

- The `h3` profile 1.1 (`$id` `https://oceanmetrics.io/schemas/h3/v1.1.0/schema.json`), for the obis-h3 release as one
  STAC collection with decades and years (build week 4, step 1). Every new field is optional, so the v20261012 shape
  (one period set) stays valid:
  - `h3:periods` may be a list of period sets (e.g. decade and year, res 1 to 5 each), each with its own
    `placeholder` and `resolutions` (required in a list) and maybe its own `template`; a single set may carry
    `resolutions` too.
  - `h3:species_table.columns` gains `year_min` and `year_max` (each requires the other) and `period` (the decade
    variant's column).
  - `h3:heads` `{layer, href?}`: the layer key the pre-aggregated heads are published under (e.g. `taxon`).
  - `h3:layout.row_group_rows`: the most rows a row group holds, so a reader knows a range read pays.
  - Fixtures: `valid/obis_h3_decades_and_years.json`; `invalid/period_set_without_placeholder.json`,
    `period_set_without_resolutions.json`, `species_year_min_without_year_max.json`, `heads_without_layer.json`,
    `row_group_rows_zero.json`.
- Types: `H3Periods` gains `resolutions?` and `template?`; new `H3PeriodSet` and `H3Heads`; `H3Fields['h3:periods']`
  is `H3Periods | H3PeriodSet[]` and gains `'h3:heads'`; `H3Layout.row_group_rows`; `H3SpeciesTable.columns` gains
  `name_key`, `year_min`, `year_max`, `period`, and the table `heads`.
- The `om-catalog` CLI is unchanged.

## 0.3.0 (unreleased)

- The indicator cards, one implementation for the indicators viewer and the places record page (moved from places
  `web/src/lib/indicators.ts` and the viewer's `place.ts`/`delivery.ts`), in two subpaths; the root index stays types
  and constants (511 B gzip) and re-exports their types:
  - `@oceanmetrics/catalog/indicators`: `loadManifest(base, fetch?)`, `loadCoverage(base, { columns?, placeId?, fetch? })`
    (hyparquet column projection, `COVERAGE_COLUMNS` by default, int64 as plain numbers), and everything in `/cards`.
  - `@oceanmetrics/catalog/cards` (pure, no parquet): `cardsFor(rows, manifest, { placeId, leadsOnly?, base?, appUrl? })`
    -> `IndicatorCard[]` (value, period by grain, status word and glyph class, trend, caption, sentence, method label
    and note, citation with the place clause, the Place view link, the Reproduce block), leads first then by series;
    `absenceFor` (`nodata` | `notcomputed` | null) and `absenceText` (the three texts; the dated sentence is the caller's
    `note`); `foldSeriesWithoutRule` (the OBIS fold line, its count and how many stay above); `slotFor` (`shownFirst`
    a parameter, `SHOWN_FIRST` 6); `rollups(rows)` (above, within, below, no status and no data per place and per
    indicator, with the latest period: the Matrix summary); `coverageFor`, `pickRow`, `periodOf`, `methodLabel`,
    `methodNote`, `placeCitation`, `datasetCitation`, `placeViewHref`, `erddapPlacesHref`, `valuesUrl`, `duckdbSnippet`,
    `configLines`, `configHash` (FNV-1a, the same hashes as the viewer's `delivery.ts`), `reproduceFor`, `footerLine`.
  - Types: `IndicatorsManifest`, `ManifestIndicator`, `CoverageRow`, `IndicatorCard`, `Reproduce`, `Absence`, `Rollups` ...
- Dependencies: `hyparquet` (only `/indicators` imports it) and `@oceanmetrics/status` ^0.1.1 (the status words).
- `h3` profile: `h3:species_table.columns.name_key` (richness counts species names, several aphiaids may share one) and
  `h3:species_table.heads` (the pre-aggregated heads JSON), both optional; found by the obis-h3 exporter of build week 1.

## 0.2.0

- The STAC layer profiles, one JSON Schema each in `schemas/` (draft 2020-12, `$id`
  `https://oceanmetrics.io/schemas/<name>/v1.0.0/schema.json`): `erddap-grid`, `cog`, `h3`, `atlas-collection`,
  `atlas-item`, `sdm-dossier`, beside the existing `om-notebook`. Each with valid and invalid fixtures in `fixtures/`.
- `@oceanmetrics/catalog/validate` (Node only, ajv 8 + ajv-formats): `listProfiles()`, `loadSchema(name)`,
  `validate(name, doc)` -> `{ ok, errors }`, errors as `<json pointer>: <message>`.
- The values contract 1.2.0 as two schemas, moved from oceanmetrics/indicators `schema/`: `values-row` (one row of a
  values file; `time` null exactly when `time_grain` is `all` is now a schema rule) and `values-provenance` (its
  `om:provenance` metadata, `dataset` required from 1.2). Both join `PROFILES`.
- The `om-catalog` bin: `om-catalog profiles`, `om-catalog validate <profile> <file...>` (exit 1 when a file fails).
- The index exports `PROFILES` and the field types of every profile (`ErddapGridFields`, `CogBand`, `H3Fields`,
  `AtlasCollectionFields`, `AtlasItemProperties`, `SdmFields` ...), types only. `schemas/` ships in the package.

## 0.1.0

- Scaffold: the `PACKAGE` constant and one test.
