// the quad plot's coordinates and words (the IEA quad plot): a result as a point whose x is the recent trend and whose
// y is the recent mean's departure from the long-term mean, both in SD units of the place's own record. like every
// status word, these are statistical and relative to the record: above/below the long-term mean and rising/falling,
// never better or worse. the dashed guides at ±1 SD are the thresholds of iea-sd (a departure or a change of exactly 1 SD
// is none); names-pct judges its status by percentiles, so its points sit by the same SD scale while the status keeps
// the percentile rule (quadWords says so).
import { fmt } from './text.js'
import type { MethodId, StatusResult } from './types.js'

export interface QuadPoint {
  /** the recent trend: the fitted change over the recent window, in long-term SDs (delta / ltSd) */
  x: number
  /** the recent mean's departure from the long-term mean (mean or median), in long-term SDs */
  y: number
}

const METHODS: MethodId[] = ['iea-sd', 'names-pct']

/** the point of a result, or null when it has none (see quadWhy) */
export function quadPoint(r: StatusResult): QuadPoint | null {
  if (!METHODS.includes(r.method)) return null
  if (r.ltSd == null || !(r.ltSd > 0) || !Number.isFinite(r.ltSd)) return null
  if (r.recentMean == null || r.ltMean == null || r.delta == null) return null
  return { x: r.delta / r.ltSd, y: (r.recentMean - r.ltMean) / r.ltSd }
}

/** why a result has no point, in words; '' when it has one */
export function quadWhy(r: StatusResult): string {
  if (!METHODS.includes(r.method)) return 'no status method is on for this indicator, so there is no trend or departure to place'
  if (quadPoint(r)) return ''
  if (r.ltMean == null || r.ltSd == null) return r.why ?? 'the record is too short for a long-term mean and SD'
  if (!(r.ltSd > 0)) return 'its record does not vary (an SD of 0), so SD units are undefined'
  if (r.recentMean == null) return r.why ?? 'no value in the recent window'
  return r.why ?? 'fewer than 2 values in the recent window, so no trend'
}

export type Quadrant = 'above-rising' | 'above-falling' | 'below-rising' | 'below-falling'

/** the quadrant of a point: its sign on each axis (a point on an axis counts as rising and as above) */
export function quadrantOf(p: QuadPoint): Quadrant {
  return `${p.y >= 0 ? 'above' : 'below'}-${p.x >= 0 ? 'rising' : 'falling'}` as Quadrant
}

/** the corner captions of the plot, statistical */
export const QUADRANT_WORDS: Record<Quadrant, string> = {
  'above-rising': 'recent mean above its long-term mean, rising',
  'above-falling': 'recent mean above its long-term mean, falling',
  'below-rising': 'recent mean below its long-term mean, rising',
  'below-falling': 'recent mean below its long-term mean, falling',
}

/** the same captions short enough for a phone's corners */
export const QUADRANT_SHORT: Record<Quadrant, string> = {
  'above-rising': 'above, rising',
  'above-falling': 'above, falling',
  'below-rising': 'below, rising',
  'below-falling': 'below, falling',
}

const sd1 = (v: number) => `${fmt(Math.abs(v), 1)} SD`
const side = (v: number, hi: string, lo: string) => (v >= 0 ? hi : lo)

/** one point in words, e.g. "recent mean 1.5 SD above its long-term mean, beyond 1 SD; rising 1.2 SD over the recent window, more than 1 SD" */
export function quadWords(p: QuadPoint, method: MethodId = 'iea-sd'): string {
  const out = Math.abs(p.y) > 1
  const big = Math.abs(p.x) > 1
  const dev = `recent mean ${sd1(p.y)} ${side(p.y, 'above', 'below')} its long-term ${method === 'names-pct' ? 'median' : 'mean'}${out ? ', beyond 1 SD' : ', within 1 SD'}`
  const trend = `${p.x === 0 ? 'no change' : `${side(p.x, 'rising', 'falling')} ${sd1(p.x)}`} over the recent window${big ? ', more than 1 SD' : ', less than 1 SD'}`
  return `${dev}; ${trend}${method === 'names-pct' ? '. Its status is by percentiles of the record, not by this SD scale' : ''}`
}

export interface QuadLabelled {
  label: string
  point: QuadPoint | null
  /** why there is none */
  why?: string
}

/**
 * the alt text of a quad plot: how many points are drawn, the axes, how many sit in each quadrant and which lie beyond 1 SD
 * on either axis, and how many could not be placed.
 */
export function quadAlt(items: QuadLabelled[], title = 'Quad plot'): string {
  const drawn = items.filter(i => i.point) as (QuadLabelled & { point: QuadPoint })[]
  const skipped = items.length - drawn.length
  if (drawn.length === 0) return `${title}: no point could be placed, ${items.length} ${items.length === 1 ? 'was' : 'were'} left out (see the list under the chart).`
  const counts = new Map<Quadrant, number>()
  for (const d of drawn) counts.set(quadrantOf(d.point), (counts.get(quadrantOf(d.point)) ?? 0) + 1)
  const parts = (Object.keys(QUADRANT_WORDS) as Quadrant[]).filter(q => counts.has(q)).map(q => `${counts.get(q)} with ${QUADRANT_WORDS[q]}`)
  const beyond = drawn.filter(d => Math.abs(d.point.x) > 1 || Math.abs(d.point.y) > 1).map(d => d.label)
  return [
    `${title}: ${drawn.length} ${drawn.length === 1 ? 'point' : 'points'}, the recent trend (x) against the recent mean's departure from the long-term mean (y), both in SD units of each record.`,
    `${parts.join('; ')}.`,
    beyond.length ? `Beyond 1 SD on an axis: ${beyond.join(', ')}.` : 'None is beyond 1 SD on either axis.',
    skipped ? `${skipped} left out, no coordinates.` : '',
  ].filter(Boolean).join(' ')
}
