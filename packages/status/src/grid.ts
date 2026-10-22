// periods: completing a series to a regular grid, the x a fit uses, and labels for text.
import type { Grain, Point } from './types.js'

const ymd = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** the period after `t` at `grain` (not for 'all') */
export function nextPeriod(t: string, grain: Grain): string {
  const [y, m, d] = t.split('-').map(Number)
  switch (grain) {
    case 'decade': return ymd(y + 10, 1, 1)
    case 'year': return ymd(y + 1, 1, 1)
    case 'month': return m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1)
    case 'day': {
      const n = new Date(Date.UTC(y, m - 1, d + 1))
      return ymd(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate())
    }
    default: throw new Error(`no next period for grain ${grain}`)
  }
}

/**
 * the series sorted by time with a null row for every missing period between its first and last value, so that "the
 * last `recent` rows" means the last `recent` periods on the calendar, as on a complete annual frame in ecoidx.
 * leading and trailing nulls are dropped.
 */
export function completeGrid(series: Point[], grain: Grain): Point[] {
  const vals = series.filter(p => p.v != null && Number.isFinite(p.v)).sort((a, b) => a.t.localeCompare(b.t))
  if (grain === 'all' || vals.length === 0) return vals
  const byT = new Map(vals.map(p => [p.t, p.v]))
  const out: Point[] = []
  const last = vals[vals.length - 1].t
  for (let t = vals[0].t; t <= last; t = nextPeriod(t, grain)) {
    out.push({ t, v: byT.get(t) ?? null })
    if (out.length > 100_000) throw new Error('completeGrid: runaway grid')
  }
  return out
}

/**
 * the x of a period for the trend fit: seconds since 1970 at its start, as ecoidx regresses on as.POSIXct of
 * "YYYY-01-01" (local midnight; the offset is the same for every 1 January, so it cancels in the slope). leap years
 * make yearly x slightly uneven; matching that keeps the port exact.
 */
export function periodX(t: string): number {
  const [y, m, d] = t.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 1000
}

/** the year of a period start */
export const yearOf = (t: string) => Number(t.slice(0, 4))

/** a period as a reader says it: 2020, 2020-03, the 2010s, 2020-03-17 */
export function periodLabel(t: string, grain: Grain): string {
  switch (grain) {
    case 'decade': return `the ${t.slice(0, 4)}s`
    case 'year': return t.slice(0, 4)
    case 'month': return t.slice(0, 7)
    default: return t
  }
}

/** a span of periods as a reader says it: 2021–2025, 2025, Mar 2021–Feb 2026 */
export function spanLabel(t0: string, t1: string, grain: Grain): string {
  const a = periodLabel(t0, grain)
  const b = periodLabel(t1, grain)
  return a === b ? a : `${a}–${b}`
}

/** the grain's name for a count of periods */
export function grainNoun(grain: Grain, n: number): string {
  const one = { all: 'period', decade: 'decade', year: 'year', month: 'month', day: 'day' }[grain]
  return n === 1 ? one : `${one}s`
}
