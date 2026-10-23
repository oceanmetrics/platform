import { describe, expect, it } from 'vitest'
import { cellToChildren, cellToParent, getResolution, gridDisk, latLngToCell } from 'h3-js'
import { cellIdOf, cellIdRes, childRange, h3OfCellId, inRanges, mergeRanges, overlapsRanges, parentId } from './h3Bits.js'

// a seeded generator (mulberry32), so the 100 cells are the same every run
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20261023)
const POINTS = Array.from({ length: 100 }, () => [Math.asin(2 * rand() - 1) * (180 / Math.PI), 360 * rand() - 180])

describe('h3 parents by bit arithmetic (spike 4), against h3-js', () => {
  it('the id and the hex string round-trip, and the resolution is bits 52-55', () => {
    const h = '85ba00dbfffffff'
    expect(h3OfCellId(cellIdOf(h))).toBe(h)
    expect(cellIdOf(h)).toBe(0x85ba00dbfffffffn)
    expect(cellIdRes(cellIdOf(h))).toBe(5)
  })
  it('parentId equals cellToParent for 100 random cells at res 1..7 and every coarser resolution', () => {
    let checked = 0
    for (const [lat, lng] of POINTS) for (let r = 1; r <= 7; r++) {
      const c = latLngToCell(lat, lng, r)
      for (let p = 0; p <= r; p++) {
        expect(h3OfCellId(parentId(cellIdOf(c), p)), `${c} -> ${p}`).toBe(cellToParent(c, p))
        checked++
      }
    }
    expect(checked).toBe(100 * (2 + 3 + 4 + 5 + 6 + 7 + 8))
  })
  it('childRange holds every child of a parent, and no cell of its neighbours (100 random parents, res 1..5, children 2 deeper)', () => {
    for (const [lat, lng] of POINTS) for (let p = 1; p <= 5; p++) {
      const parent = latLngToCell(lat, lng, p)
      const [lo, hi] = childRange(cellIdOf(parent), p + 2)
      const kids = cellToChildren(parent, p + 2).map(cellIdOf)
      for (const k of kids) expect(k >= lo && k <= hi, parent).toBe(true)
      // the bounds are tight: the first and last child at most the pentagon's gap away
      expect(kids.reduce((a, b) => (b < a ? b : a))).toBe(lo)
      for (const n of gridDisk(parent, 1).filter((h) => h !== parent))
        for (const k of cellToChildren(n, p + 2).map(cellIdOf)) expect(k >= lo && k <= hi, `${n} in ${parent}`).toBe(false)
    }
  })
  it('a parent at its own resolution is itself, and a finer one is refused', () => {
    const c = cellIdOf(latLngToCell(10, 10, 4))
    expect(parentId(c, 4)).toBe(c)
    expect(childRange(c, 4)).toEqual([c, c])
    expect(() => parentId(c, 5)).toThrow(/finer/)
    expect(getResolution(h3OfCellId(parentId(c, 0)))).toBe(0)
  })
})

describe('ranges', () => {
  const r = mergeRanges([[10n, 20n], [21n, 25n], [40n, 50n], [5n, 8n]])
  it('merges touching ranges and sorts them', () => {
    expect(r).toEqual([[5n, 8n], [10n, 25n], [40n, 50n]])
  })
  it('inRanges and overlapsRanges by binary search', () => {
    expect([4n, 5n, 9n, 25n, 26n, 45n, 51n].map((x) => inRanges(x, r))).toEqual([false, true, false, true, false, true, false])
    expect(overlapsRanges(26n, 39n, r)).toBe(false)
    expect(overlapsRanges(26n, 40n, r)).toBe(true)
    expect(overlapsRanges(0n, 4n, r)).toBe(false)
    expect(overlapsRanges(51n, 99n, r)).toBe(false)
    expect(overlapsRanges(0n, 99n, r)).toBe(true)
    expect(overlapsRanges(0n, 99n, [])).toBe(false)
  })
})
