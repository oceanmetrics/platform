import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cellToLatLng, cellToParent, gridDisk, latLngToCell } from 'h3-js'
import { CellIndex, cellTouchesTile, lonLatToTile, RES_FOR_ZOOM, resForZoom, rollUp, seamSpans, tileBounds } from './h3Index.js'

const CROSSING = JSON.parse(readFileSync(new URL('../fixtures/h3/crossing55.json', import.meta.url), 'utf8')) as { h3: string[]; v: number[] }

describe('the resolution steps with zoom (spike 1 condition 3)', () => {
  it('RES_FOR_ZOOM is obis-hex zoomToRes at each tile zoom', () => {
    expect(RES_FOR_ZOOM).toEqual([1, 1, 1, 2, 3, 4, 5, 6, 6, 7, 8, 9, 10])
  })
  it('a tile never carries a finer resolution than the data has', () => {
    expect([1, 6, 9].map((z) => resForZoom(z, 5))).toEqual([1, 5, 5])
    expect(resForZoom(6.9)).toBe(5)
  })
})

describe('tiles', () => {
  it('tileBounds and lonLatToTile agree', () => {
    expect(tileBounds(0, 0, 0)[0]).toBe(-180)
    expect(tileBounds(1, 1, 0).map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0, 0, 180, 85.0511])
    expect(lonLatToTile(179.99, -17, 6)).toEqual([63, 35])
    expect(lonLatToTile(-179.99, -17, 6)).toEqual([0, 35])
  })
  it('a span past ±180 is split so the other side of the seam comes too', () => {
    expect(seamSpans(-181, -170)).toEqual([[179, 180], [-180, -170]])
    expect(seamSpans(170, 182)).toEqual([[-180, -178], [170, 180]])
    expect(seamSpans(-10, 10)).toEqual([[-10, 10]])
    expect(seamSpans(-190, 190)).toEqual([[-180, 180]])
  })
})

describe('CellIndex', () => {
  // res-5 discs at the equator, near Fiji on the seam, at 70°N and off California
  const cells = (() => {
    const h3 = [...new Set([[0, 0], [-17, 179.9], [70, 20], [34, -120]].flatMap(([la, lo]) => gridDisk(latLngToCell(la, lo, 5), 6)))]
    return { h3, v: h3.map((_, i) => i) }
  })()
  it('groups res 5 by res 2 parents, with a margin of two res-5 cells', () => {
    const idx = new CellIndex(cells)
    expect([idx.res, idx.parentRes]).toEqual([5, 2])
    expect(idx.marginDeg).toBeCloseTo(0.177, 2)
  })
  it('misses no cell: each one is in the tile of its own centroid at z0, 2, 4 and 6', () => {
    const idx = new CellIndex(cells)
    for (const z of [0, 2, 4, 6]) {
      const cache = new Map<string, Set<string>>()
      const missing = cells.h3.filter((h) => {
        const [lat, lon] = cellToLatLng(h)
        const [x, y] = lonLatToTile(lon, lat, z)
        const k = `${x}/${y}`
        if (!cache.has(k)) cache.set(k, new Set(idx.tile(z, x, y).h3))
        return !cache.get(k)!.has(h)
      })
      expect(missing, `z${z}`).toEqual([])
    }
  })
  it('tile x = 0 and x = 2^z - 1 both hold every crossing cell Mercator draws (spike 1 condition 4, the ±180 strip)', () => {
    const idx = new CellIndex(CROSSING)
    expect(CROSSING.h3).toHaveLength(55)
    // three of the 55 lie past Mercator's 85.05° (one holds the pole): never drawn, so not looked up
    const drawn = CROSSING.h3.filter((h) => Math.abs(cellToLatLng(h)[0]) < 85.0511)
    expect(drawn).toHaveLength(52)
    for (const z of [4, 6]) {
      const n = 2 ** z
      const byRow = new Map<number, string[]>()
      for (const h of drawn) {
        const [, y] = lonLatToTile(180, cellToLatLng(h)[0], z)
        byRow.set(y, [...(byRow.get(y) ?? []), h])
      }
      for (const [y, hs] of byRow) {
        const west = new Set(idx.tile(z, 0, y).h3), east = new Set(idx.tile(z, n - 1, y).h3)
        expect(hs.filter((h) => !west.has(h)), `z${z} x0 y${y}`).toEqual([])
        expect(hs.filter((h) => !east.has(h)), `z${z} x${n - 1} y${y}`).toEqual([])
      }
    }
  })
})

describe('cellTouchesTile: the exact test the archive keeps a cell by', () => {
  it('a crossing cell reaches both seam tiles, not the middle; a res-1 cell not the tile next door', () => {
    const [, y] = lonLatToTile(180, -34.3, 6)
    expect([0, 63, 32].map((x) => cellTouchesTile('85ba00dbfffffff', 6, x, y))).toEqual([true, true, false])
    const big = latLngToCell(21.94, 22.5, 1)
    expect([cellTouchesTile(big, 1, 1, 0), cellTouchesTile(big, 1, 0, 0), cellTouchesTile(big, 1, 1, 1)]).toEqual([true, false, false])
  })
})

describe('rollUp', () => {
  it('a parent\'s value is the mean of its children (NaN left out), sorted by id', () => {
    const kids = gridDisk(latLngToCell(10, 10, 4), 1)
    const parent = cellToParent(kids[0], 3)
    const mine = kids.filter((h) => cellToParent(h, 3) === parent)
    const t = { h3: mine, v: mine.map((_, i) => (i === 0 ? NaN : i)) }
    const r = rollUp(t, 3)
    expect(r.h3).toEqual([parent])
    const vs = mine.slice(1).map((_, i) => i + 1)
    expect(r.v[0]).toBeCloseTo(vs.reduce((a, b) => a + b, 0) / vs.length, 12)
    expect(rollUp(t, 3, 'max').v[0]).toBe(mine.length - 1)
    expect(rollUp(t, 4)).toBe(t)
  })
})
