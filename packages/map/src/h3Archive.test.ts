import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { cellToParent, gridDisk, latLngToCell } from 'h3-js'
import { PMTiles } from 'pmtiles'
import type { RangeResponse, Source } from 'pmtiles'
import { buildH3jArchive, gzipStream } from './h3Archive.js'
import { decodeH3jTile } from './h3.js'
import { rollUp } from './h3Index.js'

// an archive in memory, read the way the worker reads one over HTTP
const memory = (bytes: Uint8Array): Source => ({
  getKey: () => 'memory',
  getBytes: async (offset: number, length: number): Promise<RangeResponse> => ({ data: bytes.slice(offset, offset + length).buffer }),
})

// seven res-3 cells around the centre of z3 tile 4/3 (22.5°E, 21.94°N): one tile per zoom down to z3, and the four
// z4 tiles that meet at that centre
const CENTRE = latLngToCell(21.94, 22.5, 3)
const CELLS = (() => { const h3 = gridDisk(CENTRE, 1); return { h3, v: h3.map((_, i) => i + 1) } })()
const meanBy = (res: number) => {
  const g = new Map<string, number[]>()
  CELLS.h3.forEach((h, i) => { const p = cellToParent(h, res); g.set(p, [...(g.get(p) ?? []), CELLS.v[i]]) })
  return { h3: [...g.keys()].sort(), v: [...g.keys()].sort().map((p) => g.get(p)!.reduce((a, b) => a + b, 0) / g.get(p)!.length) }
}

describe('buildH3jArchive', () => {
  it('writes one tile per touched tile, the resolution stepped with zoom', async () => {
    const a = await buildH3jArchive({ levels: [CELLS, rollUp(CELLS, 2), rollUp(CELLS, 1)], maxzoom: 4, metadata: { domain: [1, 7] } })
    expect(a.zooms).toEqual([
      { z: 0, res: 1, tiles: 1 }, { z: 1, res: 1, tiles: 1 }, { z: 2, res: 1, tiles: 1 }, { z: 3, res: 2, tiles: 1 }, { z: 4, res: 3, tiles: 4 },
    ])
    expect(a.tiles).toBe(8)
    const p = new PMTiles(memory(a.bytes))
    const h = await p.getHeader()
    expect([h.numAddressedTiles, h.numTileEntries, h.minZoom, h.maxZoom, h.tileType, h.tileCompression, h.clustered]).toEqual([8, 8, 0, 4, 0, 2, true])
    expect(await p.getMetadata()).toMatchObject({ format: 'h3j', res_for_zoom: { 0: 1, 3: 2, 4: 3 }, resolutions: [1, 2, 3], domain: [1, 7] })
  })
  it('a tile holds the ids and values that touch it, at its zoom\'s resolution', async () => {
    const a = await buildH3jArchive({ levels: [CELLS, rollUp(CELLS, 2), rollUp(CELLS, 1)], maxzoom: 4, gzip: (b) => gzipSync(b, { level: 9 }) })
    const p = new PMTiles(memory(a.bytes))
    const tile = async (z: number, x: number, y: number) => { const r = await p.getZxy(z, x, y); return r ? decodeH3jTile(r.data) : null }
    expect(await tile(0, 0, 0)).toEqual(meanBy(1))
    const z3 = (await tile(3, 4, 3))!
    expect([z3.h3.slice().sort(), z3.v.length]).toEqual([meanBy(2).h3, meanBy(2).h3.length])
    // the four z4 tiles at the corner hold every res-3 cell with its own value between them
    const seen = new Map<string, number>()
    for (const [x, y] of [[8, 6], [9, 6], [8, 7], [9, 7]]) {
      const t = (await tile(4, x, y))!
      t.h3.forEach((c, i) => seen.set(c, t.v[i]))
    }
    expect([...seen.keys()].sort()).toEqual([...CELLS.h3].sort())
    CELLS.h3.forEach((c, i) => expect(seen.get(c)).toBe(CELLS.v[i]))
    expect(await tile(4, 0, 0)).toBeNull()
  })
  it('one table is enough: a zoom coarser than every table takes the coarsest', async () => {
    const a = await buildH3jArchive({ levels: [CELLS], maxzoom: 1, gzip: gzipStream })
    expect(a.zooms.map((q) => q.res)).toEqual([3, 3])
    await expect(buildH3jArchive({ levels: [{ h3: [], v: [] }] })).rejects.toThrow(/no cells/)
  })
})
