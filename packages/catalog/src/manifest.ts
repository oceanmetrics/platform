// the indicators catalog's two files as types: the manifest (indicators.json) and the coverage table
// (coverage.parquet), as oceanmetrics/indicators writes them. types and a few constants only, no runtime dependency;
// the readers are in indicators.ts, the card rules in cards.ts.
import type { Grain, Status, Trend } from '@oceanmetrics/status'

/** the indicators catalog root on storage */
export const DEFAULT_INDICATORS_BASE = 'https://storage.oceanmetrics.io/indicators/'
/** the indicators app, whose Place view is the deep view of a place */
export const INDICATORS_APP = 'https://oceanmetrics.io/indicators/'
/** erddap-places, where a place nobody computed can be computed */
export const ERDDAP_PLACES_APP = 'https://oceanmetrics.io/erddap-places/'

// ---- the manifest ----

export interface IndicatorProvider { name: string; roles: string[]; url?: string }

/** the dataset an indicator is computed from: its citation, DOI, providers and licence */
export interface IndicatorDataset {
  id: string
  title: string
  /** the STAC collection id in the gazetteer (`erddap/<id>`) */
  collection?: string
  stac?: string
  via?: string
  providers?: IndicatorProvider[]
  license?: string
  citation?: string | null
  doi?: string | null
}

/** one values collection of an indicator: `path` is its values parquet under the catalog base */
export interface IndicatorCollection { coll: string; places?: number; rows?: number; path?: string; time_range?: [string, string] }

/** one indicator of the manifest (the fields the readers and cards use; indicators.json has more) */
export interface ManifestIndicator {
  id: string
  title: string
  short?: string
  description?: string
  unit?: string
  unit_label?: string
  decimals?: number
  kind: 'continuous' | 'categorical'
  classes?: Record<string, string>
  ordinal?: boolean
  category?: Record<string, string>
  series: string
  series_title?: string
  variable?: string
  lead: boolean
  preferred?: boolean
  min_periods?: number
  /** the grain a status is given at */
  status_grain: Grain
  /** `iea-sd`, `names-pct`, `values`, or a method not implemented yet (shown as values) */
  status_method: string
  recent?: number
  time_grains?: Grain[]
  time_range?: [string, string]
  method?: { kind: string; summary: string; code?: string }
  producer?: { name: string; url?: string; catalog?: string }
  dataset?: IndicatorDataset
  /** the values' licence (SPDX) */
  license?: string
  /** the full citation: the dataset's, then a "Values: Ocean Metrics Indicators, manifest <v>, <id>, ..." clause */
  citation?: string
  collections?: IndicatorCollection[]
}

/** a named list of place groups (gazetteer collections) offered as one choice */
export interface PlaceSet { id: string; title: string; groups: string[]; note?: string }

/** indicators.json */
export interface IndicatorsManifest {
  version: string
  contract?: string
  created?: string
  vocabularies?: Record<string, unknown>
  indicators: ManifestIndicator[]
  place_sets?: PlaceSet[]
}

// ---- the coverage table ----

/** the columns the cards and the rollups read (the default projection): the sparkline and the statistics stay undecoded */
export const COVERAGE_COLUMNS = [
  'place_id', 'coll', 'indicator', 'time_grain', 'n_periods', 'last_time', 'last_value', 'last_class',
  'status_method', 'status', 'trend', 'why', 'sentence',
] as const

/** every column of coverage.parquet, in file order */
export const ALL_COVERAGE_COLUMNS = [
  'place_id', 'place_name', 'coll', 'place_coll', 'display_id', 'lat', 'lon', 'indicator', 'time_grain', 't0', 't1',
  'n_periods', 'last_time', 'last_value', 'last_class', 'status_method', 'status', 'trend', 'recent_mean', 'recent_from',
  'recent_to', 'lt_mean', 'lt_sd', 'why', 'sentence', 'spark',
] as const

export type CoverageColumn = (typeof ALL_COVERAGE_COLUMNS)[number]

/**
 * one row of coverage.parquet: a place x indicator x grain. the COVERAGE_COLUMNS are always there; the rest only when
 * read (the `columns` option of loadCoverage).
 */
export interface CoverageRow {
  place_id: string
  /** the values collection the row was read from (`places`, `mr_eez`): which values file holds it */
  coll: string
  indicator: string
  time_grain: Grain
  n_periods: number
  last_time: string | null
  last_value: number | null
  last_class: string | null
  status_method: string | null
  status: Status | null
  trend: Trend | null
  why: string | null
  sentence: string | null
  place_name?: string
  /** the place's home gazetteer collection; readers use `place_coll ?? coll` */
  place_coll?: string | null
  display_id?: string | null
  lat?: number | null
  lon?: number | null
  t0?: string | null
  t1?: string | null
  recent_mean?: number | null
  recent_from?: string | null
  recent_to?: string | null
  lt_mean?: number | null
  lt_sd?: number | null
  /** the sparkline, JSON text */
  spark?: string | null
}
