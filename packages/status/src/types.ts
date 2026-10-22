// the status methods' shared types. a status is statistical, relative to the place's own record: it never says
// better or worse (plan §6), so the words are above / within / below and up / flat / down.

export type Grain = 'all' | 'decade' | 'year' | 'month' | 'day'
export type Status = 'above' | 'within' | 'below'
export type Trend = 'up' | 'flat' | 'down'
export type MethodId = 'iea-sd' | 'names-pct' | 'values'

/** one period of a series: its start (ISO date, `YYYY-MM-DD`) and its value (null when missing) */
export interface Point {
  t: string
  v: number | null
}

export interface StatusOptions {
  /** grain of the series; sets how periods are labelled and how the grid is completed */
  grain: Grain
  /** the recent window, in rows (periods) at the end of the series; 5 by default */
  recent?: number
  /** fewest non-null periods before a status or trend is given; 10 by default (NaMES) */
  minPeriods?: number
  /** baseline years [from, to] for the long-term statistics (ecoidx `stats.years`); the full record when null */
  baseline?: [number, number] | null
}

export interface StatusResult {
  method: MethodId
  status: Status | null
  trend: Trend | null
  /** non-null periods in the series */
  n: number
  /** first and last period with a value */
  t0: string | null
  t1: string | null
  /** the recent window: its mean and its first and last period */
  recentMean: number | null
  recentFrom: string | null
  recentTo: string | null
  /** long-term centre: the mean (iea-sd) or the median (names-pct), over the record or the baseline */
  ltMean: number | null
  /** long-term sample standard deviation (iea-sd; names-pct uses it for the trend) */
  ltSd: number | null
  /** names-pct only: the 10th and 90th percentiles */
  p10: number | null
  p90: number | null
  /** change of the linear fit over the recent window, last fitted value minus first */
  delta: number | null
  /** why status (or trend) is null, in words; null when both are set */
  why: string | null
}

/** what a sentence or alt text needs to name things */
export interface TextContext {
  /** the indicator, as a reader calls it (e.g. 'Sea surface temperature') */
  title: string
  /** the place, as a reader calls it (e.g. 'Channel Islands') */
  place: string
  /** unit for display (e.g. '°C'); empty for none */
  unit?: string
  /** decimals to show values with */
  decimals?: number
}
