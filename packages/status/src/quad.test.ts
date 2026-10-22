// one test per rule of the quad plot's coordinates and words, on small hand-checked series.
import { describe, expect, it } from 'vitest'
import { ieaSd, namesPct, values } from './index.js'
import { QUADRANT_SHORT, QUADRANT_WORDS, quadAlt, quadPoint, quadrantOf, quadWhy, quadWords } from './quad.js'
import type { StatusResult } from './types.js'
import type { Point } from './types.js'

const yearly = (y0: number, vs: (number | null)[]): Point[] => vs.map((v, i) => ({ t: `${y0 + i}-01-01`, v }))
const Y = { grain: 'year' as const }
// 0 1 0 1 ... : mean 0.5, sample SD sqrt(2.5 / 9)
const FLAT = yearly(2011, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
const SD = Math.sqrt(2.5 / 9)
// ten flat years at 0 and 1 then a window of 5 rising by 2 per year: far above and rising
const RISING = yearly(2001, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 4, 6, 8, 10])

describe('quadPoint', () => {
  it('x is the fitted change over the recent window in SDs, y the recent mean minus the long-term mean in SDs', () => {
    const r = ieaSd(RISING, Y)
    const p = quadPoint(r)!
    expect(p.x).toBeCloseTo((r.delta as number) / (r.ltSd as number), 12)
    expect(p.y).toBeCloseTo(((r.recentMean as number) - (r.ltMean as number)) / (r.ltSd as number), 12)
    expect(r.delta).toBeCloseTo(8, 2)   // the fit runs on seconds, so leap days bend it by 0.001
    expect(p.x).toBeGreaterThan(1)
    expect(p.y).toBeGreaterThan(1)
  })
  it('the alternating record sits inside the guides: |x| < 1 and |y| < 1, matching status within and trend flat', () => {
    const r = ieaSd(FLAT, Y)
    const p = quadPoint(r)!
    expect(p.y).toBeCloseTo((0.6 - 0.5) / SD, 12)
    expect(Math.abs(p.y)).toBeLessThan(1)
    expect(Math.abs(p.x)).toBeLessThan(1)
    expect([r.status, r.trend]).toEqual(['within', 'flat'])
  })
  it('agrees with iea-sd at the guides: a point is beyond 1 SD on y exactly when the status is above or below', () => {
    for (const vs of [[0, 1, 0, 1, 0, 1, 0, 1, 0, 1], [0, 1, 0, 1, 0, 1, 5, 5, 5, 5, 5, 5], [9, 9, 9, 9, 9, 9, 1, 0, 1, 0, 1, 0]]) {
      const r = ieaSd(yearly(2000, vs), { ...Y, minPeriods: 5 })
      expect(Math.abs(quadPoint(r)!.y) > 1).toBe(r.status !== 'within')
      expect(Math.abs(quadPoint(r)!.x) > 1).toBe(r.trend !== 'flat')
    }
  })
  it('names-pct has a point too (the same SD scale; its status is by percentiles)', () => {
    const r = namesPct(RISING, Y)
    expect(quadPoint(r)).not.toBeNull()
    expect(quadPoint(r)!.y).toBeCloseTo(((r.recentMean as number) - (r.ltMean as number)) / (r.ltSd as number), 12)
  })
  it('null for the values method, which has no long-term statistics', () => {
    expect(quadPoint(values(FLAT, Y))).toBeNull()
    expect(quadWhy(values(FLAT, Y))).toMatch(/no status method/)
  })
  it('null when the record is too short for a status (minPeriods), with the reason', () => {
    const r = ieaSd(yearly(2018, [1, 2, 3, 4]), Y)
    expect(quadPoint(r)).toBeNull()
    expect(quadWhy(r)).toMatch(/4 years of record, fewer than the 10 a status needs/)
  })
  it('null when the SD is 0 (a constant record), with the reason', () => {
    const r = ieaSd(yearly(2011, Array(10).fill(3)), Y)
    expect(r.ltSd).toBe(0)
    expect(quadPoint(r)).toBeNull()
    expect(quadWhy(r)).toMatch(/SD of 0/)
  })
  it('null when the recent window has no value or a single one (no trend)', () => {
    const none = ieaSd(yearly(2000, [1, 2, 3, 2, 1, 2, 3, 2, 1, 2, null, null, null, null, null]), Y)
    expect(quadPoint(none)).toBeNull()
    expect(quadWhy(none)).toMatch(/no value in the last 5 years/)
    const one = ieaSd(yearly(2000, [1, 2, 3, 2, 1, 2, 3, 2, 1, 2, null, null, null, null, 4]), Y)
    expect(quadPoint(one)).toBeNull()
    expect(quadWhy(one)).toMatch(/fewer than 2 values/)
  })
  it('a result with no ltSd or a NaN SD gives null, not NaN', () => {
    const r = { ...ieaSd(FLAT, Y), ltSd: Number.NaN } as StatusResult
    expect(quadPoint(r)).toBeNull()
  })
  it('why is empty for a point', () => {
    expect(quadWhy(ieaSd(FLAT, Y))).toBe('')
  })
})

describe('quadrants and words', () => {
  it('the quadrant is the sign on each axis; a point on an axis counts as above and rising', () => {
    expect(quadrantOf({ x: 0.5, y: 2 })).toBe('above-rising')
    expect(quadrantOf({ x: -0.5, y: 2 })).toBe('above-falling')
    expect(quadrantOf({ x: 0.5, y: -2 })).toBe('below-rising')
    expect(quadrantOf({ x: -0.5, y: -2 })).toBe('below-falling')
    expect(quadrantOf({ x: 0, y: 0 })).toBe('above-rising')
  })
  it('the corner captions are statistical: never better, worse, good or bad', () => {
    for (const w of Object.values(QUADRANT_WORDS)) {
      expect(w).toMatch(/^recent mean (above|below) its long-term mean, (rising|falling)$/)
      expect(w).not.toMatch(/better|worse|good|bad/)
    }
  })
  it('the short captions name the same four quadrants, still statistical', () => {
    expect(Object.keys(QUADRANT_SHORT)).toEqual(Object.keys(QUADRANT_WORDS))
    for (const [q, w] of Object.entries(QUADRANT_SHORT)) {
      expect(w).toBe(q.replace('-', ', '))
      expect(w).not.toMatch(/better|worse|good|bad/)
    }
  })
  it('a point in words, with minus signs and the 1 SD rule', () => {
    expect(quadWords({ x: 1.24, y: 1.46 })).toBe('recent mean 1.5 SD above its long-term mean, beyond 1 SD; rising 1.2 SD over the recent window, more than 1 SD')
    expect(quadWords({ x: -0.3, y: -0.2 })).toBe('recent mean 0.2 SD below its long-term mean, within 1 SD; falling 0.3 SD over the recent window, less than 1 SD')
    expect(quadWords({ x: 0, y: 0 })).toContain('no change over the recent window')
  })
  it('names-pct words say the status is by percentiles and name the median', () => {
    const w = quadWords({ x: 0.2, y: 1.2 }, 'names-pct')
    expect(w).toContain('its long-term median')
    expect(w).toMatch(/status is by percentiles of the record, not by this SD scale$/)
  })
})

describe('quadAlt', () => {
  it('counts the quadrants, names the points beyond 1 SD and the ones left out', () => {
    const alt = quadAlt([
      { label: 'SST', point: { x: 1.5, y: 2 } },
      { label: 'Chlorophyll', point: { x: -0.2, y: -0.4 } },
      { label: 'Oxygen', point: { x: 0.1, y: 0.2 } },
      { label: 'Sea level', point: null, why: 'too short' },
    ])
    expect(alt).toBe(
      'Quad plot: 3 points, the recent trend (x) against the recent mean\'s departure from the long-term mean (y), both in SD units of each record. ' +
      '2 with recent mean above its long-term mean, rising; 1 with recent mean below its long-term mean, falling. Beyond 1 SD on an axis: SST. 1 left out, no coordinates.',
    )
  })
  it('says so when nothing could be placed, and when nothing is beyond 1 SD', () => {
    expect(quadAlt([{ label: 'A', point: null }])).toBe('Quad plot: no point could be placed, 1 was left out (see the list under the chart).')
    expect(quadAlt([{ label: 'A', point: { x: 0.1, y: 0.1 } }])).toContain('None is beyond 1 SD on either axis.')
  })
})
