// one test per rule of the status methods, each on a small synthetic series with hand-computed expectations.
import { describe, expect, it } from 'vitest'
import { assess, collapseRuns, completeGrid, ieaSd, namesPct, nextPeriod, values } from './index.js'
import { fitDelta, mean, quantile7, sd } from './stats.js'
import { trendOf } from './ieaSd.js'
import type { Point } from './types.js'

const yearly = (y0: number, vs: (number | null)[]): Point[] => vs.map((v, i) => ({ t: `${y0 + i}-01-01`, v }))
const Y = { grain: 'year' as const }
const ctx = { title: 'Sea surface temperature', place: 'Channel Islands', unit: '°C', decimals: 2 }

describe('stats match R', () => {
  it('mean, sd (n - 1), quantile type 7', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(sd([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 15)
    expect(sd([7])).toBeNaN()
    const s = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(quantile7(s, 0.1)).toBeCloseTo(2.9, 12)
    expect(quantile7(s, 0.9)).toBeCloseTo(18.1, 12)
    expect(quantile7(s, 0.5)).toBe(10.5)
  })
  it('fitDelta is the fitted change from the first point to the last', () => {
    expect(fitDelta([0, 1, 2, 3, 4], [5, 6, 7, 8, 9])).toBeCloseTo(4, 12)
    expect(fitDelta([0], [1])).toBeNull()
    expect(fitDelta([2, 2], [1, 3])).toBeNull()
  })
})

describe('iea-sd: one fixture per glyph', () => {
  it('within, flat: alternating record', () => {
    const r = ieaSd(yearly(2011, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]), Y)
    expect(r.status).toBe('within')
    expect(r.trend).toBe('flat')
    expect(r.ltMean).toBe(0.5)
    expect(r.ltSd).toBeCloseTo(Math.sqrt(2.5 / 9), 14)
    expect(r.recentMean).toBeCloseTo(0.6, 14)
    expect([r.recentFrom, r.recentTo]).toEqual(['2016-01-01', '2020-01-01'])
    expect(Math.abs(r.delta as number)).toBeLessThan(0.01)
    expect(r.why).toBeNull()
  })
  it('above, up: a ramp after a flat decade', () => {
    const r = ieaSd(yearly(2006, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 6, 7, 8, 9]), Y)
    expect(r.ltMean).toBeCloseTo(35 / 15, 14)
    expect(r.ltSd).toBeCloseTo(Math.sqrt(173.33333333333334 / 14), 12)
    expect(r.recentMean).toBe(7)
    expect(r.status).toBe('above')
    expect(r.delta).toBeCloseTo(4, 2)
    expect(r.trend).toBe('up')
  })
  it('below, down: the mirror', () => {
    const r = ieaSd(yearly(2006, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -5, -6, -7, -8, -9]), Y)
    expect(r.status).toBe('below')
    expect(r.trend).toBe('down')
  })
  it('within, up: a steep ramp through a noisy mean', () => {
    const r = ieaSd(yearly(2001, [3, -3, 3, -3, 3, -3, 3, -3, 3, -3, 3, -3, 3, -3, 3, -4, -2, 0, 2, 4]), Y)
    expect(r.ltMean).toBeCloseTo(0.15, 14)
    expect(r.recentMean).toBe(0)
    expect(r.status).toBe('within')
    expect(r.trend).toBe('up')
  })
  it('above, flat: a plateau', () => {
    const r = ieaSd(yearly(2006, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9, 9, 9, 9]), Y)
    expect(r.status).toBe('above')
    expect(r.trend).toBe('flat')
    expect(r.delta).toBeCloseTo(0, 12)
  })
  it('a change of exactly 1 SD is not a change', () => {
    const win = yearly(2019, [0, 2])
    const { delta } = trendOf(win, 1)
    expect(delta).toBeCloseTo(2, 12)
    expect(trendOf(win, delta as number).trend).toBe('flat')
    expect(trendOf(win, (delta as number) * (1 - 1e-12)).trend).toBe('up')
  })
})

describe('iea-sd: gates and windows', () => {
  it('no status below min_periods, and says why', () => {
    const r = ieaSd(yearly(2011, [1, 2, 3, 4, 5, 6, 7, 8, 9]), Y)
    expect([r.status, r.trend]).toEqual([null, null])
    expect(r.n).toBe(9)
    expect(r.why).toBe('9 years of record, fewer than the 10 a status needs')
    expect(ieaSd(yearly(2011, [1, 2, 3]), { grain: 'year', minPeriods: 3 }).status).not.toBeNull()
  })
  it('the window is the last rows, NA rows included (ecoidx Y5)', () => {
    // 2016..2020 with 2019 missing: the window is 2016-2020 and its mean is over 4 values
    const s = completeGrid(yearly(2006, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 6, 7, null, 9]), 'year')
    const r = ieaSd(s, Y)
    expect([r.recentFrom, r.recentTo]).toEqual(['2016-01-01', '2020-01-01'])
    expect(r.recentMean).toBe(6.75)
    expect(r.n).toBe(14)
  })
  it('a baseline sets the long-term statistics only', () => {
    const s = yearly(2001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    const r = ieaSd(s, { grain: 'year', baseline: [2001, 2010] })
    expect(r.ltMean).toBe(5.5)
    expect(r.ltSd).toBeCloseTo(Math.sqrt(82.5 / 9), 14)
    expect(r.recentMean).toBe(18)
    expect(r.status).toBe('above')
  })
  it('no value in the window: no status', () => {
    const s = [...yearly(2001, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...yearly(2011, [null, null, null, null, null])]
    const r = ieaSd(s, Y)
    expect(r.status).toBeNull()
    expect(r.why).toBe('no value in the last 5 years')
  })
})

describe('names-pct', () => {
  it('percentiles of the baseline, mean of the window', () => {
    const s = yearly(2001, [...Array.from({ length: 20 }, (_, i) => i + 1), 25, 25, 25, 25, 25])
    const r = namesPct(s, { grain: 'year', baseline: [2001, 2020] })
    expect(r.ltMean).toBe(10.5)
    expect(r.p10).toBeCloseTo(2.9, 12)
    expect(r.p90).toBeCloseTo(18.1, 12)
    expect(r.recentMean).toBe(25)
    expect(r.status).toBe('above')
    expect(r.trend).toBe('flat')
  })
  it('within when the window mean is inside the percentiles', () => {
    const r = namesPct(yearly(2001, Array.from({ length: 20 }, (_, i) => i + 1)), Y)
    expect(r.recentMean).toBe(18)
    expect(r.status).toBe('within')
  })
})

describe('values', () => {
  it('never a status', () => {
    const r = values(yearly(2020, [1, 2]), Y)
    expect([r.method, r.status, r.trend, r.n, r.t0, r.t1]).toEqual(['values', null, null, 2, '2020-01-01', '2021-01-01'])
  })
})

describe('grid', () => {
  it('completes missing periods and drops outer nulls', () => {
    const g = completeGrid([{ t: '2003-01-01', v: 3 }, { t: '2001-01-01', v: 1 }, { t: '2000-01-01', v: null }], 'year')
    expect(g).toEqual([{ t: '2001-01-01', v: 1 }, { t: '2002-01-01', v: null }, { t: '2003-01-01', v: 3 }])
    expect(nextPeriod('2020-12-01', 'month')).toBe('2021-01-01')
    expect(nextPeriod('2010-01-01', 'decade')).toBe('2020-01-01')
  })
})

describe('words', () => {
  it('collapses runs of periods into ranges', () => {
    const next = (t: string) => nextPeriod(t, 'year')
    const ts = ['1997', '1998', '2014', '2015', '2016', '2019'].map(y => `${y}-01-01`)
    expect(collapseRuns(ts, 'year', next)).toBe('1997–1998, 2014–2016 and 2019')
    expect(collapseRuns(['2019-01-01'], 'year', next)).toBe('2019')
  })
  it('the iea-sd sentence names the window, the reference and the trend', () => {
    const a = assess(yearly(2006, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 6, 7, 8, 9]), 'iea-sd', Y, ctx)
    expect(a.sentence).toBe('Sea surface temperature in Channel Islands over the last 5 years (2016–2020) was more than 1 SD above its 2006–2020 mean, and rose by more than 1 SD.')
    expect(a.alt).toBe(
      'Time series of Sea surface temperature (°C) in Channel Islands, 2006–2020, 15 years with values. ' +
      'The mean over the whole record is 2.33, and 1 SD either side spans −1.19 to 5.85. ' +
      'Values were more than 1 SD above the mean in 2017–2020. Values were never more than 1 SD below the mean. ' +
      'The last value is 9.00 °C in 2020. ' +
      'Over the last 5 years (2016–2020) the series was more than 1 SD above its 2006–2020 mean, and rose by more than 1 SD.')
  })
  it('a short record says why there is no status', () => {
    const a = assess(yearly(2018, [1, 2, 3]), 'iea-sd', Y, ctx)
    expect(a.sentence).toBe('Sea surface temperature in Channel Islands: 3.00 °C in 2020; no status relative to its own record (3 years of record, fewer than the 10 a status needs).')
  })
  it('values: the last value only', () => {
    const a = assess(yearly(2025, [96.85052]), 'values', Y, { title: 'Marine KBAs protected', place: 'Belgium', unit: '%', decimals: 1 })
    expect(a.sentence).toBe('Marine KBAs protected in Belgium: 96.9 % in 2025.')
  })
})

describe('regressions', () => {
  it('categorical words: sentence, alt with span, periods and classes', async () => {
    const { categoricalAlt, categoricalSentence, noValues } = await import('./index.js')
    const ctx = { title: 'Bleaching alert', place: 'Florida Keys' }
    const s = categoricalSentence(ctx, 'No Stress', 0.71, '2025')
    expect(s).toBe('Bleaching alert in Florida Keys: No Stress over 71% of the area in 2025.')
    expect(categoricalAlt(s, '1986-01-01', '2025-01-01', 'year', 40, ['No Stress', 'Bleaching Watch']))
      .toBe('Bleaching alert in Florida Keys: No Stress over 71% of the area in 2025. Stacked shares of the area by class for 1986–2025, 40 years; classes: No Stress, Bleaching Watch.')
    expect(noValues(ctx)).toBe('Bleaching alert in Florida Keys: no values.')
  })
  it('a constant series is flat, not ecoidx round-off arrow (cciea_OC_SL3 longitude)', () => {
    const r = ieaSd(yearly(2001, Array(12).fill(117.2)), Y)
    expect([r.status, r.trend, r.ltSd, r.delta]).toEqual(['within', 'flat', 0, 0])
  })
})
