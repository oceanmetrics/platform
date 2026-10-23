import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cellToChildren, cellToLatLng, cellToParent, gridDisk, latLngToCell, polygonToCells } from 'h3-js'
import { cellIdOf, h3OfCellId, parentId } from './h3Bits.js'
import { CellIndex, cellTouchesTile, lonLatToTile, RES_FOR_ZOOM, resForZoom, rollUp, seamSpans, tileBounds, tileParents } from './h3Index.js'
import { tileRanges } from './h3Parquet.js'

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

// ---- tileParents (map 0.3.2) ----

/** the parents tileParents must return, derived with h3-js alone: the cells of `parentRes` whose centre is in the
 * tile's bbox (polygonToCells; the cell under the centre when none is) and their neighbours, kept when one of their
 * children at `res` touches the tile (cellTouchesTile: the tile and geojson-vt's buffer). two rings, not one: at
 * Monterey 9/82/200 a res-5 parent two rings out has one res-7 child in the tile's buffer */
function parentsTouching(z: number, x: number, y: number, res: number, parentRes: number): Set<string> {
  const [w, s, e, n] = tileBounds(z, x, y)
  const core = polygonToCells([[s, w], [n, w], [n, e], [s, e]], parentRes)
  const seed = core.length ? core : [latLngToCell((s + n) / 2, (w + e) / 2, parentRes)]
  const near = new Set(seed.flatMap((c) => gridDisk(c, 2)))
  return new Set([...near].filter((p) => cellToChildren(p, res).some((c) => cellTouchesTile(c, z, x, y))))
}
const sorted = (s: Set<string>) => [...s].sort()

/** the 512 px tiles of a W x H map centred on lon, lat at zoom z (what MapLibre asks for a vector source) */
function viewTiles(lon: number, lat: number, z: number, W = 1280, H = 800): { tiles: [number, number][]; bbox: [number, number, number, number] } {
  const size = 512 * 2 ** z, r = (lat * Math.PI) / 180
  const px = ((lon + 180) / 360) * size, py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size
  const tiles: [number, number][] = []
  for (let x = Math.floor((px - W / 2) / 512); x <= Math.floor((px + W / 2 - 1) / 512); x++)
    for (let y = Math.floor((py - H / 2) / 512); y <= Math.floor((py + H / 2 - 1) / 512); y++) tiles.push([x, y])
  const toLon = (p: number) => (p / size) * 360 - 180, toLat = (q: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * q) / size))) * 180) / Math.PI
  return { tiles, bbox: [toLon(px - W / 2), toLat(py + H / 2), toLon(px + W / 2), toLat(py - H / 2)] }
}

/** the res-3 parent files (all/res=7/p=<res-3>) the release provider reads for a z9 tile at res 7 (h3Parquet.ts) */
const filesOf = (z: number, x: number, y: number) =>
  new Set([...tileRanges(z, x, y, 7, 5).parents].map((p) => h3OfCellId(parentId(cellIdOf(p), 3))))

// the atlas measured the Monterey Bay view at z9 (docs/obis-layer.md); the codec's case is this centre
const MONTEREY: [number, number] = [-122.1, 36.75]

describe('tileParents: only the parents whose cells can touch the tile', () => {
  it('a z9 tile over Monterey Bay at res 7: its res-3 and res-5 parents are the h3-js derivation, exactly', () => {
    const [x, y] = lonLatToTile(...MONTEREY, 9)
    expect([x, y]).toEqual([82, 199])
    const p3 = tileParents(9, x, y, 7, 3)
    expect(sorted(p3)).toEqual(sorted(parentsTouching(9, x, y, 7, 3)))
    expect(sorted(p3)).toEqual(['832834fffffffff', '83291afffffffff', '8329a9fffffffff'])
    expect(sorted(tileParents(9, x, y, 7, 5))).toEqual(sorted(parentsTouching(9, x, y, 7, 5)))
  })
  it('the Monterey Bay view at z9 (1280 x 800, nine tiles) reads 8 res-3 parent files: obis-hex\'s 7, and one its tiles reach past the view', () => {
    const { tiles, bbox: [w, s, e, n] } = viewTiles(...MONTEREY, 9)
    expect(tiles).toHaveLength(9)
    const files = new Set(tiles.flatMap(([x, y]) => [...filesOf(9, x, y)]))
    // obis-hex's cover of the view (viewport.ts coverCells): the res-3 centres in the view and their ring 1
    const core = polygonToCells([[s, w], [n, w], [n, e], [s, e]], 3)
    const obisHex = new Set((core.length ? core : [latLngToCell(MONTEREY[1], MONTEREY[0], 3)]).flatMap((c) => gridDisk(c, 1)))
    expect(obisHex.size).toBe(7)
    expect(files.size).toBe(8)
    expect([...obisHex].filter((c) => !files.has(c))).toEqual([])
    // the eighth: tile 83/200 (south-east, past the view's corner) holds cells of it
    expect([...files].filter((c) => !obisHex.has(c))).toEqual(['8329adfffffffff'])
    expect(filesOf(9, 83, 200).has('8329adfffffffff')).toBe(true)
  })
  it('regression (map 0.3.1, Monterey z9 over its budget: 11 parent files in the atlas against obis-hex\'s 7): no tile of the view asks a parent none of whose cells reaches it', () => {
    // 0.3.1 grew each tile's bbox by two res-7 cells and took every res-5 parent overlapping it: 9 files here, among
    // them 832918fffffffff for tile 81/200, whose res-7 cells all stop short of the tile
    const { tiles } = viewTiles(...MONTEREY, 9)
    for (const [x, y] of tiles) {
      const got = tileParents(9, x, y, 7, 5)
      expect(sorted(got), `9/${x}/${y}`).toEqual(sorted(parentsTouching(9, x, y, 7, 5)))
    }
    expect(filesOf(9, 81, 200).has('832918fffffffff')).toBe(false)
  })
  it('regression (map 0.3.1 dropped parents at a pinned fine resolution): at z5, res 6 under res-2 parents, no parent with a cell in the tile is missed', () => {
    // a z5 tile holds more res-6 cells than EXACT_CELLS, so the parents' own hexagons are tested, grown by how far
    // their descendants reach (OVERHANG of a res-2 edge, 46 km): 0.3.1's two res-6 cells (7 km) missed 2 at Fiji
    for (const [lon, lat] of [[178, -17.5], [-121, 34], [3, 0]] as [number, number][]) {
      const [x, y] = lonLatToTile(lon, lat, 5)
      const want = parentsTouching(5, x, y, 6, 2), got = tileParents(5, x, y, 6, 2)
      expect([...want].filter((p) => !got.has(p)), `5/${x}/${y}`).toEqual([])
      // and not many more: the bound is under one parent radius
      expect(got.size, `5/${x}/${y}`).toBeLessThanOrEqual(want.size + 6)
    }
  })
  it('a pinned resolution two zooms finer still takes the exact path (z7, res 7 under res 3: 12,800 cells listed)', () => {
    const [x, y] = lonLatToTile(-121, 34, 7)
    expect(sorted(tileParents(7, x, y, 7, 3))).toEqual(sorted(parentsTouching(7, x, y, 7, 3)))
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
