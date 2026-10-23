// @oceanmetrics/engine: the browser engine of Ocean Metrics. the mask, the lobes, the ERDDAP requests, the SQL templates
// shared with the Python engine (om_extract), DuckDB-WASM as the statistics engine, the chunked live preview and the
// map's grid slice. see the README for what moved from where.
export { axisEdges, countVertices, gridMask, pointMask, polygonParts, reduceRing, reduceRings } from './mask.js'
export type { GeoInput, MaskCell, MaskMethod, MaskOptions, MaskPoint, MaskResult, PointMaskResult } from './mask.js'
export { polygonCoordinates, wkbToGeoJSON } from './wkb.js'
export { placeLobes } from './lobes.js'
export type { Lobe, LobePlace } from './lobes.js'
export {
  AXIS_TIMEOUT_MS, SLICE_TIMEOUT_MS, constraint, fetchAxis, fetchJsonp, fetchSlab, griddapSliceUrl, griddapUrl, griddapUrls,
  isParquet, noonZ, parseCsvp, pickFormat, tableConstraint, tableToRows, tabledapPlaceConstraints, tabledapUrl,
} from './erddap.js'
export type { Collection, ErddapMeta, Format, GriddapSpec, Slab, TableConstraint, TableOp, TabledapSpec } from './erddap.js'
export {
  INFO_TIMEOUT_MS, addDays, clampWindow, day, daysBetween, defaultWindow, fetchTimeExtent, parseInfoExtent, parseSpacing,
  spanDays, stepLabel, timeInstant,
} from './extent.js'
export type { ClampResult, InfoTable, TimeExtent, Window, WindowOpts } from './extent.js'
export { ErddapUnreachable, fetchRetry, hostOf, mapFailMessage } from './fetchRetry.js'
export type { RetryOpts } from './fetchRetry.js'
export { PatientFetchError, UNKNOWN_DATASET, isRetryable, patientFetch } from './patient.js'
export type { PatientOpts, PatientRetry } from './patient.js'
export { axisSpacing, cellPoints, cellSquares, indexBounds, normalizeLon, pickCenter, placeMapBounds } from './cells.js'
export type { CellPoints, CellProps, CellSquares, CellSquaresOptions, LonCenter, ValueCell } from './cells.js'
export {
  isCategorical, lobeLonSpan, resolveDataset, statsTemplate, toDataset, toDatasetLon, toLongFormat, valueExpr, valueLabel,
} from './dataset.js'
export type { CubeVariable, Dataset, LongFormat } from './dataset.js'
export { MAX_CHUNK_DAYS, MAX_REQUEST_VALUES, chunkDaysFor, chunks, window } from './chunks.js'
export type { ChunkLimits } from './chunks.js'
export { lit, render, template, templateNames } from './sql.js'
export type { Param, Params, TemplateName } from './sql.js'
export { TEMPLATES } from './sqlTemplates.js'
export { Engine, connectBrowser, toRows } from './engine.js'
export type { Duck, DuckConnLike, DuckDbLike, EngineEvent, Row } from './engine.js'
export { isoDay, lobeAxes, lobeMasks, previewWindow, runPreview, sliceSource } from './preview.js'
export type {
  LobeAxes, PreviewChunk, PreviewDataset, PreviewOptions, PreviewResult, SliceCell, SliceSource, SliceSourceOptions,
} from './preview.js'
