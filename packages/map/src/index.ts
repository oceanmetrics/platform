// @oceanmetrics/map: the map stack of the Ocean Metrics apps (README.md). every module is free of side effects and of a
// run-time maplibre-gl import; the h3 worker module is its own entry (`@oceanmetrics/map/h3-worker`), never imported here.
export const PACKAGE = { name: '@oceanmetrics/map', version: '0.3.5' } as const

// ---- the slot contract ----
export {
  carryLayers, carrySlots, clearsLayer, formatLayerKey, hitsLayer, isPartFill, isSlotLayer, parseLayerKey, registerSlotKind, SLOT_KIND_ALIASES, SLOT_KINDS,
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
  BASEMAP_URL, BASEMAP_VERSION, baseLabelDefaultOpacity, basemapLayerIds, baseStyle, BATHY_PARTS, BATHY_RAMP, bathyDefaultOpacity, CARTO_URL, composeStyle,
  CONTOUR_LABEL_MINZOOM, CONTOUR_LEVELS, DEFAULT_TILES, DEM_ENCODING, GEBCO_ATTRIBUTION, LAND_ATTRIBUTION, LAND_LAYER,
  NAME_RANKS, NAMES_ATTRIBUTION, OPEN_WATER, seaSurfaceId, SOURCE_LAYERS, tilesAt,
} from './basemap.js'
export type { BasemapOptions, BasemapTiles, BathyPart, Theme } from './basemap.js'
export {
  CLASS_RAMP, classColors, colorAt, DEFAULT_RAMP, defaultRampFor, interpolateColors, parseRamp, RAMP_IDS, RAMPS, rampColors, rampCss,
  rampHex, rampStops, UNKNOWN_CLASS_COLOR,
} from './ramps.js'
export type { Ramp, RampFamily, RampKind, Rgb } from './ramps.js'

// ---- the providers ----
export {
  axisSpacing, cellLocator, cellSquares, classLegend, GRID_LAYER, GRID_OUTLINE, GRID_SOURCE, gridFillColor, gridIds, gridLegend, gridOutline, gridSlot, normalizeLon, OUTLINE_BELOW, pickCenter, sliceCounts,
} from './grid.js'
export type { CellProps, CellSquares, CellSquaresOptions, GridClass, GridSlot, GridSlotOptions, LonCenter, SliceCell, SliceCounts, SliceSource } from './grid.js'
export {
  assertWebMercator, bucketCounts, COG_LAYER, COG_SOURCE, cogBand, cogBands, cogColorFunction, CogProjectionError, cogRange,
  cogHref, cogSlot, cogUrl, legendFromStac, nodataValue, openCog, overviewHistogram, pickCogAssets, pointValue, WEB_MERCATOR,
} from './cog.js'
export type { CogAsset, CogBandLike, CogItemLike, CogSlotOptions, OverviewHistogram, StacNodata } from './cog.js'
export { absoluteArchiveUrl, decodeH3jTile, encodeH3jTile, H3_FILL, H3_LAYER, H3_SOURCE, h3FillColor, h3Slot, h3TileUrl, parseH3TileUrl } from './h3.js'
export type { H3Archive, H3SlotOptions } from './h3.js'
export { cellRing, cellsProvider, h3jAction, h3jSource, pmtilesProvider, TILE_OPTIONS, tileFeatures, tileToGeoJSON, tileToMvt } from './h3Tiles.js'
export type { TileProvider } from './h3Tiles.js'
export {
  BUFFER, CellIndex, cellTouchesTile, EXACT_CELLS, EXTENT, lonLatToTile, marginDegFor, NON_ADDITIVE, OVERHANG, RES_FOR_ZOOM, resForZoom, rollUp, seamSpans, tileBounds,
  tileParents, ZOOM_BREAKS, zoomToRes,
} from './h3Index.js'
export type { Aggregate, H3jTile, H3Rows, H3TileData } from './h3Index.js'
export { buildH3jArchive, gzipStream, writePmtiles } from './h3Archive.js'

// ---- the h3 provider over a release (0.3.0) ----
export { cellIdOf, cellIdRes, childRange, h3OfCellId, inRanges, mergeRanges, overlapsRanges, parentId } from './h3Bits.js'
export {
  absoluteTemplate, collectionBase, fillTemplate, H3R_SCHEME, idColumn, indicatorColumns, parseReleaseTileUrl, periodSets, pickRes,
  releaseFile, releaseKeyOf, releaseLayer, releaseMaxzoom, releaseTileUrl, resolvePeriod, zoomForRes,
} from './h3ReleaseLayer.js'
export type { H3CollectionLike, H3Period, H3PeriodSetLike, H3ReleaseLayer, H3ResRule, ReleaseLayerOptions } from './h3ReleaseLayer.js'
export {
  h3ReleaseIds, h3ReleaseSlot, itemPath, periodOf, releaseDomains, releaseFillColor, releaseFilter, releasePeriods, releaseSource, statsUrl,
} from './h3Release.js'
export type { H3ReleaseItem, H3ReleaseSlot, H3ReleaseSlotOptions, H3ReleaseView } from './h3Release.js'
export { newTileTally, ReleaseReader, releaseProvider, tileRanges } from './h3Parquet.js'
export type { ReleaseProviderOptions, ReleaseReaderOptions, TileTally } from './h3Parquet.js'
export { H3_CHANNEL, listenTileStats, newTap, postTileStats, TileTotals } from './h3Tap.js'
export type { FileInfo, H3Counts, H3FileStats, H3ReleaseStats, H3TileStats } from './h3Tap.js'
export { readReleaseStats, statsMatch } from './h3Stats.js'
export { cellRange, rowCell, speciesForCell } from './h3Species.js'
export type { CellSpecies, SpeciesForCellOptions, SpeciesValue } from './h3Species.js'
export type { StatsMatch, StatsRow } from './h3Stats.js'
export { COMPRESSORS, DEFAULT_TAIL, newReadStats, openRangeFile } from './parquetFile.js'
export type { RangeFile, RangeFileOptions, ReadStats } from './parquetFile.js'
export type { Gzip, H3jArchive, H3jArchiveOptions } from './h3Archive.js'
