import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cellToBoundary, cellToLatLng, getResolution, gridDisk, latLngToCell } from 'h3-js'
import { geoJSONToTile } from '@maplibre/geojson-vt'
import { absoluteArchiveUrl, decodeH3jTile, encodeH3jTile, h3FillColor, h3TileUrl, parseH3TileUrl } from './h3.js'
import { cellRing, cellsProvider, h3jAction, h3jSource, TILE_OPTIONS, tileFeatures, tileToGeoJSON, tileToMvt } from './h3Tiles.js'
import { lonLatToTile } from './h3Index.js'
import type { H3jTile } from './h3Index.js'

const CROSSING = JSON.parse(readFileSync(new URL('../fixtures/h3/crossing55.json', import.meta.url), 'utf8')) as { h3: string[]; v: number[] }

const span = (ring: number[][]) => Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]))
// shoelace area of a ring in tile units
const area = (ring: number[][]) => Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
const tagsOf = (t: ReturnType<typeof tileFeatures>) => (t?.features ?? []).map((f) => (f.tags as { h3: string }).h3)

describe('the PR 211 antimeridian unwrap (spike 1 condition 4)', () => {
  it('every crossing cell Mercator draws is split by h3-js and continuous east of +180 after cellRing', () => {
    expect(CROSSING.h3).toHaveLength(55)
    const drawn = CROSSING.h3.filter((h) => Math.abs(cellToLatLng(h)[0]) < 85.0511)
    expect(drawn).toHaveLength(52)
    for (const h of drawn) {
      expect(span(cellToBoundary(h, true)), h).toBeGreaterThan(180)
      const ring = cellRing(h)
      expect(span(ring), h).toBeLessThan(180)
      expect(Math.min(...ring.map((p) => p[0])), h).toBeGreaterThan(0)
      expect(Math.max(...ring.map((p) => p[0])), h).toBeGreaterThan(180)
    }
  })
  it('the cell holding the pole cannot be unwrapped (spike 1 caveat: harmless in Mercator, which clips at 85.05°; the globe needs its own rule)', () => {
    expect(span(cellRing('85032623fffffff'))).toBeGreaterThan(180)
  })
  it('a cell away from the seam keeps h3-js\'s ring', () => {
    const h = latLngToCell(34, -120, 5)
    expect(cellRing(h)).toEqual(cellToBoundary(h, true))
  })
  it('geojson-vt\'s wrap draws a crossing cell in tile x = 0 and x = 2^z - 1 (85ba00dbfffffff at 34°S, z6)', () => {
    const h = '85ba00dbfffffff'
    const t = { h3: [h], v: [CROSSING.v[CROSSING.h3.indexOf(h)]] }
    const [, y] = lonLatToTile(180, -34.3, 6)
    expect(tagsOf(tileFeatures(t, 6, 0, y))).toEqual([h])
    expect(tagsOf(tileFeatures(t, 6, 63, y))).toEqual([h])
    expect(tagsOf(tileFeatures(t, 6, 32, y))).toEqual([])
  })
})

describe('regression: geojson-vt tolerance 0 keeps a sub-pixel res-5 hexagon at z1 (spike 1, the low-zoom erasure)', () => {
  const h = latLngToCell(5, 100, 5)
  const fc = tileToGeoJSON({ h3: [h], v: [1] })
  it('with tolerance 0 the hexagon keeps its seven points and an area', () => {
    expect(TILE_OPTIONS.tolerance).toBe(0)
    const ring = tileFeatures({ h3: [h], v: [1] }, 1, 1, 0)!.features[0].geometry[0] as unknown as number[][]
    expect(ring).toHaveLength(7)
    expect(area(ring)).toBeGreaterThan(0)
  })
  it('geojson-vt\'s default tolerance (3) folds it into a ring of no area: a feature that draws nothing', () => {
    const ring = geoJSONToTile(fc, 1, 1, 0, { ...TILE_OPTIONS, tolerance: 3 })!.features[0].geometry[0] as unknown as number[][]
    expect(ring).toHaveLength(3)
    expect(area(ring)).toBe(0)
  })
})

describe('tiles and the protocol', () => {
  const disc = gridDisk(latLngToCell(10, 10, 5), 1)
  const t = { h3: disc, v: disc.map((_, i) => i) }
  it('tileToMvt encodes the cells of a tile, nothing for an empty one', () => {
    const [x, y] = lonLatToTile(10, 10, 6)
    expect(tileToMvt(t, 6, x, y).byteLength).toBeGreaterThan(100)
    expect(tileToMvt(t, 6, (x + 10) % 64, y).byteLength).toBe(0)
  })
  it('h3jAction reads {z}/{x}/{y} from the url and asks the provider for that tile', async () => {
    const asked: number[][] = []
    const action = h3jAction(async (z, x, y) => { asked.push([z, x, y]); return t })
    const [x, y] = lonLatToTile(10, 10, 6)
    const r = await action({ url: `h3j://cells/6/${x}/${y}` } as never, new AbortController())
    expect(asked).toEqual([[6, x, y]])
    expect((r.data as ArrayBuffer).byteLength).toBeGreaterThan(0)
    await expect(action({ url: 'h3j://cells/6/x' } as never, new AbortController())).rejects.toThrow(/no \{z\}\/\{x\}\/\{y\}/)
  })
  it('h3jSource registers one scheme and returns a vector source over it', () => {
    const schemes: string[] = []
    const src = h3jSource((s) => { schemes.push(s) }, 'h3jx', async () => null, { name: 'obis', maxzoom: 7 })
    expect(schemes).toEqual(['h3jx'])
    expect(src).toEqual({ type: 'vector', tiles: ['h3jx://obis/{z}/{x}/{y}'], minzoom: 0, maxzoom: 7 })
  })
  it('the worker\'s tile url carries the archive url, and reads back', () => {
    const u = 'https://storage.oceanmetrics.io/obis-h3/es50.pmtiles'
    expect(h3TileUrl(u)).toBe('h3j://https%3A%2F%2Fstorage.oceanmetrics.io%2Fobis-h3%2Fes50.pmtiles/{z}/{x}/{y}')
    expect(parseH3TileUrl(h3TileUrl(u).replace('{z}/{x}/{y}', '3/1/2'))).toBe(u)
    expect(parseH3TileUrl('cog://x/1/2/3')).toBeNull()
  })
  it('an h3j tile is columnar JSON and decodes back; anything else is refused', () => {
    const s = encodeH3jTile({ h3: ['85ba00dbfffffff'], v: new Float64Array([38.33]) })
    expect(s).toBe('{"h3":["85ba00dbfffffff"],"v":[38.33]}')
    expect(decodeH3jTile(new TextEncoder().encode(s))).toEqual({ h3: ['85ba00dbfffffff'], v: [38.33] })
    expect(() => decodeH3jTile('{"h3":["a"],"v":[]}')).toThrow(/not an h3j tile/)
  })
  it('the in-memory provider steps the resolution with zoom (res 1 at z1, res 5 at z6)', async () => {
    const p = cellsProvider(t)
    const z1 = (await p(1, 1, 0, new AbortController().signal))!
    expect(z1.h3.map(getResolution)).toEqual([1])
    expect((z1 as H3jTile).v[0]).toBeCloseTo(3, 12)
    const [x, y] = lonLatToTile(10, 10, 6)
    expect((await p(6, x, y, new AbortController().signal))!.h3.sort()).toEqual([...disc].sort())
  })
  it('the fill interpolates the tiles\' v over the domain in nine stops', () => {
    const e = h3FillColor([1.5, 46.47]) as unknown[]
    expect(e.slice(0, 3)).toEqual(['interpolate', ['linear'], ['get', 'v']])
    expect(e.length).toBe(3 + 18)
    expect([e[3], e[4], e[19], e[20]]).toEqual([1.5, '#440154', 46.47, '#fde725'])
  })
})

describe('regression: a relative archive url reaches the worker absolute (consumer check 2026-10-23)', () => {
  it('h3TileUrl resolves it against the page, not the worker script', () => {
    const t = h3TileUrl('./data/es5.pmtiles', 'http://localhost:5210/app/')
    expect(t).toBe('h3j://http%3A%2F%2Flocalhost%3A5210%2Fapp%2Fdata%2Fes5.pmtiles/{z}/{x}/{y}')
    expect(parseH3TileUrl(t.replace('{z}/{x}/{y}', '3/1/2'))).toBe('http://localhost:5210/app/data/es5.pmtiles')
  })
  it('an absolute url is kept, and a relative one without a page is left as given', () => {
    expect(absoluteArchiveUrl('https://x.test/a.pmtiles', 'http://localhost/')).toBe('https://x.test/a.pmtiles')
    expect(absoluteArchiveUrl('./a.pmtiles', undefined)).toBe('./a.pmtiles')
  })
})
