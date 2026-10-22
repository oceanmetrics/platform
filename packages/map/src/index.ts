// @oceanmetrics/map: the map stack of the Ocean Metrics apps (README.md). every module is free of side effects and of a
// run-time maplibre-gl import; the h3 worker module is its own entry (`@oceanmetrics/map/h3-worker`), never imported here.
export const PACKAGE = { name: '@oceanmetrics/map', version: '0.2.0' } as const

// ---- the slot contract ----
export {
  clearsLayer, formatLayerKey, hitsLayer, isPartFill, isSlotLayer, parseLayerKey, registerSlotKind, SLOT_KIND_ALIASES, SLOT_KINDS,
  SLOT_PREFIX, slotBeforeId, slotFor,
} from './slot.js'
export type { LayerSlot, LayerSpec, LegendClass, LegendSpec, LegendStats, SlotFactory, SlotKind, SlotOptions } from './slot.js'

// ---- MapLibre setup ----
export {
  COG_SCHEME, H3J_SCHEME, h3ModuleUrl, lazyCogProtocol, loadCogProtocol, mapLibre, PMTILES_SCHEME, pmtilesProtocol, registerProtocol,
  resetMapLibreSetup, setupMapLibre, workerUrl, WorkerUrlError,
} from './maplibre.js'
export type { MapLibreModule, ProtocolName, SetupOptions } from './maplibre.js'

// ---- the basemap and the ramps ----
export {
  BASEMAP_URL, baseLabelDefaultOpacity, baseStyle, BATHY_PARTS, BATHY_RAMP, bathyDefaultOpacity, CARTO_URL, composeStyle,
  CONTOUR_LABEL_MINZOOM, CONTOUR_LEVELS, DEFAULT_TILES, DEM_ENCODING, GEBCO_ATTRIBUTION, LAND_ATTRIBUTION, LAND_LAYER,
  NAME_RANKS, NAMES_ATTRIBUTION, seaSurfaceId, SOURCE_LAYERS,
} from './basemap.js'
export type { BasemapOptions, BasemapTiles, BathyPart, Theme } from './basemap.js'
export {
  CLASS_RAMP, classColors, colorAt, DEFAULT_RAMP, defaultRampFor, interpolateColors, parseRamp, RAMP_IDS, RAMPS, rampColors, rampCss,
  rampHex, rampStops, UNKNOWN_CLASS_COLOR,
} from './ramps.js'
export type { Ramp, RampFamily, RampKind, Rgb } from './ramps.js'

// ---- the providers ----
export {
  axisSpacing, cellSquares, classLegend, GRID_LAYER, GRID_SOURCE, gridFillColor, gridLegend, gridSlot, normalizeLon, pickCenter,
} from './grid.js'
export type { CellProps, CellSquares, CellSquaresOptions, GridClass, GridSlotOptions, LonCenter, SliceCell, SliceSource } from './grid.js'
export {
  assertWebMercator, bucketCounts, COG_LAYER, COG_SOURCE, cogBand, cogBands, cogColorFunction, CogProjectionError, cogRange,
  cogSlot, cogUrl, legendFromStac, nodataValue, openCog, overviewHistogram, pickCogAssets, pointValue, WEB_MERCATOR,
} from './cog.js'
export type { CogAsset, CogBandLike, CogItemLike, CogSlotOptions, OverviewHistogram, StacNodata } from './cog.js'
export { decodeH3jTile, encodeH3jTile, H3_FILL, H3_LAYER, H3_SOURCE, h3FillColor, h3Slot, h3TileUrl, parseH3TileUrl } from './h3.js'
export type { H3Archive, H3SlotOptions } from './h3.js'
export { cellRing, cellsProvider, h3jAction, h3jSource, pmtilesProvider, TILE_OPTIONS, tileFeatures, tileToGeoJSON, tileToMvt } from './h3Tiles.js'
export type { TileProvider } from './h3Tiles.js'
export {
  BUFFER, CellIndex, cellTouchesTile, EXTENT, lonLatToTile, RES_FOR_ZOOM, resForZoom, rollUp, seamSpans, tileBounds, ZOOM_BREAKS,
  zoomToRes,
} from './h3Index.js'
export type { Aggregate, H3jTile } from './h3Index.js'
export { buildH3jArchive, gzipStream, writePmtiles } from './h3Archive.js'
export type { Gzip, H3jArchive, H3jArchiveOptions } from './h3Archive.js'
