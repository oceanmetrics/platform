// @oceanmetrics/catalog/indicators: the readers of the indicators catalog (indicators.json and coverage.parquet, with
// hyparquet's column projection), and every card rule of ./cards.js, so an app imports one subpath. fetch is passed in,
// so tests read synthetic fixtures without a network. the package root never imports this file: hyparquet stays out of
// an app that only needs the profile types.
import { parquetReadObjects } from 'hyparquet'
import { coverageFor, slash } from './cards.js'
import { COVERAGE_COLUMNS, DEFAULT_INDICATORS_BASE } from './manifest.js'
import type { CoverageColumn, CoverageRow, IndicatorsManifest } from './manifest.js'

export * from './cards.js'

/** read indicators.json under the catalog base */
export async function loadManifest(base: string = DEFAULT_INDICATORS_BASE, fetchFn: typeof fetch = fetch): Promise<IndicatorsManifest> {
  const r = await fetchFn(slash(base) + 'indicators.json')
  if (!r.ok) throw new Error(`indicators.json: HTTP ${r.status} at ${slash(base)}`)
  return (await r.json()) as IndicatorsManifest
}

export interface LoadCoverageOptions {
  /** the columns to decode; COVERAGE_COLUMNS (what the cards and the rollups read) by default */
  columns?: readonly CoverageColumn[]
  /** keep one place's rows (place_id is then read whatever `columns` says) */
  placeId?: string
  fetch?: typeof fetch
}

/** hyparquet gives int64 as bigint: the rows carry plain numbers */
const plain = (o: Record<string, unknown>) => {
  for (const k in o) if (typeof o[k] === 'bigint') o[k] = Number(o[k])
  return o
}

/**
 * the rows of coverage.parquet, projected to `columns` (the whole file is fetched: one cacheable request; only the
 * projected columns are decoded)
 */
export async function loadCoverage(base: string = DEFAULT_INDICATORS_BASE, opts: LoadCoverageOptions = {}): Promise<CoverageRow[]> {
  const fetchFn = opts.fetch ?? fetch
  const cols = [...(opts.columns ?? COVERAGE_COLUMNS)]
  if (opts.placeId != null && !cols.includes('place_id')) cols.unshift('place_id')
  const r = await fetchFn(slash(base) + 'coverage.parquet')
  if (!r.ok) throw new Error(`coverage.parquet: HTTP ${r.status} at ${slash(base)}`)
  const file = await r.arrayBuffer()
  const rows = (await parquetReadObjects({ file, columns: cols })).map((o) => plain(o) as unknown as CoverageRow)
  return opts.placeId != null ? coverageFor(rows, opts.placeId) : rows
}
