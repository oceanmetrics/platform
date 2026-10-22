# platform: the shared packages of Ocean Metrics

The shared TypeScript packages of the [Ocean Metrics](https://oceanmetrics.io) platform, as npm workspaces under
`packages/`. Each Ocean Metrics app (places, indicators and the ones after them) imports what it needs from here, so a
rule or a reader is written once.

| package | what it holds | status (2026-10-22) |
|---|---|---|
| [`@oceanmetrics/places`](packages/places/) | client for the places gazetteer: layers manifest, MapLibre layers from PMTiles, parquet search and lookups, credits | moved in at 0.5.0 from `oceanmetrics/places` `client/` |
| [`@oceanmetrics/status`](packages/status/) | the status methods (`iea-sd`, `names-pct`, `values`), the period grid, sentences and alt text, the quadrant plot rules | moved in at 0.1.0 from `oceanmetrics/indicators` `src/status/`, with the ecoidx cross-check fixture |
| [`@oceanmetrics/map`](packages/map/) | the map stack: MapLibre 6 setup, the bathymetric basemap, the ramps, the layer slot contract and its providers (grid slice, COG, H3) | 0.2.0 (2026-10-23, build week 2 step 1; 0.1.0 was the scaffold); the basemap tiers are built by `scripts/basemap/build_gebco.sh`, not uploaded yet |
| [`@oceanmetrics/catalog`](packages/catalog/) | the catalog contracts: the STAC layer profiles (JSON Schemas, types, a validator, the `om-catalog` CLI), then the indicators manifest and values and the places index readers | 0.2.0: the six STAC layer profiles; gains the values and manifest readers in build week 1 (2026-10-30 to 11-05) |

## Rules

- **Apps import these packages and never each other.** Shared code goes here; an app that needs something from another
  app asks for it to move into a package.
- **Publishing.** The packages publish to npm as `@oceanmetrics/*` on Day 5 (2026-10-26): places 0.5.1, status 0.1.0,
  map 0.1.0, catalog 0.2.0 (see Publishing below). Until then the apps link to this checkout as a sibling folder
  (`"@oceanmetrics/status": "file:../platform/packages/status"`); run `npm run build` here first, because the
  packages export from `dist/`.
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

## Publishing

Each package is public (`publishConfig.access`), ships `dist`, `src`, `README.md`, `CHANGELOG.md` and `LICENSE` (catalog
also `schemas/`, never `fixtures/`), and runs `npm run build` on `prepack`, so a publish from a clean checkout always
carries a fresh `dist/`. The npm account has 2FA on writes, so there is no root `publish` script that fires all four
at once; `scripts/publish.sh` does it one package at a time.

Day 5 steps (2026-10-26), from a clean `main`:

1. `npm ci && npm test && npm run typecheck && npm run build && npm run size` (all green).
2. `npm pack --dry-run -w packages/<name>` for each package: `dist/` is in the file list, catalog has
   `schemas/*.schema.json` and no `fixtures/`.
3. `npm whoami` is the owner of the `oceanmetrics` org; then `scripts/publish.sh <otp>` (or with an automation token
   in `~/.npmrc` and no argument). It publishes status, places, map, catalog in that order, stops at the first
   failure, and prints `npm view @oceanmetrics/<name> version` after each. An OTP lasts about 30 seconds: if a later
   package fails with an OTP error, run `npm publish -w packages/<name> --access public --otp <new>` for the rest.
4. Tag the release: `git tag status-v0.1.0 places-v0.5.1 map-v0.1.0 catalog-v0.2.0`, and push the tags.
5. Switch the consumers from `file:` links to the registry (checklist below).

A later release: bump the package's `version`, add its CHANGELOG entry in the same change, run the gates, then
`npm publish -w packages/<name> --otp <otp>`.

### Consumer switch (after the publish)

Edit each repo in its own change; nothing here edits them.

- [ ] **indicators**: `package.json` `@oceanmetrics/status` `file:../platform/packages/status` to `^0.1.0`, and add
  `@oceanmetrics/catalog` `^0.2.0`. Drop the platform checkout step from `pages.yml`, `catalog.yml` and `requests.yml`;
  keep `OM_SCHEMAS_DIR` pointing at `node_modules/@oceanmetrics/catalog/schemas` (now there, because indicators depends
  on `@oceanmetrics/catalog`). Re-run `npm install` and its tests.
- [ ] **places**: `web/package.json` `@oceanmetrics/places` to `^0.5.1`; remove the Vite alias and the
  `server.fs.allow` entry for the platform checkout. Re-run `npm install`, the web build and tests.
- [ ] **erddap-places**: `precompute/package.json` `@oceanmetrics/catalog` to `^0.2.0`, so its profile tests run on the
  runner (no sibling checkout).
- [ ] **atlas**: `package.json` gains `@oceanmetrics/catalog` `^0.2.0` for the pipeline's schema lookup
  (`node_modules/@oceanmetrics/catalog/schemas`).
- [ ] Update the `CLAUDE.md` of this repo and of each consumer: the `file:` link text becomes "from npm".

## Size budget

`npm run size` gzips (level 9) the summed `dist/**/*.js` of each package and compares it with the budget in
`scripts/size-budget.mjs`. Set on 2026-10-22 at about 1.5 times the measurement: places 18 000 B (measured 11 708 at 0.5.1, 12 492 at 0.5.2),
status 12 000 B (measured 7 997); map 39 000 B (measured 26 024 on 2026-10-23, when 0.2.0 replaced the scaffold and its
provisional 5 000 B: every module counts, the h3 worker module and the COG code included; packages/map/README.md has
what an app pays per provider); catalog holds a provisional 5 000 B until it has code (measured 404 B on 2026-10-22,
its Node-only validator and CLI left out: they never reach a browser). Raise a budget only with the reason written here.

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC.
