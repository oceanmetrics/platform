// the legend of a release layer from the release's own stats.parquet (read-only): one row per layer x key x rank x
// period x res x variable with min, p02, p50, p98, max and n_cells, as obisindicators writes it. the slot's colour
// domain is p02 to p98 of the layer, period, resolution and indicator, never the loaded cells' range. hyparquet skips
// the row groups whose `layer` and `key` statistics cannot match (the file is sorted by layer, key), and one read
// returns every resolution and variable of the layer and period, so an indicator or zoom change reads nothing more.
// loaded lazily by the slot (h3Release.ts), so the main thread pays for hyparquet only when a release layer shows.
import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { COMPRESSORS, openRangeFile } from './parquetFile.js'
import type { ReadStats } from './parquetFile.js'

/** which rows of stats.parquet a layer's legend reads. the release's naming: `layer` is `all`, `eov` or `taxon` for
 * all time and `<grain>_<layer>` for a period (`decade_all`, `year_eov`), `key` the EOV or taxon name ('' for all),
 * `rank` the taxon's rank ('' otherwise), and the period column is the grain (`decade`, `year`) holding the period's
 * year (1990 for `1990s`) */
export interface StatsMatch {
  layer: string
  key?: string
  rank?: string
  period?: { column: string; value: number } | null
}

export interface StatsRow {
  res: number
  variable: string
  min: number
  p02: number
  p50: number
  p98: number
  max: number
  n_cells: number
}

const PERIOD_COLUMNS = ['decade', 'year', 'month']
const VALUE_COLUMNS = ['min', 'p02', 'p50', 'p98', 'max', 'n_cells'] as const

/** the match of a release item and period: `{ layer: 'all' }` and `{ grain: 'decade', value: '1990s' }` give
 * `{ layer: 'decade_all', period: { column: 'decade', value: 1990 } }` */
export function statsMatch(item: { layer: string; key?: string; rank?: string }, period: { grain: string; value: string } | null): StatsMatch {
  if (!period) return { layer: item.layer, key: item.key ?? '', rank: item.rank ?? '', period: null }
  const value = parseInt(period.value, 10)
  if (!Number.isFinite(value)) throw new RangeError(`stats: period ${period.value} has no year to match`)
  return { layer: `${period.grain}_${item.layer}`, key: item.key ?? '', rank: item.rank ?? '', period: { column: period.grain, value } }
}

/** the rows of stats.parquet for one layer and period (every resolution and variable) */
export async function readReleaseStats(url: string, match: StatsMatch, opts: { fetch?: typeof fetch; stats?: ReadStats; tail?: number } = {}): Promise<StatsRow[]> {
  const file = await openRangeFile(url, { fetch: opts.fetch, stats: opts.stats, tail: opts.tail })
  if (!file) throw new Error(`${url}: not found`)
  const metadata = await parquetMetadataAsync(file, { initialFetchSize: Math.min(file.tailBytes, file.byteLength), geoparquet: false })
  const names = new Set(metadata.schema.slice(1).map((s) => s.name))
  const periodCols = PERIOD_COLUMNS.filter((c) => names.has(c))
  const columns = ['layer', 'key', 'rank', ...periodCols, 'res', 'variable', ...VALUE_COLUMNS].filter((c) => names.has(c))
  const key = match.key ?? '', rank = match.rank ?? ''
  const rows = await parquetReadObjects({
    file, metadata, columns, compressors: COMPRESSORS,
    filter: { layer: { $eq: match.layer }, key: { $eq: key } },
  })
  const want = match.period
  return rows
    .filter((r) => (r.rank ?? '') === rank)
    .filter((r) => want
      ? r[want.column] != null && Number(r[want.column]) === want.value
      : periodCols.every((c) => r[c] == null))
    .map((r) => ({
      res: Number(r.res), variable: String(r.variable), min: Number(r.min), p02: Number(r.p02), p50: Number(r.p50),
      p98: Number(r.p98), max: Number(r.max), n_cells: Number(r.n_cells),
    }))
    .sort((a, b) => a.res - b.res || (a.variable < b.variable ? -1 : a.variable > b.variable ? 1 : 0))
}
