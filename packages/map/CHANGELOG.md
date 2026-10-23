# Changelog

## 0.2.1 (unreleased)

The basemap tiers (build week 2 step 2b): the sea floor now serves every app globally.

- New: `BasemapTiles.regional`, a list of deeper terrain-RGB archives drawn over core from z9 (`REGIONAL_MINZOOM`), each
  its own `raster-dem` source (`gebco-regional`, `gebco-regional-2`, ..., `regionalSourceId(i)`) with relief and shade
  layers; `DEFAULT_TILES.regional` is `gebco/core-sanctuaries.pmtiles` (the 18 sanctuaries, padded 1 degree, z9-10).
  Pass `tiles: { regional: [] }` to leave core overzoomed past z8. `seaSurfaceId` and `basemapLayerIds` know the new ids.
- Changed: `core` is the globe at z0-8 (it was the regional boxes), and the contours and the land mask are global; see
  the README's Basemap section for the archives, sizes and the build.

The consumer check (build week 2 step 2a, `spikes/map-consumer`): the six README points run on a Vite page against
MapLibre 6.13 and CARTO's real styles.

- Fix: `composeStyle`'s land mask repainted the whole ocean over the data on CARTO's current tiles (protomaps schema:
  water polygons carry `kind`, not `class`); `water-inland` now leaves out `kind` or `class` ocean and sea
  (`OPEN_WATER`).
- Fix: a theme flip with `setStyle(style, { diff: true })` dropped the mounted slot. New `carrySlots` and
  `carryLayers(keep)`, the `transformStyle` that carries the slot's (or any kept) layers and sources into the next style
  under the layer they sat under.
- Fix: an h3 archive given by a relative url 404ed in the worker (resolved against the worker script);
  `h3TileUrl(url, base?)` and `h3Slot` now make it absolute against the page (`absoluteArchiveUrl`).
- New: `basemapLayerIds(style)`, the layer ids of a composed style: the rule an app's `clear()` keys on (indicators'
  `base-*` rule matches no CARTO id).
- README: the setup passes `{ addProtocol, importScriptInWorkers, setWorkerUrl }`, not the `maplibre-gl` namespace
  (+11.5 kB gzip); boot on `dem: false` (a failing tier stalls `load`); the bundle as a Vite app measures it.

## 0.2.0 (2026-10-23)

The map stack, build week 2 step 1: the layer slot contract, MapLibre 6 setup, the bathymetric basemap, the ramps and
three providers.

- **Slots** (`slot.ts`, moved in from indicators `layerSlot.ts`): `LayerSlot`, `LayerSpec`, `LegendSpec` (now with
  `ramp`, `classes`, `histogram`, `stats`, `units`); `parseLayerKey`/`formatLayerKey` for `layer=<kind>:<id>[:<variable>]`
  with kinds `grid`, `cog`, `h3`; `erddap:` parses as a deprecated alias of `grid:`; `registerSlotKind`, `slotFor`,
  `SLOT_PREFIX`; `slotBeforeId` now takes the drawn layer ids (`under` and `fallback` options).
- **MapLibre 6 setup** (`maplibre.ts`): `setupMapLibre({ maplibre, workerUrl, h3WorkerUrl, protocols })` sets the
  worker url, registers `pmtiles://` and a lazily loaded `cog://`, and imports the h3j module into MapLibre's worker;
  `workerUrl`, `h3ModuleUrl` (must end in `.mjs`), `WorkerUrlError`, `pmtilesProtocol`, `registerProtocol`.
- **Basemap** (`basemap.ts`, a port of CalCOFI explore's `composeStyle`): `composeStyle(base, opts)` with the two GEBCO
  terrain tiers, hillshade, zoom-gated isobaths, the undersea names, the OSM land mask and toned CARTO labels in both
  themes; `BasemapTiles`/`DEFAULT_TILES` (storage.oceanmetrics.io/basemap/, built by `scripts/basemap/build_gebco.sh`,
  not uploaded yet); `seaSurfaceId`, `baseStyle`, `CONTOUR_LEVELS`, `BATHY_RAMP`.
- **Ramps** (`ramps.ts`): cmocean, viridis, GEBCO and Spectral as data; `rampStops`, `classColors`, `colorAt`,
  `interpolateColors`, `rampHex`, `defaultRampFor`.
- **grid** (`grid.ts`): `gridSlot(spec, source)` over a `SliceSource`; `cellSquares` (from erddap-places),
  `gridFillColor`, `classLegend`, `gridLegend`.
- **cog** (`cog.ts`): `cogSlot(spec, asset)` over `@geomatico/maplibre-cog-protocol`, refusing non-3857 assets
  (`CogProjectionError`); `legendFromStac`, `overviewHistogram`, `pointValue`, `cogUrl`, `cogColorFunction`,
  `pickCogAssets`.
- **h3** (`h3.ts`, `h3Tiles.ts`, `h3Index.ts`, `h3Archive.ts`, the `@oceanmetrics/map/h3-worker` entry): `h3Slot(spec,
  archive)` over a PMTiles archive of h3j tiles read in the worker, or an in-memory table; the h3j tile builder
  (`tileToMvt`, `h3jSource`, `cellRing` with the PR 211 unwrap, geojson-vt `tolerance: 0`), `CellIndex`,
  `RES_FOR_ZOOM`, `rollUp`; `buildH3jArchive`, the producers' archive writer.
- Dependencies: `maplibre-gl` ^6.13 and `pmtiles` ^4 as peers; `h3-js`, `@maplibre/geojson-vt`, `@maplibre/vt-pbf`,
  `geotiff`, `@geomatico/maplibre-cog-protocol`.
- Size budget set from a measurement: 26 014 B gzip, budget 39 000 B.

## 0.1.0 (2026-10-22)

- Scaffold: the `PACKAGE` constant only. The renderer (grid slice, COG, H3 source) and the basemap arrive in build week 2
  (2026-11-06 to 11-12).
