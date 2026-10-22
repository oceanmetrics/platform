# CLAUDE.md

Guidance for Claude Code in `oceanmetrics/platform`: the shared TypeScript packages of the Ocean Metrics platform
(`@oceanmetrics/places`, `status`, `map`, `catalog`) as npm workspaces under `packages/`. Apps import these packages
and never each other. Until the 0.1 publish on Day 5 (2026-10-26) the apps link to this checkout as
`file:../platform/packages/<name>`; the packages export from `dist/`, so run `npm run build` before an app uses them.

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
- **`catalog` holds the STAC layer profiles**: one self-contained JSON Schema per profile in `packages/catalog/schemas/`,
  read at run time by `@oceanmetrics/catalog/validate` (ajv, Node only, never imported by the index) and by the Python
  `om_extract.schemas`. Fixtures in `fixtures/<name>/{valid,invalid}/`, the expected errors in `invalid.json`; the test
  discovers every schema. **`map` is a scaffold** (a `PACKAGE` constant and one test); its README says what fills in.
- Source imports use `.js` specifiers (`./grid.js`) so the emitted declarations resolve for every consumer.

## Conventions

2-space indent, camelCase in TypeScript, lowercase comments, `----` section headings in long files. One test per rule
with a small synthetic fixture asserting exact output; a bug fix adds a named regression test. vitest must be green
before every commit. Size budgets are raised only with the reason written in the README. A version bump in a package
gets a CHANGELOG entry in the same change. The `log` skill records milestones in `~/Github/bbest/notes/om/`.
