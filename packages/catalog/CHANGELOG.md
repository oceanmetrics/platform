# Changelog

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
