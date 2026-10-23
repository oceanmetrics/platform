# Changelog

## 0.4.0 (unreleased)

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
