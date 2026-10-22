// the words: one deterministic status sentence and one alt text per result, never written by a model. statuses are
// relative to the place's own record, and the words say so; they never say better or worse.
import { grainNoun, periodLabel, spanLabel, yearOf } from './grid.js'
import type { Grain, Point, StatusResult, TextContext } from './types.js'

/** a number as the indicator shows it */
export function fmt(v: number | null, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '–'
  const s = v.toFixed(decimals)
  return s.startsWith('-') ? `−${s.slice(1)}` : s
}

const withUnit = (s: string, unit?: string) => (unit ? `${s} ${unit}` : s)

/**
 * consecutive periods collapsed into ranges: ['1997','1998','2014','2015','2016','2019'] -> '1997–1998, 2014–2016 and
 * 2019'. ecoidx's monthly alt text repeats each year once per month; this never does.
 */
export function collapseRuns(ts: string[], grain: Grain, next: (t: string) => string): string {
  const sorted = [...new Set(ts)].sort()
  const runs: [string, string][] = []
  for (const t of sorted) {
    const last = runs[runs.length - 1]
    if (last && next(last[1]) === t) last[1] = t
    else runs.push([t, t])
  }
  const parts = runs.map(([a, b]) => spanLabel(a, b, grain))
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const STATUS_WORDS: Record<string, (r: StatusResult, ref: string) => string> = {
  'iea-sd:above': (_r, ref) => `was more than 1 SD above ${ref}`,
  'iea-sd:within': (_r, ref) => `was within 1 SD of ${ref}`,
  'iea-sd:below': (_r, ref) => `was more than 1 SD below ${ref}`,
  'names-pct:above': (_r, ref) => `was above the 90th percentile of ${ref}`,
  'names-pct:within': (_r, ref) => `was between the 10th and 90th percentiles of ${ref}`,
  'names-pct:below': (_r, ref) => `was below the 10th percentile of ${ref}`,
}
const TREND_WORDS = {
  up: 'and rose by more than 1 SD',
  flat: 'and changed by less than 1 SD',
  down: 'and fell by more than 1 SD',
}

/** what the long-term statistics were taken over, as a reader says it */
function reference(r: StatusResult, grain: Grain, baseline?: [number, number] | null): string {
  const what = r.method === 'names-pct' ? 'record' : 'mean'
  if (baseline) return `its ${baseline[0]}–${baseline[1]} ${r.method === 'names-pct' ? 'baseline' : 'baseline mean'}`
  return `its ${spanLabel(r.t0 as string, r.t1 as string, grain)} ${what}`
}

/** the status sentence, e.g. "Sea surface temperature in Channel Islands over the last 5 years (2021–2025) was more
 * than 1 SD above its 1982–2025 mean, and rose by more than 1 SD." */
export function sentence(r: StatusResult, ctx: TextContext, grain: Grain, recent = 5,
                         baseline?: [number, number] | null, last?: Point | null): string {
  const head = `${ctx.title} in ${ctx.place}`
  if (r.method === 'values' || r.status == null) {
    const lastBit = last && last.v != null
      ? `${withUnit(fmt(last.v, ctx.decimals), ctx.unit)} in ${periodLabel(last.t, grain)}`
      : 'no value'
    if (r.method === 'values') return `${head}: ${lastBit}.`
    return `${head}: ${lastBit}; no status relative to its own record (${r.why}).`
  }
  const span = spanLabel(r.recentFrom as string, r.recentTo as string, grain)
  const status = STATUS_WORDS[`${r.method}:${r.status}`](r, reference(r, grain, baseline))
  const trend = r.trend ? `, ${TREND_WORDS[r.trend]}` : ''
  return `${head} over the last ${recent} ${grainNoun(grain, recent)} (${span}) ${status}${trend}.`
}

/**
 * the alt text of the chart: what it shows, the long-term statistics, when the series was outside them (runs
 * collapsed), the last value, and the status in words.
 */
export function altText(r: StatusResult, series: Point[], ctx: TextContext, grain: Grain,
                        next: (t: string) => string, recent = 5, baseline?: [number, number] | null): string {
  const vals = series.filter(p => p.v != null)
  if (vals.length === 0) return noValues(ctx)
  const d = ctx.decimals
  const unit = ctx.unit ? ` (${ctx.unit})` : ''
  const parts = [`Time series of ${ctx.title}${unit} in ${ctx.place}, ${spanLabel(vals[0].t, vals[vals.length - 1].t, grain)}, ${vals.length} ${grainNoun(grain, vals.length)} with values.`]
  if (r.method === 'iea-sd' && r.ltMean != null && r.ltSd != null) {
    const lo = r.ltMean - r.ltSd
    const hi = r.ltMean + r.ltSd
    const over = baseline ? `${baseline[0]}–${baseline[1]}` : 'the whole record'
    parts.push(`The mean over ${over} is ${fmt(r.ltMean, d)}, and 1 SD either side spans ${fmt(lo, d)} to ${fmt(hi, d)}.`)
    const above = vals.filter(p => (p.v as number) > hi).map(p => p.t)
    const below = vals.filter(p => (p.v as number) < lo).map(p => p.t)
    parts.push(above.length ? `Values were more than 1 SD above the mean in ${collapseRuns(above, grain, next)}.` : 'Values were never more than 1 SD above the mean.')
    parts.push(below.length ? `Values were more than 1 SD below the mean in ${collapseRuns(below, grain, next)}.` : 'Values were never more than 1 SD below the mean.')
  } else if (r.method === 'names-pct' && r.p10 != null && r.p90 != null) {
    parts.push(`The median is ${fmt(r.ltMean, d)}; the 10th and 90th percentiles are ${fmt(r.p10, d)} and ${fmt(r.p90, d)}.`)
  }
  const last = vals[vals.length - 1]
  parts.push(`The last value is ${withUnit(fmt(last.v, d), ctx.unit)} in ${periodLabel(last.t, grain)}.`)
  if (r.status != null) {
    // the status in words, with the series as its subject (the sentence's subject is the indicator in the place)
    const span = spanLabel(r.recentFrom as string, r.recentTo as string, grain)
    const status = STATUS_WORDS[`${r.method}:${r.status}`](r, reference(r, grain, baseline))
    parts.push(`Over the last ${recent} ${grainNoun(grain, recent)} (${span}) the series ${status}${r.trend ? `, ${TREND_WORDS[r.trend]}` : ''}.`)
  }
  else if (r.method !== 'values' && r.why) parts.push(`No status: ${r.why}.`)
  return parts.join(' ')
}

/** years of a span, for captions: "1982–2025" */
export const yearsSpan = (t0: string, t1: string) => (yearOf(t0) === yearOf(t1) ? `${yearOf(t0)}` : `${yearOf(t0)}–${yearOf(t1)}`)

/** a categorical indicator's last period, in words: "Bleaching alert in Florida Keys: No Stress over 85% of the
 * area in 2025." (no status: categorical indicators are shown as class shares) */
export function categoricalSentence(ctx: TextContext, classLabel: string, share: number, period: string): string {
  return `${ctx.title} in ${ctx.place}: ${classLabel} over ${Math.round(share * 100)}% of the area in ${period}.`
}

/** a place with no values for an indicator, in words */
export function noValues(ctx: TextContext): string {
  return `${ctx.title} in ${ctx.place}: no values.`
}

/** the alt text of a categorical chart (stacked class shares): the sentence, the span and the classes */
export function categoricalAlt(sentenceText: string, t0: string, t1: string, grain: Grain, periods: number,
                               classLabels: string[]): string {
  return `${sentenceText} Stacked shares of the area by class for ${spanLabel(t0, t1, grain)}, ${periods} ${grainNoun(grain, periods)}; classes: ${classLabels.join(', ')}.`
}
