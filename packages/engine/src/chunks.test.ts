// the chunk rule, moved with erddap-places precompute/src/precompute.test.ts's window, chunks and chunkDaysFor cases
// (unchanged), plus the two limits as options (the preview's previewWindow passes them).
import { describe, expect, it } from 'vitest'
import { MAX_CHUNK_DAYS, MAX_REQUEST_VALUES, chunkDaysFor, chunks, window } from './chunks.js'
import type { TimeExtent } from './extent.js'

const ext = (start: string, end: string, stepDays = 1): TimeExtent =>
  ({ start, end, stepDays, stepLabel: stepDays === 1 ? 'daily' : `${stepDays}-day` })

describe('window', () => {
  it('takes the last 365 days ending at the dataset\'s last time step', () => {
    expect(window(ext('1985-04-01T12:00:00Z', '2026-09-14T12:00:00Z'), 365))
      .toEqual({ start: '2025-09-15', end: '2026-09-14' })
  })
  it('never starts before a short dataset does', () => {
    expect(window(ext('2026-08-01T12:00:00Z', '2026-09-14T12:00:00Z'), 365))
      .toEqual({ start: '2026-08-01', end: '2026-09-14' })
  })
})

describe('window: full record', () => {
  it("'all' starts at the dataset's first time step", () => {
    expect(window(ext('2002-07-31T00:00:00Z', '2023-12-31T00:00:00Z', 30.5), 'all'))
      .toEqual({ start: '2002-07-31', end: '2023-12-31' })
  })
})

describe('chunks', () => {
  it('covers the window exactly once: consecutive, non-overlapping, no gaps', () => {
    const cs = chunks('2026-01-01', '2026-01-10', 4)
    expect(cs).toEqual([['2026-01-01', '2026-01-04'], ['2026-01-05', '2026-01-08'], ['2026-01-09', '2026-01-10']])
  })
  it('is a single chunk when the window fits', () => {
    expect(chunks('2026-01-01', '2026-01-10', 90)).toEqual([['2026-01-01', '2026-01-10']])
  })
  it('handles a one-day window', () => {
    expect(chunks('2026-01-01', '2026-01-01', 90)).toEqual([['2026-01-01', '2026-01-01']])
  })
})

describe('chunkDaysFor', () => {
  it('caps at MAX_CHUNK_DAYS for a small place', () => {
    expect(chunkDaysFor(6)).toBe(MAX_CHUNK_DAYS)                    // Gray's Reef: 6 cells a step
  })
  it("shrinks so one request stays under extractr's 100k values", () => {
    expect(chunkDaysFor(1_200)).toBe(83)                            // a Monterey-sized box: 83 days
    expect(chunkDaysFor(39_026)).toBe(2)                            // a 39 k-cell bbox
    expect(chunkDaysFor(39_026) * 39_026).toBeLessThanOrEqual(MAX_REQUEST_VALUES)
  })
  it('never goes below a single step, however big the bbox', () => {
    expect(chunkDaysFor(50_000_000)).toBe(1)
    expect(chunkDaysFor(101_000)).toBe(1)                           // NMS:PMNM's main lobe: one day a request
  })
  it('counts an 8-day product in days, not steps', () => {
    expect(chunkDaysFor(25_000, 8)).toBe(32)                        // 4 steps x 8 days
    expect(chunkDaysFor(250_000, 8)).toBe(8)                        // one step
  })
})
describe('chunkDaysFor: monthly', () => {
  it('counts up to MAX_CHUNK_DAYS time steps for a monthly product, not 90 days', () => {
    expect(chunkDaysFor(100, 30)).toBe(MAX_CHUNK_DAYS * 30)         // 90 months in one request
  })
  it('still shrinks a monthly product under the value cap', () => {
    expect(chunkDaysFor(5_000, 30)).toBe(600)                        // 20 steps x 30 days
  })
})


describe('chunkDaysFor: the limits as options', () => {
  it('defaults to the precompute constants (90 steps, 100,000 values)', () => {
    expect([MAX_CHUNK_DAYS, MAX_REQUEST_VALUES]).toEqual([90, 100_000])
    expect(chunkDaysFor(1_200, 1, {})).toBe(chunkDaysFor(1_200))
  })
  it('a smaller value cap shrinks the chunk, a smaller step cap caps it', () => {
    expect(chunkDaysFor(9, 1, { maxValues: 270 })).toBe(30)            // 30 steps of 9 cells
    expect(chunkDaysFor(9, 1, { maxDays: 10 })).toBe(10)
    expect(chunkDaysFor(9, 8, { maxDays: 10 })).toBe(80)               // 10 steps of an 8-day grid
  })
})
