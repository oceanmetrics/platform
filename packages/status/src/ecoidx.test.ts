// the cross-check: iea-sd must draw what ecoidx PlotTimeSeries() draws, on every CCIEA example series and every
// edge case in fixtures/ecoidx/iea_sd_cciea.json (made by running the real R function; see its README).
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ieaSd } from './ieaSd.js'
import type { Point } from './types.js'

const FIXTURE = new URL('../fixtures/ecoidx/iea_sd_cciea.json', import.meta.url)

interface Case {
  id: string
  kind: string
  period: number
  stats_years: [number, number] | null
  x: number[]
  y: (number | null)[]
  expected: { status: string; trend: string; mn: number; sd: number; mn5: number; delta: number } | null
  error: string | null
}

const close = (a: number | null, b: number) => {
  if (a == null) return false
  const tol = 1e-9 * Math.max(1, Math.abs(b))
  return Math.abs(a - b) <= tol
}

describe.skipIf(!existsSync(FIXTURE))('iea-sd reproduces ecoidx PlotTimeSeries()', () => {
  const fx = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : { series: [] }
  const cases: Case[] = fx.series.filter((c: Case) => c.error == null && c.expected != null)

  it('has cases for every status and trend glyph', () => {
    const combos = new Set(cases.map(c => `${c.expected!.status}/${c.expected!.trend}`))
    for (const s of ['above', 'within', 'below']) for (const t of ['up', 'flat', 'down']) expect(combos).toContain(`${s}/${t}`)
  })

  // a constant series (sd = 0): ecoidx draws an arrow from lm() round-off (|delta| ~ 1e-14 > sd = 0); the port
  // calls a change within round-off of zero no change, so these are flat, with the same status and statistics
  const degenerate = (c: Case) => c.expected!.sd <= 1e-12 * Math.max(1, Math.abs(c.expected!.mn))
  it('constant series are flat, not round-off arrows', () => {
    const deg = cases.filter(degenerate)
    expect(deg.length).toBe(18)
    for (const c of deg) {
      const r = ieaSd(c.x.map((x, i) => ({ t: `${x}-01-01`, v: c.y[i] })), { grain: 'year', recent: c.period, minPeriods: 2, baseline: c.stats_years })
      expect([c.id, r.status, r.trend, r.delta]).toEqual([c.id, c.expected!.status, 'flat', 0])
    }
  })

  it.each(cases.filter(c => !degenerate(c)).map(c => [c.id, c] as const))('%s', (_id, c) => {
    const series: Point[] = c.x.map((x, i) => ({ t: `${x}-01-01`, v: c.y[i] }))
    const r = ieaSd(series, { grain: 'year', recent: c.period, minPeriods: 2, baseline: c.stats_years })
    const e = c.expected!
    expect({ status: r.status, trend: r.trend }).toEqual({ status: e.status, trend: e.trend })
    expect(close(r.ltMean, e.mn)).toBe(true)
    expect(close(r.ltSd, e.sd)).toBe(true)
    expect(close(r.recentMean, e.mn5)).toBe(true)
    expect(close(r.delta, e.delta)).toBe(true)
  })
})
