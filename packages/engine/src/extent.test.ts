// the info-table parser and the window clamp are pure. (erddap-places' live info fetch stays in that repo: no network
// here.)
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INFO_TIMEOUT_MS, addDays, clampWindow, daysBetween, defaultWindow, parseInfoExtent, parseSpacing,
  spanDays, stepLabel, timeInstant, type TimeExtent,
} from './extent.js'
import { noonZ } from './erddap.js'

const DIR  = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://erddap.oceanmetrics.io/erddap'
const info = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'fixtures', 'info_noaa_aoml_seascapes_8day.json'), 'utf8'))

// the 8-day Seascapes grid as of 2026-09-15: months of latency, so "today − 2" is far past its end
const SEASCAPES: TimeExtent = {
  start: '2002-08-29T12:00:00Z', end: '2026-06-26T12:00:00Z', stepDays: 8.0055, stepLabel: '8-day', nValues: 1088,
}
const DAILY: TimeExtent = { start: '1985-04-01T12:00:00Z', end: '2026-09-13T12:00:00Z', stepDays: 1, stepLabel: 'daily' }

describe('parseInfoExtent', () => {
  it('reads time/actual_range (seconds since epoch) and the averageSpacing of Seascapes', () => {
    const e = parseInfoExtent(info)!
    expect(e.start).toBe('2002-08-29T12:00:00Z')
    expect(e.end).toBe('2026-06-26T12:00:00Z')      // NOT today − 2
    expect(e.nValues).toBe(1088)
    expect(e.stepDays).toBeCloseTo(8.006, 2)
    expect(e.stepLabel).toBe('8-day')
  })

  it('falls back to the NC_GLOBAL time_coverage_* attributes when actual_range is missing', () => {
    const rows = info.table.rows.filter((r: string[]) => r[2] !== 'actual_range')
    const e = parseInfoExtent({ table: { columnNames: info.table.columnNames, rows } })!
    expect(e.start).toBe('2002-08-29T12:00:00Z')
    expect(e.end).toBe('2026-06-26T12:00:00Z')
  })

  it('reverses a descending actual_range and returns null without one', () => {
    const rows = [['attribute', 'time', 'actual_range', 'double', '1.7824752E9, 1.0306224E9']]
    expect(parseInfoExtent({ table: { columnNames: [], rows } })!.end).toBe('2026-06-26T12:00:00Z')
    expect(parseInfoExtent({ table: { columnNames: [], rows: [] } })).toBeNull()
  })

  it('parseSpacing / stepLabel', () => {
    expect(parseSpacing('8 days 0h 7m 57s')).toBeCloseTo(8.0055, 3)
    expect(parseSpacing('1 day')).toBe(1)
    expect(parseSpacing('12h')).toBeCloseTo(0.5, 6)
    expect(stepLabel(1)).toBe('daily')
    expect(stepLabel(8.0055)).toBe('8-day')
    expect(stepLabel(30.4)).toBe('monthly')
    expect(stepLabel(0.5)).toBe('sub-daily')
    expect(stepLabel(undefined)).toBeUndefined()
  })
})

describe('defaultWindow', () => {
  it('is the last 30 days ending at the last time step for a daily dataset', () => {
    expect(defaultWindow(DAILY)).toEqual({ start: '2026-08-15', end: '2026-09-13' })
    expect(spanDays(DAILY)).toBe(30)
  })
  it('widens to cover several steps of a coarser dataset, capped at maxDays', () => {
    const w = defaultWindow(SEASCAPES)
    expect(w.end).toBe('2026-06-26')                       // the dataset's last step, not today − 2
    expect(daysBetween(w.start, w.end) + 1).toBe(spanDays(SEASCAPES))
    expect(spanDays(SEASCAPES)).toBe(65)                   // 8 steps × 8.006 days, ceil
    expect(spanDays({ ...SEASCAPES, stepDays: 30 })).toBe(90)
  })
  it('never starts before the first time step', () => {
    const short: TimeExtent = { start: '2026-09-01T12:00:00Z', end: '2026-09-05T12:00:00Z', stepDays: 1 }
    expect(defaultWindow(short)).toEqual({ start: '2026-09-01', end: '2026-09-05' })
  })
})

describe('clampWindow', () => {
  it('snaps back when the start is after the dataset end, and says why', () => {
    // exactly the bug: the "last 30 days ending today − 2" default against the 8-day product
    const r = clampWindow({ start: '2026-08-15', end: '2026-09-13' }, SEASCAPES)
    expect(r.snapped).toBe(true)
    expect(r.end).toBe('2026-06-26')
    expect(r.reason).toMatch(/starts after this dataset ends \(2026-06-26\)/)
  })
  it('snaps back when the window ends before the dataset starts', () => {
    const r = clampWindow({ start: '1990-01-01', end: '1990-02-01' }, SEASCAPES)
    expect(r.snapped).toBe(true)
    expect(r.reason).toMatch(/ends before this dataset starts \(2002-08-29\)/)
  })
  it('clamps an overlapping window to the extent', () => {
    const r = clampWindow({ start: '2026-06-01', end: '2026-08-01' }, SEASCAPES)
    expect(r).toMatchObject({ start: '2026-06-01', end: '2026-06-26', snapped: true })
    expect(r.reason).toMatch(/clamped to the dataset extent/)
  })
  it('leaves a window inside the extent alone', () => {
    const r = clampWindow({ start: '2026-05-01', end: '2026-06-01' }, SEASCAPES)
    expect(r).toEqual({ start: '2026-05-01', end: '2026-06-01', snapped: false, reason: undefined })
  })
  it('does nothing without an extent', () => {
    expect(clampWindow({ start: '2026-05-01', end: '2026-06-01' }, null).snapped).toBe(false)
  })
  it('addDays / daysBetween are UTC calendar days', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')    // 2026 is not a leap year
    expect(daysBetween('2026-06-26T12:00:00Z', '2026-06-27')).toBe(1)
  })
})

describe('timeInstant', () => {
  it('uses the extent endpoints verbatim so a request cannot overshoot a non-noon axis', () => {
    const mur: TimeExtent = { start: '2002-06-01T09:00:00Z', end: '2026-09-12T09:00:00Z', stepDays: 1 }
    expect(timeInstant('2026-09-12', mur, noonZ)).toBe('2026-09-12T09:00:00Z')
    expect(timeInstant('2002-06-01', mur, noonZ)).toBe('2002-06-01T09:00:00Z')
    expect(timeInstant('2026-09-01', mur, noonZ)).toBe('2026-09-01T12:00:00Z')
    expect(timeInstant('2026-09-01', null, noonZ)).toBe('2026-09-01T12:00:00Z')
  })
})

describe('the info request outlasts a busy server (regression, 2026-10-09 and 2026-10-20)', () => {
  it('waits at least 20 s per attempt (PacIOOS answered an info request in 20 s)', () => {
    expect(INFO_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000)
  })
})
