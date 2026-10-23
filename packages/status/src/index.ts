// the status registry: the ONE implementation of every status method, imported by the coverage builder (Node) and
// the viewer (browser). nothing else computes a status, a trend, a status sentence or an alt text.
import { completeGrid, nextPeriod } from './grid.js'
import { ieaSd } from './ieaSd.js'
import { namesPct } from './namesPct.js'
import { altText, sentence } from './text.js'
import { values } from './values.js'
import type { MethodId, Point, StatusOptions, StatusResult, TextContext } from './types.js'

export * from './types.js'
export { completeGrid, nextPeriod, periodLabel, periodX, spanLabel, grainNoun } from './grid.js'
export { quantile7 } from './stats.js'
export { categoricalAlt, categoricalSentence, collapseRuns, fmt, noValues } from './text.js'
export { METHOD_NOTES, STATUS_NOTE, STATUS_WORDS, statusCaption, TREND_WORDS } from './words.js'
export { QUADRANT_SHORT, QUADRANT_WORDS, quadAlt, quadPoint, quadrantOf, quadWhy, quadWords } from './quad.js'
export type { QuadLabelled, QuadPoint, Quadrant } from './quad.js'
export { ieaSd, namesPct, values }

export const STATUS_METHODS: Record<MethodId, (s: Point[], o: StatusOptions) => StatusResult> = {
  'iea-sd': ieaSd,
  'names-pct': namesPct,
  values,
}

export interface Assessment {
  result: StatusResult
  sentence: string
  alt: string
}

/**
 * a series' status by `method`: the series is first completed to the calendar grid at its grain (so the recent
 * window is the last `recent` periods, missing ones included as nulls), then the method runs, then the words.
 */
export function assess(series: Point[], method: MethodId, opts: StatusOptions, ctx: TextContext): Assessment {
  const fn = STATUS_METHODS[method]
  if (!fn) throw new Error(`unknown status method ${method}`)
  const grid = completeGrid(series, opts.grain)
  const result = fn(grid, opts)
  const vals = grid.filter(p => p.v != null)
  const last = vals[vals.length - 1] ?? null
  const recent = opts.recent ?? 5
  const next = (t: string) => nextPeriod(t, opts.grain)
  return {
    result,
    sentence: sentence(result, ctx, opts.grain, recent, opts.baseline, last),
    alt: altText(result, grid, ctx, opts.grain, next, recent, opts.baseline),
  }
}
