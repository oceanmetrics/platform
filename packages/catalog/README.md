# @oceanmetrics/catalog

The catalog contracts of Ocean Metrics: the **STAC layer profiles**, one JSON Schema per kind of layer, with their
TypeScript types, a validator and the `om-catalog` command; the **values contract** (`values-row`,
`values-provenance`); and the **indicator readers and cards** (0.3.0), the one implementation of a place's indicator
cards that the indicators viewer and the places record page share.

Each profile constrains only `type`, `stac_version`, `id` and its own fields. STAC core (links, extent, geometry ...) is
checked elsewhere (rashid), so every other key passes through at the top level and in `properties`; the objects the
profiles define themselves (`atlas:flower`, `h3:layout`, `sdm:evaluation` ...) allow no extra keys.

## Profiles

- **`erddap-grid`**: a STAC Collection for one ERDDAP dataset, referenced in place. Written by erddap-places
  `catalog/build_erddap_collections.ts`; read by erddap-places `app/src/lib/catalog.ts` and by the extract engine
  (Day 4). Rules: type Collection; `stac_extensions` declares datacube 2.2.0; `erddap:base_url` (a URI),
  `erddap:dataset_id`, `erddap:protocol` (griddap or tabledap), `erddap:version` (a string), `erddap:cors`,
  `erddap:formats` (at least one), `erddap:lon_range` (two numbers) and `erddap:lat_descending` are required;
  `cube:dimensions` has `time` (`extent` [string, string or null]) and, for griddap only, `latitude` (axis y) and
  `longitude` (axis x) with numeric extents, and maybe `depth` (axis z); every `cube:variables` entry has `dimensions`,
  `type` (data or auxiliary) and `unit` (a string or null), and a categorical one labels its classes with strings;
  at least one asset has roles including `data` and type `application/vnd.apache.parquet` (its href is the query
  template, not parsed). `erddap-places:status` is `pending` only; `erddap-places:long_format` is exactly
  `{type_column, value_column}`. The `erddap-places:` keys keep their published prefix; renaming them to `erddap:` is a
  build week 1 migration, done with the writer and the reader together.
- **`cog`**: a STAC Item whose data asset is a Cloud-Optimized GeoTIFF the map reads in the browser (build week 2).
  Written by the atlas pipeline, `workflows/R/eov_share.R` and erddap-places Then vs Now; read by the atlas and
  `@oceanmetrics/map`. Rules: type Feature; `properties.proj:code` is `EPSG:<n>` (any code: everything is EPSG:4326
  today, EPSG:3857 copies are a build week 2 decision); at least one asset has roles including `data` and type
  `image/tiff; application=geotiff; profile=cloud-optimized`, and lists its bands as `bands` (STAC 1.1 core) or
  `raster:bands` (raster 1.1); each band has `data_type` (the raster extension's values), `nodata` (a number, `nan`,
  `inf`, `-inf` or null) and `statistics` with `minimum` and `maximum`, written at publish so the legend needs no
  server; a `histogram` has `count`, `min`, `max` and integer `buckets`. On any asset `atlas:bidx` is an integer >= 1,
  `atlas:rescale` is [n, n] or `auto`, `atlas:colormap` a name.
- **`h3`**: a STAC Collection for a layer on the H3 grid: the obis-h3 release as an atlas collection (build week 4),
  the hex twins, BioTrack. Rules: type Collection; `h3:resolutions` (unique, each 0 to 15, at least one),
  `h3:cell_column`, `h3:cell_type` (string or uint64), `h3:layout` and `table:columns` (each with `name` and `type`)
  are required; `h3:layout.template` contains `{res}`, `parent_template` contains `{res}` and `{parent}`, `parent_res`
  maps a resolution to its parent's (coarser, a reader check), `keys` names the other placeholders, and
  `row_group_rows` (an integer >= 1, optional) is the most rows a row group of a cell-sorted layer file holds, so a
  reader knows a range read of the groups under a tile's parents pays. `h3:periods` is one period set (`grain` decade,
  year, month or all, `values`, `placeholder`, maybe `resolutions`), the 1.0 shape the v20261012 release has, or a list
  of sets (1.1: decades and years in one collection, one period strip), each with its own `placeholder` and its
  `resolutions` (required in a list), and maybe a `template` (with `{res}`) when its path differs from
  `h3:layout.template`. The species x hex x count table `h3:species_table` needs `href_template` (with `{res}`),
  `resolutions`, `partition_by`, `columns` (`cell`, `species`, `count`, maybe `year`, `name_key`, `year_min` and
  `year_max` (together: the Cell pane's first and last year), and `period` (the decade variant's column)) and `lookup`
  (`href`, `key`, `lineage_column`, maybe `rank_columns` and `name_column`); `sorted_by` defaults to `["h3"]`.
  `h3:heads` (1.1) is `{layer, href?}`: the layer key the pre-aggregated heads (Animalia and every taxon spanning
  several classes) are published under as ordinary layers, e.g. `taxon`, and the JSON listing them. Profile 1.1 only
  adds optional fields, so a 1.0 document stays valid; its `$id` is `.../h3/v1.1.0/schema.json`.
- **`atlas-collection`**: the atlas hooks of a Collection, all optional, each in the shape `atlas/src/lib/catalog/*.ts`
  parses. Written by the atlas pipeline and `workflows/R/eov_share.R`. Rules: `atlas:funders` strings,
  `atlas:access` `restricted` only, `atlas:note` a string; `atlas:flower` is exactly `{dimension, composite}`;
  `atlas:cell_species` needs `lookup_asset`, `layout: tiles`, `tile_deg` > 0, `href_template` with `{tile}`, the `grid`
  (`ncol`, `nrow`, `res` > 0, `x0`, `y0`) and `key_column`, `species_column`, `value_column`, and each of its `links`
  has a `label` and a `column` or an `href_template`; `atlas:taxa_registry` needs `asset`; `atlas:item_template` is
  free; `atlas:uncertainty` pairs a mean surface with its uncertainty (`pair` dimension or band, `kind` cv, se, sd, ci90
  or ci95, `mean`, `uncertainty`) and names its `dimension` when `pair` is dimension; a `cube:dimensions` entry may
  carry `atlas:labels` (value -> label) and `atlas:taxon_dim` (boolean).
- **`atlas-item`**: the atlas hooks of an Item, same writers and reader. Rules: type Feature; `properties.atlas:dims`
  is required, one string per cube dimension (at least one); `atlas:value_range` is [n, n], `atlas:absent` a boolean;
  on assets `atlas:bidx` (integer >= 1), `atlas:rescale` ([n, n] or `auto`), `atlas:colormap`, `atlas:value_column`,
  `atlas:key_column`, `atlas:id_field` (strings) and `sdm:h3_resolution` (0 to 15).
- **`sdm-dossier`**: the stac-sdm 1.1 fields proposed for species distribution model products
  (`atlas/pipeline/docs/stac-sdm-proposal.md`) on the 1.0.0 fields
  ([schema](https://marinesensitivity.github.io/stac-sdm/v1.0.0/schema.json)). Written by the atlas pipeline and
  `workflows/R`; read by the atlas species dossier. The fields are in `properties` on an Item and at the top level on a
  Collection. Rules: `sdm:response_type` (the 1.0.0 values plus `richness` and `uncertainty`), `sdm:method`,
  `sdm:source_authority` and `sdm:temporal_interval` are required; `sdm:taxa` (each with `scientific_name`, maybe
  `authorities` worms, botw, itis, gbif, iucn, `common_name`, `group`, `redlist_code`) and `sdm:taxon` exclude each
  other; `sdm:aggregation` has `method` (mean, sum, max, min, richness, share, composite), maybe `of` and `n`;
  `sdm:evaluation` has at least one metric (`name`, `value`, maybe `partition` train, test or cv), maybe `roc`
  (`fpr`, `tpr`) and `notes`; each of `sdm:response_curves` has `predictor`, `x` and `y`, maybe `unit` and `density`.
  The 1.0.0 fields are typed loosely, as used today: `sdm:taxon.group` is a string in the atlas pipeline and a boolean
  in the MST manifest, and both pass. Reader checks the schema cannot express: `roc.fpr` and `roc.tpr` have equal
  length, and so do a curve's `x`, `y` and `density`.
- **`om-notebook`** (not a STAC profile): the `om:` block in a workflow notebook's front matter, read by `om-extract
  notebooks`.
- **`values-row`** (not a STAC profile): one row of the values contract 1.2.0, the table every indicator producer writes
  to `values/indicator=<id>/coll=<slug>/data.parquet` (one file per indicator and place collection). Written by
  `om_extract.contract.write_values` (oceanmetrics/extract), which every indicators adapter calls; read by the indicators
  coverage builder, the indicators viewer and Python (`om_extract.contract.read_values`, `validate_file`). Rules:
  `place_id` (`<authority>:<source_id>`), `coll`, `indicator` (`<family>:<parts>`), `time_grain` (all, decade, year,
  month, day), `time`, `class`, `value`, `n` and `unit` are required, `sd` (contract 1.2) is optional so a 1.1 row stays
  valid; `time` is null exactly when `time_grain` is `all` and otherwise an ISO date; `n` and `sd` are >= 0 or null;
  extra columns are named `x_*`. Rules across rows or with arithmetic (a `time` is the first day of its period, unique
  keys, one indicator and coll per file, finite values, `sd` null where `value` is null or `n` is 0) are reader checks
  in `om_extract.contract.validate_rows`.
- **`values-provenance`** (not a STAC profile): the JSON a values file carries in its Parquet key-value metadata under
  `om:provenance`: producer, sources, method, code, created stamp, licence, row count and the original `dataset`.
  Same writer and readers as `values-row`. Rules: `contract` is a 1.x semver; from 1.2 on `dataset` (`id`, `title`,
  `providers`, `license`) is required, a 1.1 file stays valid without it (the `if`/`then`); `sources` has at least one
  entry, each with an `href`, maybe the STAC `item` that describes it and a `role` (data, geometry, product, manifest);
  `created` is `YYYY-MM-DDTHH:MM:SSZ`; no extra keys. A reader check: from 1.2 at least one source has the role `data`
  (an absent role counts as `data`).

Today's producers were checked against the profiles on 2026-10-22: the 18 live erddap-places collections pass
`erddap-grid`, the atlas `aquamaps_eov` items pass `atlas-item`. COG items written today do not yet pass `cog`: none
carries `proj:code`, the CCE and EOV share bands carry no `statistics` (the vision doc: statistics are written into
STAC at publish; the AquaMaps bands already have them), and the CCE writer omits `nodata` when a band has none instead
of writing null.
- **`changes-row`**, **`changes-latest`**, **`feeds-index`** and **`alerts-subscription`** (0.5.0, the change feed and the
  alerts of build week 5): see "Changes, feeds and report rules" below.

## Indicator readers and cards

Two subpaths; the package root stays types and constants (it re-exports the types below, nothing at run time):

- **`@oceanmetrics/catalog/indicators`**: the readers, plus every rule of `/cards`, so an app imports one subpath. It
  imports `hyparquet`.
- **`@oceanmetrics/catalog/cards`**: the pure rules alone (no fetch, no parquet), for an app that reads the coverage
  table its own way.

```ts
import { cardsFor, loadCoverage, loadManifest, slotFor } from '@oceanmetrics/catalog/indicators'

const base = 'https://storage.oceanmetrics.io/indicators/'
const [manifest, rows] = await Promise.all([loadManifest(base), loadCoverage(base)])   // or { placeId, columns, fetch }
const cards = cardsFor(rows, manifest, { placeId: 'NMS:CINMS' })                       // leads first, then by series
const slot = slotFor(rows, manifest, 'NMS:CINMS', { layerTitle: 'National Marine Sanctuaries', note: '...' })
```

Readers (`src/indicators.ts`):

- `loadManifest(base?, fetch?)` reads `indicators.json`; `loadCoverage(base?, { columns?, placeId?, fetch? })` reads
  `coverage.parquet` (one whole-file request, cacheable) and decodes only `columns`, `COVERAGE_COLUMNS` by default (the
  thirteen the cards and rollups read: the sparkline and the statistics stay undecoded; `ALL_COVERAGE_COLUMNS` lists the
  26). int64 columns come back as plain numbers. A failed request throws `<file>: HTTP <status> at <base>`.

Rules (`src/cards.ts`), each tested in `src/cards.test.ts` on `fixtures/indicators/` (`indicators.json` and
`coverage.parquet`, made by `make_coverage.sql`, ported from the places page) and small rows written in the test:

- **The row of a card**: the first grain in the status grain, year, month, decade, day, all that has a value
  (`pickRow`); an indicator the manifest does not list gets no card. The period by grain: "2025", "2025-07",
  "the 2020s", "all years" (`periodOf`).
- **A card** (`cardsFor(rows, manifest, { placeId, leadsOnly?, base?, appUrl? })` -> `IndicatorCard[]`): title,
  series, unit, value (a categorical one as its largest class and share, "No Stress 82%"), period, status and trend with
  their glyph classes (`st-above|within|below|none`, `tr-up|flat|down`), the status word and caption (from
  `@oceanmetrics/status` `STATUS_WORDS`, `statusCaption`), why a rule gave no status, the sentence from coverage, the
  method label (`methodLabel`) and note (`methodNote`), the citation, the deep link to the indicators app's Place view
  (`placeViewHref`), and the Reproduce block. Ordered leads first, then by series, then by title. Only `iea-sd` and
  `names-pct` are status rules; any other method shows its value.
- **The citation with the place clause** (`placeCitation`, as the viewer's `place.ts`): the manifest's citation with
  `place <id>` after the indicator id in its "Values:" clause; without a clause one is appended. Without an indicator
  citation the dataset's is used (`datasetCitation`: its own, else producers; title; DOI).
- **Reproduce** (`reproduceFor`, as the viewer's `delivery.ts`): the values url (the collection's `path` under the base,
  null when the manifest lists none), a DuckDB one-liner for the place's rows (`duckdbSnippet`), the canonical config
  lines (`configLines`: place, indicator, method, grain, recent, min_periods, manifest) and their FNV-1a hash
  (`configHash`, 12 hex digits, stable, not cryptographic; the test pins two hashes the viewer gives too).
- **The three absences**, kept distinct: `absenceFor(rows, manifest, placeId)` is `nodata` (the place has coverage rows
  and no value), `notcomputed` (no rows at all, whatever its collection: the places fix of `c3d923b`) or null;
  `absenceText(kind, placeId, opts)` gives the words and links of those two and of `nostatus`. A dated sentence ("arrive
  in build week 3 ...") is the caller's `note`, never a constant here.
- **The fold** (`foldSeriesWithoutRule(cards, { fold? })`): OBIS series without a status rule fold into one line with
  their count and how many stay above as lead cards; the rule is a parameter.
- **The slot** (`slotFor(rows, manifest, placeId, { shownFirst?, layerTitle?, note?, ... })`): the cards, how many show
  first (the leads, else `shownFirst`, `SHOWN_FIRST` = 6), the fold line, the total and the absence.
- **Rollups** (`rollups(rows)`, the Matrix summary of build week 3): one cell per place x indicator, counted at its row
  with a status method and a value, as above, within, below, none (a value, no status) or nodata; per place and per
  indicator in the order they appear, with the latest period among the cells with a value, and the total.

The words come from `@oceanmetrics/status` (0.1.1: `STATUS_WORDS`, `TREND_WORDS`, `STATUS_NOTE`, `METHOD_NOTES`,
`statusCaption`); no status is computed here: status, trend and sentence are coverage.parquet's, which the indicators
coverage builder writes with that package.

**Consumers.** The places record page (`web/src/lib/indicators.ts`) since 0.3.0; the indicators viewer switches after.
Until 0.3.0 is on npm a consumer links this checkout (`"@oceanmetrics/catalog": "file:../../platform/packages/catalog"`,
after `npm run build` here). The link resolves the package's own imports (`hyparquet`, `@oceanmetrics/status` 0.1.1) from
this repo's `node_modules`, so in Vite: allow the checkout in `server.fs.allow`, and do not `resolve.dedupe`
`@oceanmetrics/status` while the app's own copy is older than 0.1.1 (deduping would hand the package the app's copy,
which lacks the words). TypeScript follows the link to its real path and needs nothing more.

## Changes, feeds and report rules

Two more pure subpaths (0.5.0), for the indicators catalog build, the alerts Worker and the front page:

```ts
import { atomFeed, diffCoverage, feedsFor, feedsIndex } from '@oceanmetrics/catalog/changes'
import { rulesFromParams, selectRows } from '@oceanmetrics/catalog/report'

const rows = diffCoverage(published, built, { seen: '2026-10-23', manifest })  // ChangeRow[]: one per place x indicator
const feeds = feedsFor(rows, { places, sets: manifest.place_sets })             // all, coll=, set=, place= (file, href, rows)
const xml = atomFeed(feeds[0].rows, { title: feeds[0].title, id: feeds[0].feedId, updated, link: feeds[0].link, self: feeds[0].href })
const mine = selectRows(rulesFromParams(new Map([['pi', 'NMS:CINMS']])), rows, { indicators: manifest.indicators })
```

`/changes` (`src/changes.ts`):

- **`diffCoverage(before, after, { seen?, manifest? })`**: one `ChangeRow` per place x indicator (x values collection)
  at the card's row (`pickRow`: the manifest's status grain, else the grain of the row with a status method), in the
  order of `after`, of one kind, in this precedence: `new` (the cell gained its first value), `status` (its status word
  changed: a word to another, a first word, or a word lost), `period` (its latest period advanced at the same grain).
  A revised value at the same period, a card row that only moved to another grain (a month row giving way to a year row
  that gained a value: NMS:PMNM on 2026-10-21), a cell with rows and no value and a cell that lost its rows give no row. The row carries `from_`/`to_status`, `from_`/`to_time`, `value`, `unit` (the manifest's), `seen` (the
  build date) and `sentence`.
- **`changeSentence(row, manifest?)`**: the one wording for a feed entry, a mail line and the front page, in the card's
  words and with the place: "Iron in Channel Islands National Marine Sanctuary is now below its own record (2025); it was
  within its own record.", "... has its first status: above its own record (2025).", "... has its first value: 412
  records for 2024.", "... has a value for 2025: 16.1 °C; the last was for 2024." Never better or worse (a schema rule
  and a regression test).
- **`atomFeed(rows, { title, id, updated, link, self?, subtitle?, max? })`**: RFC 4287 as a string (no DOM): the feed's
  id, title, updated, author and self link; one entry per change, newest first, at most `max` (100), each with a stable
  id (`entryId`: `tag:oceanmetrics.io,2026:changes/<seen>/<place>/<coll>/<indicator>/<kind>`, the same in every feed),
  the sentence as title, `updated` at the build date and a link to the indicators app's Place view of the indicator.
- **`feedsFor(rows, { places, sets?, colls? }, { base?, appUrl? })`**: the feeds and the rows each holds: `all.xml`,
  `coll=<slug>.xml` per collection, `set=<id>.xml` per place set, `place=<id>.xml` per place (an empty feed for a place
  with no change yet, so a link never 404s; `feedFile` maps an id's other characters to `_`). `feedsIndex(feeds,
  updated)` is the `feeds-index` document.
- `countKinds`, `mergeChanges` (a same-day re-run adds only what is new: deduplicated by date, cell and kind),
  `changeKey`, `CHANGE_KINDS`.
- The real pair of 2026-10-23 00:51 -> 01:05 (OBIS `place_exact` for the sanctuaries; 2,664 new coverage rows) gives
  868 `new` cells over the 18 sanctuaries, 0 `status`, 0 `period`; the test holds the public rows of CINMS and FGBNMS
  (`fixtures/changes-diff/coverage-2026-10-23.json`: 96 `new`). Over the 16 pairs of published versions (10-20 to 10-23)
  the backfill finds 16,871 `new` on 10-20 (15,764 of them the first full build), 1 `status` on 10-21 (NMS:PMNM's CRW SST
  gained its first status, above its own record, when its year row gained a value), 1 `new` on 10-22 and 868 on 10-23.

`/report` (`src/report.ts`), moved from the indicators repo's `src/report/spec.ts` so the Report view, its figure job and
the alerts Worker read a rule the same way:

- places `*`, `coll:<slug>` (the place's group, else a values collection that holds it), `set:<id>` or a place id;
  indicators `*` (each series' lead), `all`, `cat:<term>`, `series:<id>[:*]` or an id; include, then exclude.
  `matchPlaces`, `expandPlaces`, `matchIndicators`, `expandIndicators`, `seriesLeads`.
- `rulesFromParams(kv)` / `rulesParams(rules)`: the URL keys `pi px ii ix`, defaults (`DEFAULT_RULES`: `coll:places`,
  `*`) left out.
- `selectRows(rules, rows, { indicators, sets? })` and `matchesRules(rules, row, ctx)`: the change (or coverage) rows a
  watch selects, the places grouped by `place_coll ?? coll` as the Report view groups them.

Schemas:

- **`changes-row` 1.0**: one change row (above); every field present, nullable where it may be empty; `kind` `status`,
  `new` or `period`; a `status` row has a status on at least one side, a `new` row no earlier period or status, a
  `period` row both periods; `seen` a date; no "better", "worse", "improv..." or "deteriorat..." in `sentence`.
- **`changes-latest` 1.0**: `indicators/changes/latest.json`, written every build: `date` of the last non-empty change
  file (null before the first), `checked_at`, `manifest_version`, `counts` per kind, `hrefs` (`json`, `parquet`,
  `feeds`) and `recent` (the last 30 files with their counts).
- **`feeds-index` 1.0**: `indicators/feeds/index.json`: `updated` and every feed's `kind`, `id`, `href` (an `.xml`
  url), `title`, `updated` (its newest entry, null when empty) and `entries`.
- **`alerts-subscription` 1.0**: the alerts Worker's record and nothing more (`additionalProperties` false, so a plain
  `email` key fails): `id`, `hmac` (HMAC-SHA256 hex of the address, kept apart and encrypted), `kinds` (default
  `status`, `new`), `cadence` (`daily` | `weekly`), `rules` (the report rules; no `@` in a rule), `title`, `source`
  (`place` | `report` | `alerts`), `confirmed_at` (null while pending), `created_at`, `last_sent`.

Fixtures use RFC 2606 addresses only; a test fails on any address in `fixtures/` outside example.org, example.com and
the publisher's own oceanmetrics.io contact.

## Layout

```
schemas/<name>.schema.json          draft 2020-12, self-contained (no cross-file $ref), $id
                                    https://oceanmetrics.io/schemas/<name>/v<version>/schema.json (1.0.0;
                                    h3 1.1.0 since catalog 0.4.0)
fixtures/<name>/valid/*.json        each must pass
fixtures/<name>/invalid/*.json      each must fail, and breaks exactly one rule of a valid fixture
fixtures/<name>/invalid.json        invalid file name -> a substring of its error (a JSON pointer or a property name,
                                    so the same file works for ajv and Python's jsonschema)
src/index.ts                        PROFILES, the field types and the indicators types (types only, safe in a browser)
src/manifest.ts                     the manifest and coverage types, the column lists, the default urls
src/indicators.ts                   @oceanmetrics/catalog/indicators: loadManifest, loadCoverage (hyparquet), + cards.ts
src/cards.ts                        @oceanmetrics/catalog/cards: the card rules, absences, fold, Reproduce, rollups (pure)
src/changes.ts                      @oceanmetrics/catalog/changes: diffCoverage, changeSentence, atomFeed, feedsFor (pure)
src/report.ts                       @oceanmetrics/catalog/report: the selection rules and the pi px ii ix keys (pure)
fixtures/changes-diff/              the real 10-23 coverage pair, rows of two sanctuaries (public)
fixtures/indicators/                indicators.json, coverage.parquet (make_coverage.sql): the cards' synthetic fixtures
src/validate.ts                     listProfiles(), loadSchema(name), validate(name, doc) -> { ok, errors } (Node, ajv)
src/cli.ts                          the om-catalog bin
```

`src/validate.test.ts` discovers every schema in `schemas/` and runs all its fixtures, so a new profile is covered by
adding its schema and fixtures; it also holds one named test per profile rule.

The `$id` URLs are served from `https://oceanmetrics.io/schemas/` from build week 5 (2026-11-27 to 12-03); until then
they are names, and readers load the files from this package.

## Commands

```sh
npx om-catalog profiles                                      # list the profiles
npx om-catalog validate <profile> <file...>                  # print each file's errors; exit 1 if any fails
npx om-catalog validate erddap-grid ../erddap-places/catalog/gazetteer/erddap/*/collection.json
```

```ts
import { validate } from '@oceanmetrics/catalog/validate'   // Node only: pulls ajv
import type { ErddapGridFields } from '@oceanmetrics/catalog'

const { ok, errors } = validate('cog', item)   // errors: ["/properties: must have required property 'proj:code'"]
```

An error is `<json pointer>: <message>`, `/` for the document itself, the format `om_extract.schemas.validate` uses.

## Python

`om_extract.schemas` (oceanmetrics/extract) reads the same `schemas/` folder: `$OM_SCHEMAS_DIR`, else
`node_modules/@oceanmetrics/catalog/schemas` after the npm publish, else the sibling checkout
`../platform/packages/catalog/schemas`. It validates with `jsonschema.Draft202012Validator`; the schemas use nothing
it reads differently from ajv (ajv runs in strict mode to keep it so).

## Size budget

15 000 B gzip of `dist/**/*.js`, leaving out `dist/validate*.js` and `dist/cli*.js`: the validator and the CLI are Node
only (ajv) and never reach a browser (`scripts/size-budget.mjs`, `NODE_ONLY`). Measured 11 560 B on 2026-10-23 at 0.5.0
(`cards.js` 5 486, `changes.js` 3 696, `report.js` 2 170, `indicators.js` 878, `index.js` 543, `manifest.js` 527, each
gzipped alone). Raised from 10 000 B (6 726 B at 0.3.0) when `/changes` and `/report` landed: the budget sums every
file, while an app loads only its subpaths (the places page on `/cards` pays nothing for `/changes`; the viewer's rules
cost what its own copy did). `hyparquet` and `@oceanmetrics/status` are dependencies and not counted: an app that
imports only the root pays 543 B.
