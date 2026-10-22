# @oceanmetrics/catalog

The catalog contracts of Ocean Metrics. Today: the **STAC layer profiles**, one JSON Schema per kind of layer, with
their TypeScript types, a validator and the `om-catalog` command, and the **values contract** (`values-row`,
`values-provenance`). The values and manifest readers follow in build week 1 (2026-10-30 to 11-05).

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
  maps a resolution to its parent's (coarser, a reader check), `keys` names the other placeholders; `h3:periods` has
  `grain` (decade, year, month, all), `values` and `placeholder`. The species x hex x count table `h3:species_table`
  needs `href_template` (with `{res}`), `resolutions`, `partition_by`, `columns` (`cell`, `species`, `count`, maybe
  `year`) and `lookup` (`href`, `key`, `lineage_column`, maybe `rank_columns` and `name_column`); `sorted_by` defaults
  to `["h3"]`.
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

## Layout

```
schemas/<name>.schema.json          draft 2020-12, self-contained (no cross-file $ref), $id
                                    https://oceanmetrics.io/schemas/<name>/v1.0.0/schema.json
fixtures/<name>/valid/*.json        each must pass
fixtures/<name>/invalid/*.json      each must fail, and breaks exactly one rule of a valid fixture
fixtures/<name>/invalid.json        invalid file name -> a substring of its error (a JSON pointer or a property name,
                                    so the same file works for ajv and Python's jsonschema)
src/index.ts                        PROFILES, the field types (types only, safe in a browser)
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

5 000 B gzip of `dist/**/*.js`, leaving out `dist/validate*.js` and `dist/cli*.js`: the validator and the CLI are Node
only (ajv) and never reach a browser, which imports the index (`scripts/size-budget.mjs`, `NODE_ONLY`). Measured
404 B on 2026-10-22 (the index is constants and types); the budget stays 5 000 B until the values and manifest readers
land in build week 1.
