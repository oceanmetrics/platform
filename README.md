# platform: the shared packages of Ocean Metrics

The shared TypeScript packages of the [Ocean Metrics](https://oceanmetrics.io) platform, as npm workspaces under
`packages/`. Each Ocean Metrics app (places, indicators and the ones after them) imports what it needs from here, so a
rule or a reader is written once.

| package | what it holds | status (2026-10-22) |
|---|---|---|
| [`@oceanmetrics/places`](packages/places/) | client for the places gazetteer: layers manifest, MapLibre layers from PMTiles, parquet search and lookups, credits | moved in at 0.5.0 from `oceanmetrics/places` `client/` |
| [`@oceanmetrics/status`](packages/status/) | the status methods (`iea-sd`, `names-pct`, `values`), the period grid, sentences and alt text, the quadrant plot rules | moved in at 0.1.0 from `oceanmetrics/indicators` `src/status/`, with the ecoidx cross-check fixture |
| [`@oceanmetrics/map`](packages/map/) | the map stack: MapLibre 6, PMTiles, the bathymetric basemap, COG and H3 sources | scaffold only; gains the renderer (grid slice, COG, H3 source) and the basemap in build week 2, 2026-11-06 to 11-12 |
| [`@oceanmetrics/catalog`](packages/catalog/) | readers for the catalogs: STAC layers, the indicators manifest and values, the places index | scaffold only; gains the STAC profile validators on Day 2 (2026-10-23) and the values and manifest readers in build week 1 (2026-10-30 to 11-05) |

## Rules

- **Apps import these packages and never each other.** Shared code goes here; an app that needs something from another
  app asks for it to move into a package.
- **Publishing.** The packages publish to npm as `@oceanmetrics/*` 0.1 on Day 5 (2026-10-26). Until then the apps link
  to this checkout as a sibling folder (`"@oceanmetrics/status": "file:../platform/packages/status"`); run
  `npm run build` here first, because the packages export from `dist/`.
- **Public from the first commit.** Nothing internal: no Marine Regions copies, no PPOW geometry, no private emails,
  no secrets. Fixtures are synthetic or from public sources.

## Commands

```sh
npm install              # once; links the workspaces
npm test                 # vitest, every package (must be green to commit)
npm run typecheck        # tsc --noEmit in each package
npm run build            # tsc to packages/*/dist (types and JS)
npm run size             # gzip budget per package, after build
npx vitest run packages/status/src/quad.test.ts   # one file
```

## Size budget

`npm run size` gzips (level 9) the summed `dist/**/*.js` of each package and compares it with the budget in
`scripts/size-budget.mjs`. Set on 2026-10-22 at about 1.5 times the measurement: places 18 000 B (measured 11 708),
status 12 000 B (measured 7 997); map and catalog hold a provisional 5 000 B each until they have code. Raise a budget
only with the reason written here.

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC.
