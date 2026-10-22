// names-pct: the NaMES convention. the long-term median with the 10th and 90th percentiles (R quantile type 7) of the
// record (or the baseline); status compares the mean of the recent window with them: above the 90th percentile,
// below the 10th, else within. the trend is iea-sd's: the linear fit over the window against one sample SD.
import { mean, median, quantile7, sd } from './stats.js'
import { grainNoun } from './grid.js'
import { IEA_SD_DEFAULTS, longTermValues, noStatus, recentWindow, trendOf } from './ieaSd.js'
import type { Point, StatusOptions, StatusResult } from './types.js'

export function namesPct(series: Point[], opts: StatusOptions): StatusResult {
  const recent = opts.recent ?? IEA_SD_DEFAULTS.recent
  const minPeriods = opts.minPeriods ?? IEA_SD_DEFAULTS.minPeriods
  const rows = [...series].sort((a, b) => a.t.localeCompare(b.t))
  const n = rows.filter(p => p.v != null).length
  if (n < minPeriods) {
    return noStatus('names-pct', rows, `${n} ${grainNoun(opts.grain, n)} of record, fewer than the ${minPeriods} a status needs`)
  }
  const lt = longTermValues(rows, opts.baseline)
  if (lt.length < 2) {
    return noStatus('names-pct', rows, `${lt.length} ${grainNoun(opts.grain, lt.length)} in the baseline, too few for percentiles`)
  }
  const ltMean = median(lt)
  const p10 = quantile7(lt, 0.1)
  const p90 = quantile7(lt, 0.9)
  const ltSd = sd(lt)
  const win = recentWindow(rows, recent)
  const winVals = win.filter(p => p.v != null).map(p => p.v as number)
  const base = noStatus('names-pct', rows, '')
  if (winVals.length === 0) {
    return { ...base, ltMean, ltSd, p10, p90, why: `no value in the last ${recent} ${grainNoun(opts.grain, recent)}` }
  }
  const recentMean = mean(winVals)
  const status = recentMean > p90 ? 'above' : recentMean < p10 ? 'below' : 'within'
  const { delta, trend } = trendOf(win, ltSd, ltMean)
  return {
    ...base, status, trend, recentMean, recentFrom: win[0].t, recentTo: win[win.length - 1].t, ltMean, ltSd, p10, p90,
    delta, why: trend == null ? `fewer than 2 values in the last ${recent} ${grainNoun(opts.grain, recent)}, so no trend` : null,
  }
}
