// @oceanmetrics/catalog: the names of the STAC layer profiles and the TypeScript types of their fields, and the types of
// the indicators catalog (manifest, coverage rows, cards). types only, no runtime weight beyond two constants, so a
// browser app imports this freely; the validators (ajv) live in the @oceanmetrics/catalog/validate subpath (Node only),
// the indicators readers (hyparquet) in @oceanmetrics/catalog/indicators and the pure card rules in
// @oceanmetrics/catalog/cards. the JSON Schemas in schemas/ are the contract, these types mirror them.

export const PACKAGE = { name: '@oceanmetrics/catalog', version: '0.5.1' } as const

export type * from './manifest.js'
export type { Absence, AbsenceKind, AbsenceTextOptions, CardsOptions, Fold, FoldOptions, IndicatorCard, Reproduce, Rollup, Rollups, Slot, SlotOptions, StatusCounts, StatusGlyph, TrendGlyph } from './cards.js'
export type { LoadCoverageOptions } from './indicators.js'
export type { AtomOptions, ChangeKind, ChangeRow, DiffOptions, DiffRow, FeedKind, FeedSpec, FeedsOptions, FeedsPlaces } from './changes.js'
export type { IndicatorLike, PlaceLike, PlaceSetLike, RuleContext, RuleRow, Rules, RuleSet } from './report.js'

/** the profiles this package defines, one `schemas/<name>.schema.json` each. */
export const PROFILES = ['erddap-grid', 'cog', 'h3', 'atlas-collection', 'atlas-item', 'sdm-dossier', 'om-notebook', 'places-layers', 'values-row', 'values-provenance', 'changes-row', 'changes-latest', 'feeds-index', 'alerts-subscription'] as const
export type Profile = (typeof PROFILES)[number]

type Pair = [number, number]

// ---- erddap-grid ----

export interface ErddapTimeDimension { type: 'temporal'; extent: [string, string | null]; step?: string | null; [key: string]: unknown }
export interface ErddapSpatialDimension {
  type: 'spatial'
  axis: 'x' | 'y' | 'z'
  extent: Pair
  step?: number | null
  reference_system?: number | string | Record<string, unknown>
  unit?: string
  values?: number[]
  [key: string]: unknown
}
export interface ErddapVariable {
  dimensions: string[]
  type: 'data' | 'auxiliary'
  unit: string | null
  description?: string
  'erddap-places:categorical'?: boolean
  /** the label of each class value, keyed by the value as a string. */
  'erddap-places:classes'?: Record<string, string>
  [key: string]: unknown
}
/** the profile fields of an erddap-grid Collection. */
export interface ErddapGridFields {
  'erddap:base_url': string
  'erddap:upstream_url'?: string
  'erddap:dataset_id': string
  'erddap:protocol': 'griddap' | 'tabledap'
  'erddap:version': string
  'erddap:cors': boolean
  'erddap:formats': string[]
  'erddap:lon_range': Pair
  'erddap:lat_descending': boolean
  'erddap-places:depth'?: number
  'erddap-places:status'?: 'pending'
  'erddap-places:long_format'?: { type_column: string; value_column: string }
  'cube:dimensions': { time: ErddapTimeDimension; latitude?: ErddapSpatialDimension; longitude?: ErddapSpatialDimension; depth?: ErddapSpatialDimension; [key: string]: unknown }
  'cube:variables': Record<string, ErddapVariable>
}

// ---- cog ----

export type RasterDataType = 'int8' | 'int16' | 'int32' | 'int64' | 'uint8' | 'uint16' | 'uint32' | 'uint64' | 'float16' | 'float32'
  | 'float64' | 'cint16' | 'cint32' | 'cfloat32' | 'cfloat64' | 'other'
export interface BandStatistics { minimum: number; maximum: number; mean?: number; stddev?: number; valid_percent?: number; [key: string]: unknown }
export interface BandHistogram { count: number; min: number; max: number; buckets: number[] }
export interface CogBand {
  name?: string
  data_type: RasterDataType
  nodata: number | 'nan' | 'inf' | '-inf' | null
  unit?: string
  description?: string
  statistics: BandStatistics
  histogram?: BandHistogram
  [key: string]: unknown
}
/** the atlas draw hints an asset may carry. */
export interface AtlasDrawHints {
  /** the 1-based band to draw; absent = band 1. */
  'atlas:bidx'?: number
  'atlas:rescale'?: Pair | 'auto'
  'atlas:colormap'?: string
}
/** the data asset of a cog Item: bands (STAC 1.1 core) or raster:bands (raster 1.1). */
export interface CogDataAsset extends AtlasDrawHints {
  href: string
  type: string
  roles: string[]
  bands?: CogBand[]
  'raster:bands'?: CogBand[]
  [key: string]: unknown
}

// ---- h3 ----

export interface H3Layout { template: string; parent_template?: string; parent_res?: Record<string, number>; keys?: string[]; row_group_rows?: number }
/** one set of periods of a single grain; `resolutions` is required in a list of sets (profile 1.1). */
export interface H3Periods { grain: 'decade' | 'year' | 'month' | 'all'; values: string[]; placeholder: string; resolutions?: number[]; template?: string }
/** a period set in a list of sets (profile 1.1): its own placeholder and resolutions. */
export interface H3PeriodSet extends H3Periods { resolutions: number[] }
/** the layer key the pre-aggregated heads are published under (profile 1.1). */
export interface H3Heads { layer: string; href?: string }
export interface TableColumn { name: string; type: string; description?: string; [key: string]: unknown }
export interface H3SpeciesTable {
  href_template: string
  resolutions: number[]
  partition_by: string[]
  sorted_by?: string[]
  columns: { cell: string; species: string; count: string; year?: string; name_key?: string; year_min?: string; year_max?: string; period?: string }
  lookup: { href: string; key: string; lineage_column: string; rank_columns?: Record<string, string>; name_column?: string }
  heads?: string
}
/** the profile fields of an h3 Collection. */
export interface H3Fields {
  'h3:resolutions': number[]
  'h3:cell_column': string
  'h3:cell_type': 'string' | 'uint64'
  'h3:layout': H3Layout
  'h3:periods'?: H3Periods | H3PeriodSet[]
  'table:columns': TableColumn[]
  'h3:species_table'?: H3SpeciesTable
  'h3:heads'?: H3Heads
}

// ---- atlas-collection ----

export interface AtlasFlower { dimension: string; composite: string }
export interface AtlasCellSpeciesLink { label: string; column?: string; href_template?: string; same_app?: boolean }
export interface AtlasCellSpecies {
  asset?: string
  lookup_asset: string
  layout: 'tiles'
  tile_deg: number
  href_template: string
  grid: { ncol: number; nrow: number; x0: number; y0: number; res: number }
  key_column: string
  species_column: string
  value_column: string
  lookup_key?: string
  value_unit?: string
  value_range?: Pair
  value_label?: string
  group_column?: string
  group_dimension?: string
  share?: { total_column: string; formula?: string }
  links?: AtlasCellSpeciesLink[]
}
export interface AtlasTaxaRegistry {
  asset: string
  key_column?: string
  row_count?: number
  search_columns?: string[]
  group_column?: string
  index_asset?: string
  legacy_key_column?: string
}
export type UncertaintyKind = 'cv' | 'se' | 'sd' | 'ci90' | 'ci95'
/** a mean surface and its uncertainty: sibling items along `dimension`, or two bands of one asset. */
export type AtlasUncertainty =
  | { pair: 'dimension'; dimension: string; kind: UncertaintyKind; mean: string | number; uncertainty: string | number }
  | { pair: 'band'; dimension?: string; kind: UncertaintyKind; mean: string | number; uncertainty: string | number }
export interface AtlasCubeDimension { 'atlas:labels'?: Record<string, string>; 'atlas:taxon_dim'?: boolean; [key: string]: unknown }
/** the atlas fields of a Collection, all optional. */
export interface AtlasCollectionFields {
  'atlas:funders'?: string[]
  'atlas:access'?: 'restricted'
  'atlas:note'?: string
  'atlas:flower'?: AtlasFlower
  'atlas:cell_species'?: AtlasCellSpecies
  'atlas:taxa_registry'?: AtlasTaxaRegistry
  'atlas:item_template'?: Record<string, unknown>
  'atlas:uncertainty'?: AtlasUncertainty
  'cube:dimensions'?: Record<string, AtlasCubeDimension>
}

// ---- atlas-item ----

export interface AtlasItemProperties {
  /** one value per cube dimension: which cell of the collection's cube this item is. */
  'atlas:dims': Record<string, string>
  'atlas:value_range'?: Pair
  'atlas:absent'?: boolean
  'atlas:absent_note'?: string
  'atlas:metric'?: string
}
export interface AtlasAssetFields extends AtlasDrawHints {
  'atlas:value_column'?: string
  'atlas:key_column'?: string
  'atlas:id_field'?: string
  'sdm:h3_resolution'?: number
}

// ---- sdm-dossier ----

export type SdmResponseType = 'occurrence' | 'range' | 'suitability' | 'probability' | 'density' | 'biomass' | 'mixed' | 'richness' | 'uncertainty'
export type RedlistCode = 'EX' | 'EW' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC' | 'DD' | 'NE'
export interface SdmAuthorities { worms?: string | number; botw?: string | number; itis?: string | number; gbif?: string | number; iucn?: string | number }
/** one taxon of a multi-species product (`sdm:taxa`). */
export interface SdmTaxon { scientific_name: string; authorities?: SdmAuthorities; common_name?: string; group?: string | boolean; redlist_code?: RedlistCode }
export interface SdmAggregation { method: 'mean' | 'sum' | 'max' | 'min' | 'richness' | 'share' | 'composite'; of?: string; n?: number }
export interface SdmMetric { name: string; value: number; partition?: 'train' | 'test' | 'cv' }
export interface SdmEvaluation { metrics: SdmMetric[]; roc?: { fpr: number[]; tpr: number[] }; notes?: string }
export interface SdmResponseCurve { predictor: string; unit?: string; x: number[]; y: number[]; density?: number[] }
/** the sdm fields: in `properties` of an Item, at the top level of a Collection. */
export interface SdmFields {
  'sdm:response_type': SdmResponseType
  'sdm:method': string
  'sdm:method_detail'?: string
  'sdm:source_authority': string
  'sdm:temporal_interval': string
  'sdm:predictors'?: string[]
  'sdm:value_unit'?: string
  'sdm:value_range'?: Pair
  /** one taxon (1.0.0); `group` is a string in the atlas pipeline, a boolean in the MST manifest. */
  'sdm:taxon'?: { scientific_name: string; common_name?: string; authorities?: Record<string, unknown>; group?: string | boolean; redlist_code?: string; [key: string]: unknown }
  'sdm:taxa'?: SdmTaxon[]
  'sdm:aggregation'?: SdmAggregation
  'sdm:evaluation'?: SdmEvaluation
  'sdm:response_curves'?: SdmResponseCurve[]
  [key: `sdm:${string}`]: unknown
}
