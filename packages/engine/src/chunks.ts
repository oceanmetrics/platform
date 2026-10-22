// the time chunking of a long window: a window is cut into requests of at most 90 time steps and 100,000 values, so a
// server is asked many light questions instead of a few heavy ones. moved from erddap-places `precompute/src/stats.ts`
// (`window`, `chunks`, `chunkDaysFor`) with the two constants of `precompute/src/targets.ts`; the arithmetic is
// unchanged, and the two limits are now options (defaulting to the precompute's values) so the browser preview runs
// the same rule.
import { addDays, day, daysBetween, type TimeExtent } from './extent.js'

/** never ask ERDDAP for more than this many time steps in one request (90 days of a daily grid). */
export const MAX_CHUNK_DAYS = 90
/**
 * and shrink the chunk further so a single request (one lobe) stays under this many values: the
 * `n_max_vals_per_req = 100000` of marinebon/extractr `ed_extract()`, which keeps an ERDDAP server
 * responsive with many light requests instead of a few heavy ones.
 */
export const MAX_REQUEST_VALUES = 100_000

export interface ChunkLimits {
  /** values per request (one lobe): time steps x axis cells */
  maxValues?: number
  /** time steps per request */
  maxDays?: number
}

/** the last `days` days of the dataset, or its full extent when that is shorter (or `days` is 'all'). */
export function window(ext: TimeExtent, days: number | 'all' = 'all'): { start: string; end: string } {
  const end = day(ext.end)
  if (days === 'all' || !Number.isFinite(days)) return { start: day(ext.start), end }
  let start = addDays(end, -(days - 1))
  if (daysBetween(day(ext.start), start) < 0) start = day(ext.start)
  return { start, end }
}

/** split [start, end] into consecutive, non-overlapping slices of at most `chunkDays` days. */
export function chunks(start: string, end: string, chunkDays: number): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let s = start
  while (daysBetween(s, end) >= 0) {
    const e = addDays(s, chunkDays - 1)
    out.push([s, daysBetween(e, end) < 0 ? end : e])
    s = addDays(e, 1)
  }
  return out
}

/**
 * days per request: `maxDays` time steps (90 days of a daily grid; a coarser grid's steps are
 * counted in its own days, so a monthly product asks for up to 90 months at once), shrunk so one
 * request stays under `maxValues` values (extractr's n_max_vals_per_req). `cellsPerStep` is the
 * largest lobe's axis cells: each lobe is its own request. Never below one step.
 */
export function chunkDaysFor(cellsPerStep: number, stepDays = 1,
                             { maxValues = MAX_REQUEST_VALUES, maxDays = MAX_CHUNK_DAYS }: ChunkLimits = {}): number {
  const sd  = Math.max(1, stepDays)
  const cap = Math.floor(maxDays * sd)
  if (!(cellsPerStep > 0)) return cap
  const steps = Math.max(1, Math.floor(maxValues / cellsPerStep))
  return Math.max(1, Math.min(cap, Math.floor(steps * sd)))
}
