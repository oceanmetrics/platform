// iea-sd: the CCIEA status and trend, ported from ecoidx PlotTimeSeries() (R/PlotTimeSeries.R), NOT the newer
// plot_ts(), which compares the recent mean itself with 1 SD instead of its departure from the long-term mean
// (R/plot.R:167-168) and whose + / - captions are reversed.
//
// as PlotTimeSeries() computes it, row for row:
//   mn, stdev    mean and sample SD of the whole series (or of the baseline years, `stats.years`)
//   Y5, X5       the last `recent` ROWS (PERIOD = 5): NA rows count toward the window
//   delta        predict(lm(Y5 ~ X5)) at its last point minus at its first (NA rows dropped)
//   trend        flat when |delta| - stdev <= 0, else up (delta > 0) or down
//   mn5          mean(Y5, na.rm = TRUE)
//   status       within when |mn - mn5| - stdev <= 0, else above (mn5 > mn, drawn "+") or below (drawn "_")
// a change of exactly one SD is not a change, and a change within round-off of zero is none (ROUND_OFF). the x of the fit is each period's start in seconds (as.POSIXct).
// the gate ecoidx does not have: fewer than `minPeriods` non-null values gives no status and no trend, with why.
import { mean, sd, fitDelta } from './stats.js'
import { periodX, yearOf, grainNoun } from './grid.js'
import type { Point, StatusOptions, StatusResult } from './types.js'

export const IEA_SD_DEFAULTS = { recent: 5, minPeriods: 10 }

/** the empty result: no status, no trend, and why */
export function noStatus(method: StatusResult['method'], series: Point[], why: string): StatusResult {
  const vals = series.filter(p => p.v != null)
  return {
    method, status: null, trend: null, n: vals.length,
    t0: vals[0]?.t ?? null, t1: vals[vals.length - 1]?.t ?? null,
    recentMean: null, recentFrom: null, recentTo: null, ltMean: null, ltSd: null, p10: null, p90: null,
    delta: null, why,
  }
}

/** the long-term values: the whole record, or the baseline years when given */
export function longTermValues(series: Point[], baseline: [number, number] | null | undefined): number[] {
  return series
    .filter(p => p.v != null && (!baseline || (yearOf(p.t) >= baseline[0] && yearOf(p.t) <= baseline[1])))
    .map(p => p.v as number)
}

/** the recent window: the last `recent` rows, nulls included */
export function recentWindow(series: Point[], recent: number): Point[] {
  return series.slice(Math.max(0, series.length - recent))
}

/** a fitted change this small, relative to the series' scale, is round-off: lm() on a constant series returns
 * |delta| ~ 1e-14 and ecoidx then draws an arrow against sd = 0. here it is no change (flat). */
export const ROUND_OFF = 1e-9

/** trend from the window's linear fit against one SD; `scale` (the long-term mean) sets the round-off floor */
export function trendOf(win: Point[], ltSd: number, scale = 1): { delta: number | null; trend: StatusResult['trend'] } {
  const pts = win.filter(p => p.v != null)
  let delta = fitDelta(pts.map(p => periodX(p.t)), pts.map(p => p.v as number))
  if (delta == null || !Number.isFinite(ltSd)) return { delta, trend: null }
  if (Math.abs(delta) <= ROUND_OFF * Math.max(1, Math.abs(scale))) delta = 0
  const z = Math.abs(delta) - ltSd
  return { delta, trend: z <= 0 ? 'flat' : delta > 0 ? 'up' : 'down' }
}

/** iea-sd on a series as given (rows in time order, nulls allowed); see completeGrid() for calendar windows */
export function ieaSd(series: Point[], opts: StatusOptions): StatusResult {
  const recent = opts.recent ?? IEA_SD_DEFAULTS.recent
  const minPeriods = opts.minPeriods ?? IEA_SD_DEFAULTS.minPeriods
  const rows = [...series].sort((a, b) => a.t.localeCompare(b.t))
  const n = rows.filter(p => p.v != null).length
  if (n < minPeriods) {
    return noStatus('iea-sd', rows, `${n} ${grainNoun(opts.grain, n)} of record, fewer than the ${minPeriods} a status needs`)
  }
  const lt = longTermValues(rows, opts.baseline)
  if (lt.length < 2) {
    return noStatus('iea-sd', rows, `${lt.length} ${grainNoun(opts.grain, lt.length)} in the baseline ${opts.baseline?.join('–')}, too few for a standard deviation`)
  }
  const ltMean = mean(lt)
  const ltSd = sd(lt)
  const win = recentWindow(rows, recent)
  const winVals = win.filter(p => p.v != null).map(p => p.v as number)
  const base = noStatus('iea-sd', rows, '')
  if (winVals.length === 0) {
    return { ...base, ltMean, ltSd, why: `no value in the last ${recent} ${grainNoun(opts.grain, recent)}` }
  }
  const recentMean = mean(winVals)
  const z2 = Math.abs(ltMean - recentMean) - ltSd
  const status = z2 <= 0 ? 'within' : recentMean > ltMean ? 'above' : 'below'
  const { delta, trend } = trendOf(win, ltSd, ltMean)
  return {
    ...base, status, trend, recentMean, recentFrom: win[0].t, recentTo: win[win.length - 1].t, ltMean, ltSd, delta,
    why: trend == null ? `fewer than 2 values in the last ${recent} ${grainNoun(opts.grain, recent)}, so no trend` : null,
  }
}
