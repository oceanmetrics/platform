import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cellToChildren, cellToParent, getPentagons, getRes0Cells, latLngToCell } from 'h3-js'
import { parquetReadObjects } from 'hyparquet'
import { cellIdOf, childRange } from './h3Bits.js'
import { ReleaseReader } from './h3Parquet.js'
import { cellRange, rowCell, speciesForCell } from './h3Species.js'
import { COMPRESSORS, openRangeFile } from './parquetFile.js'

// ---- the synthetic species_flat/res=3.parquet (fixtures/h3release/build.mjs), served as S3 would ----

const ROOT = new URL('../fixtures/h3release/', import.meta.url)
const BASE = 'https://release.test/obis-h3/v1/'
const HREF = `${BASE}species_flat/res=3.parquet`

interface Served { path: string; range: string }
function s3(log: Served[] = []): { fetch: typeof fetch; log: Served[] } {
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = decodeURIComponent(String(input).slice(BASE.length))
    const range = new Headers(init?.headers).get('Range') ?? ''
    log.push({ path, range })
    let buf: Buffer
    try { buf = readFileSync(new URL(path, ROOT)) } catch { return new Response('AccessDenied', { status: 403 }) }
    let a = 0, b = buf.length - 1
    const suffix = /^bytes=-(\d+)$/.exec(range), span = /^bytes=(\d+)-(\d+)$/.exec(range)
    if (suffix) a = Math.max(0, buf.length - Number(suffix[1]))
    else if (span) [a, b] = [Number(span[1]), Math.min(buf.length - 1, Number(span[2]))]
    return new Response(new Uint8Array(buf.subarray(a, b + 1)), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${buf.length}` } })
  }
  return { fetch: fake as typeof fetch, log }
}

/** every row of the fixture, in file order */
const ALL = (async () => {
  const file = (await openRangeFile(HREF, { fetch: s3().fetch }))!
  return (await parquetReadObjects({ file, compressors: COMPRESSORS })) as Record<string, unknown>[]
})()
const key = (r: Record<string, unknown>) => `${String(r.cell_id)}:${String(r.aphiaid)}`
const CAL1 = latLngToCell(34, -121, 1)

describe('the children of a coarser cell are one contiguous cell_id range (h3-js)', () => {
  // every res-3 cell of the globe: the range of a parent holds its children and no other res-3 cell, so in a file
  // sorted by cell_id the children are one run of rows
  const globe3 = getRes0Cells().flatMap((c) => cellToChildren(c, 3)).map(cellIdOf)
  const parents = [CAL1, latLngToCell(0, 3, 2), latLngToCell(-17.5, 178, 1), getPentagons(1)[0], getPentagons(2)[3], getRes0Cells()[7]]
  for (const p of parents) {
    it(`${p} (res ${Number((cellIdOf(p) >> 52n) & 0xfn)})`, () => {
      const [lo, hi] = childRange(cellIdOf(p), 3)
      const inside = globe3.filter((id) => id >= lo && id <= hi).sort((a, b) => (a < b ? -1 : 1))
      const kids = cellToChildren(p, 3).map(cellIdOf).sort((a, b) => (a < b ? -1 : 1))
      expect(inside).toEqual(kids)
    })
  }
})

describe('cellRange', () => {
  it('a cell at the file\'s resolution is its id; a coarser one its children\'s range; a finer one its parent', () => {
    const c3 = cellToChildren(CAL1, 3)[5]
    expect(cellRange(c3, 3)).toEqual({ cellRes: 3, scope: 'cell', range: [cellIdOf(c3), cellIdOf(c3)] })
    expect(cellRange(CAL1, 3)).toEqual({ cellRes: 1, scope: 'children', range: childRange(cellIdOf(CAL1), 3) })
    const c5 = cellToChildren(c3, 5)[0]
    expect(cellRange(c5, 3)).toEqual({ cellRes: 5, scope: 'parent', range: [cellIdOf(c3), cellIdOf(c3)] })
    expect(() => cellRange('nope', 3)).toThrow(/not an h3 cell/)
  })
})

describe('speciesForCell over species_flat/res=3 (5 row groups of 2,048 rows)', () => {
  it('a res-3 cell: exactly its rows, from the row groups its id falls in', async () => {
    const all = await ALL
    // a cell whose rows straddle row groups 0 and 1 (the max of one and the min of the next), and one inside a group
    for (const [c, groups] of [['832929fffffffff', 2], ['8329a9fffffffff', 1]] as [string, number][]) {
      const got = await speciesForCell(HREF, c, { res: 3, fetch: s3().fetch })
      const want = all.filter((r) => r.cell_id === cellIdOf(c))
      expect(want.length).toBeGreaterThan(0)
      expect(got!.scope).toBe('cell')
      expect(got!.rows.map(key)).toEqual(want.map(key))
      expect([got!.groupsRead, got!.groupsSkipped]).toEqual([groups, 5 - groups])
    }
  })
  it('the columns come as numbers (INT64 too), nulls as null, the id a bigint; h3 left out', async () => {
    const c = cellToChildren(CAL1, 3)[20]
    const got = (await speciesForCell(HREF, c, { res: 3, fetch: s3().fetch }))!
    const r = got.rows[0]
    expect(Object.keys(r).sort()).toEqual(['aphiaid', 'cell_id', 'n', 'name_key', 'year_max', 'year_min'])
    expect([typeof r.cell_id, typeof r.aphiaid, typeof r.n]).toEqual(['bigint', 'number', 'number'])
    expect(rowCell(r)).toBe(c)
    const all = await ALL
    expect(all.some((x) => x.year_min === null)).toBe(true)
    const nulls = (await Promise.all(cellToChildren(CAL1, 3).map((k) => speciesForCell(HREF, k, { res: 3, fetch: s3().fetch, columns: ['aphiaid', 'year_min'] }))))
      .flatMap((x) => x!.rows).filter((x) => x.year_min === null)
    expect(nulls.length).toBeGreaterThan(0)
  })
  it('a res-1 cell (as 81197ffffffffff in the release): the rows of its 49 res-3 children, one run of the file, nothing else', async () => {
    const all = await ALL
    const got = (await speciesForCell(HREF, CAL1, { res: 3, fetch: s3().fetch }))!
    const idx = all.map((r, i) => (cellToParent(rowCell({ cell_id: r.cell_id as bigint }), 1) === CAL1 ? i : -1)).filter((i) => i >= 0)
    // contiguous in the file
    expect(idx[idx.length - 1] - idx[0] + 1).toBe(idx.length)
    expect(new Set(idx.map((i) => all[i].cell_id)).size).toBe(49)
    expect(got.scope).toBe('children')
    expect(got.rows.map(key)).toEqual(idx.map((i) => key(all[i])))
    expect([got.rows.length, got.groupsRead, got.groupsSkipped]).toEqual([2661, 2, 3])
  })
  it('a res-5 cell has no rows of its own: its res-3 parent\'s, scope parent', async () => {
    const c3 = cellToChildren(CAL1, 3)[20], c5 = cellToChildren(c3, 5)[9]
    const [a, b] = await Promise.all([c3, c5].map((c) => speciesForCell(HREF, c, { res: 3, fetch: s3().fetch })))
    expect(b!.scope).toBe('parent')
    expect(b!.rows).toEqual(a!.rows)
  })
  it('a cell the file does not hold: no rows; a file the release does not have: null', async () => {
    const empty = await speciesForCell(HREF, latLngToCell(-30, -30, 3), { res: 3, fetch: s3().fetch })
    expect(empty!.rows).toEqual([])
    expect(await speciesForCell(`${BASE}species_flat/res=9.parquet`, CAL1, { res: 9, fetch: s3().fetch })).toBeNull()
  })
  it('the footer once per reader: a second cell of the file reads its row groups only', async () => {
    const { fetch, log } = s3()
    const reader = new ReleaseReader({ fetch, tail: 4096 })
    const first = (await speciesForCell(HREF, CAL1, { res: 3, reader }))!
    expect(log[0].range).toBe('bytes=-4096')
    const n = log.length
    const second = (await speciesForCell(HREF, '8329a9fffffffff', { res: 3, reader }))!
    expect(log.slice(n).every((r) => !r.range.startsWith('bytes=-'))).toBe(true)
    expect(second.requests).toBe(log.length - n)
    expect(first.bytes).toBeGreaterThan(second.bytes)
  })
})
