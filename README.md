# platform: the shared packages of Ocean Metrics

The shared TypeScript packages of the [Ocean Metrics](https://oceanmetrics.io) platform, as npm workspaces under
`packages/`. Each Ocean Metrics app (places, indicators and the ones after them) imports what it needs from here, so a
rule or a reader is written once.

| package | what it holds | status (2026-10-22) |
|---|---|---|
| [`@oceanmetrics/places`](packages/places/) | client for the places gazetteer: layers manifest, MapLibre layers from PMTiles, parquet search and lookups, credits | moved in at 0.5.0 from `oceanmetrics/places` `client/` |
| [`@oceanmetrics/status`](packages/status/) | the status methods (`iea-sd`, `names-pct`, `values`), the period grid, sentences and alt text, the quadrant plot rules | moved in at 0.1.0 from `oceanmetrics/indicators` `src/status/`, with the ecoidx cross-check fixture |
| [`@oceanmetrics/map`](packages/map/) | the map stack: MapLibre 6 setup, the bathymetric basemap, the ramps, the layer slot contract and its providers (grid slice, COG, H3) | 0.2.0 (2026-10-23, build week 2 step 1; 0.1.0 was the scaffold); the basemap tiers are built by `scripts/basemap/build_gebco.sh`, not uploaded yet |
| [`@oceanmetrics/engine`](packages/engine/) | the browser engine: the place mask, the lobes, ERDDAP requests, the SQL templates shared with `om_extract`, DuckDB-WASM statistics, the chunked live preview and the map's grid slice | 0.1.0 (2026-10-23, build week 2 step 2b): moved from erddap-places (the frozen original); `indicators` is its first consumer (step 2c); not in the Day 5 publish |
| [`@oceanmetrics/catalog`](packages/catalog/) | the catalog contracts: the STAC layer profiles (JSON Schemas, types, a validator, the `om-catalog` CLI), the values contract, and the indicators readers and cards (`/indicators`, `/cards`), the change feed (`/changes`) and the report rules (`/report`) | 0.5.0 (2026-10-23, build week 5 step 0, unreleased): `/changes` (`diffCoverage`, `changeSentence`, `atomFeed`, `feedsFor`), `/report` (the selection rules moved from indicators) and the `changes-row`, `changes-latest`, `feeds-index` and `alerts-subscription` schemas; 0.4.0: the `h3` profile 1.1 (period sets for decades and years, the species table's first and last year, `h3:heads`, `row_group_rows`); 0.3.0: the indicator cards shared by the indicators viewer and the places record page |
| [`@oceanmetrics/nav`](packages/nav/) | the one navigation bar of the apps and the site: `<om-nav>`, a framework-free custom element (the mark, the three doors, the place search, What changed, Docs, a slot for the app's own controls), styled by the brand tokens of the host | 0.1.0 (2026-10-23, build week 5 step 3, decision D7, unreleased): new |

One Worker lives here too, beside the packages it imports (decision D6 of the week 5 plan): **[`workers/alerts/`](workers/alerts/)**,
`om-alerts`, the email alerts of the indicators (confirmed opt-in, hourly digests of the change files). It is an npm
workspace but not a package (`private`, never published); its README has the routes, the KV layout and the runbook.
Beside it, **[`workers/usage/`](workers/usage/)** is not a Worker but a Node script: the weekly usage numbers per catalog from the
Workers' Analytics Engine datasets (`--dry-run` prints the SQL; needs a read token only to run for real).

The bucket has one publisher: **[`scripts/om-publish.sh`](scripts/om-publish/)** uploads a folder to a prefix of both
stores (R2 and S3, never a delete, `--dry-run` by default), keeps dated copies on R2 with `--keep-history`, and
`om-publish.sh rewrite` moves the storage hosts in published JSON for the cutover. Its README has the per-repo scripts it
replaces. The host every url uses is one setting, `@oceanmetrics/catalog/storage` (and `om_extract.storage`).

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
npm test                 # vitest, every package, then the alerts Worker's own npm test (must be green to commit)
npm run typecheck        # tsc --noEmit in each package and the Worker
npm run build            # tsc to packages/*/dist (types and JS); the Worker's bundle (wrangler dry-run) to workers/alerts/dist
npm run size             # gzip budget per package and the Worker bundle, after build
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
status 12 000 B (measured 7 997); map 39 000 B (measured 26 014 on 2026-10-23, when 0.2.0 replaced the scaffold and its
provisional 5 000 B: every module counts, the h3 worker module and the COG code included; packages/map/README.md has
what an app pays per provider); catalog 10 000 B (measured 6 726 on 2026-10-23 at 0.3.0, when the indicators readers and
cards landed; 404 B before, the profile constants alone; its Node-only validator and CLI left out: they never reach a
browser; hyparquet and `@oceanmetrics/status` are dependencies and not counted); engine 40 000 B (measured 26 794 on 2026-10-23
at 0.1.0, the five SQL templates included; DuckDB-WASM and Apache Arrow are peers and not counted; packages/engine/README.md
has what an app pays per entry). Catalog raised to 15 000 B on 2026-10-23 at 0.5.0 (measured 11 610): two subpaths
landed, `/changes` (3 753 B: the diff, the sentences, the Atom builder and the feed names) and `/report` (2 170 B: the
selection rules moved from the indicators repo), and the budget sums every file while no app loads them all (an app on
`/cards` pays nothing for `/changes`; the viewer's rules cost what its own copy did). Raise a budget only with the reason
written here. Nav 12 000 B (measured 7 776 on 2026-10-23 at 0.1.0, every dist file with its comments); what a page
fetches for the bar is its own line, `nav/define` (`scripts/nav-size.mjs`: `src/define.ts` bundled alone and minified,
4 947 B, budget 6 000 B, the 0.1.0 target; the reason it is not the week 5 plan's 3 kB is the inline mark, 1 100 B of
it: packages/nav/README.md "Size").

The alerts Worker is not a package: its line is the deployed bundle (`wrangler deploy --dry-run --minify`, one file),
budget 30 000 B from the week 5 plan, measured 12 330 B at 0.1.0 on 2026-10-23.

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC.
