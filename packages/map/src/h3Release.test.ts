import { readFileSync, statSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cellToLatLng, cellToParent, getResolution } from 'h3-js'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { parquetReadObjects } from 'hyparquet'
import { cellTouchesTile, lonLatToTile, rollUp } from './h3Index.js'
import type { H3Rows } from './h3Index.js'
import { ReleaseReader, releaseProvider } from './h3Parquet.js'
import { h3ReleaseSlot, itemPath, releaseDomains, releaseFillColor } from './h3Release.js'
import {
  fillTemplate, idColumn, indicatorColumns, parseReleaseTileUrl, pickRes, releaseFile, releaseLayer, releaseMaxzoom, releaseTileUrl,
  resolvePeriod,
} from './h3ReleaseLayer.js'
import type { H3CollectionLike } from './h3ReleaseLayer.js'
import { readReleaseStats, statsMatch } from './h3Stats.js'
import { h3jAction } from './h3Tiles.js'
import { COMPRESSORS, newReadStats, openRangeFile } from './parquetFile.js'
import { postTileStats } from './h3Tap.js'
import type { H3TileStats } from './h3Tap.js'

// ---- the synthetic release (fixtures/h3release/build.mjs) served as S3 would: Range, 206, 403 for a missing key ----

const ROOT = new URL('../fixtures/h3release/', import.meta.url)
const BASE = 'https://release.test/obis-h3/v1/'
const COLLECTION = JSON.parse(readFileSync(new URL('collection.json', ROOT), 'utf8')) as H3CollectionLike
const CROSSING = JSON.parse(readFileSync(new URL('../fixtures/h3/crossing55.json', import.meta.url), 'utf8')) as { h3: string[] }

interface Served { path: string; range: string; status: number; bytes: number }
function s3(log: Served[] = []): { fetch: typeof fetch; log: Served[] } {
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const path = decodeURIComponent(url.slice(BASE.length))
    const range = new Headers(init?.headers).get('Range') ?? ''
    let buf: Buffer
    try { buf = readFileSync(new URL(path, ROOT)) } catch {
      log.push({ path, range, status: 403, bytes: 0 })
      return new Response('AccessDenied', { status: 403 })
    }
    const size = buf.length
    let a = 0, b = size - 1
    const suffix = /^bytes=-(\d+)$/.exec(range), span = /^bytes=(\d+)-(\d+)$/.exec(range)
    if (suffix) a = Math.max(0, size - Number(suffix[1]))
    else if (span) [a, b] = [Number(span[1]), Math.min(size - 1, Number(span[2]))]
    const body = buf.subarray(a, b + 1)
    log.push({ path, range, status: 206, bytes: body.length })
    return new Response(new Uint8Array(body), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(body.length) } })
  }
  return { fetch: fake as typeof fetch, log }
}
const signal = new AbortController().signal
const fileSize = (p: string) => statSync(new URL(p, ROOT)).size
const layerOf = (opts: Parameters<typeof releaseLayer>[1] = {}) => releaseLayer(COLLECTION, { base: BASE, keys: { layer: 'all' }, ...opts })
const rowsOf = (t: unknown) => t as H3Rows

// ---- which file a tile reads ----

describe('file resolution per period set (h3 profile 1.1)', () => {
  it('no period: the layout template at h3:resolutions, split by res-2 parent at res 6', () => {
    const l = layerOf()
    expect(l).toEqual({
      template: `${BASE}all/res={res}/data_0.parquet`, ladder: [1, 2, 3, 4, 5, 6], pin: null, id: 'cell_id', idType: 'int64',
      columns: ['n', 'sp', 'shannon', 'simpson', 'es'],
      parentTemplate: `${BASE}all/res={res}/p={parent}/data_0.parquet`, parentRes: { 6: 2 },
    })
  })
  it('a decade: its set\'s template and resolutions (1 to 3), no parent split', () => {
    const l = layerOf({ period: '1990s' })
    expect([l.template, l.ladder, l.parentTemplate]).toEqual([`${BASE}decade/all/decade=1990s/res={res}/data_0.parquet`, [1, 2, 3], undefined])
  })
  it('a year, named bare, as grain:value or as { grain, value }', () => {
    const want = `${BASE}year/all/year=2015/res={res}/data_0.parquet`
    expect(layerOf({ period: '2015' }).template).toBe(want)
    expect(layerOf({ period: 'year:2015' }).template).toBe(want)
    expect(layerOf({ period: { grain: 'year', value: '2015' } }).template).toBe(want)
  })
  it('a period no set has, and one two sets share, are refused with the way out', () => {
    expect(() => layerOf({ period: '1980s' })).toThrow(/no period 1980s in h3:periods \(decade: 1990s, 2000s; year: 2015\)/)
    const twin = { ...COLLECTION, 'h3:periods': [{ grain: 'decade', values: ['2010'], placeholder: 'decade', resolutions: [1] }, { grain: 'year', values: ['2010'], placeholder: 'year', resolutions: [1] }] }
    expect(() => resolvePeriod(twin, '2010')).toThrow(/is in decade and year; pass "decade:2010"/)
    expect(resolvePeriod(twin, 'year:2010')!.set.grain).toBe('year')
  })
  it('the v20261012 shape (one set, profile 1.0): the layout template takes the period placeholder', () => {
    const one = { ...COLLECTION, 'h3:layout': { template: 'decade/{layer}/decade={decade}/res={res}/data_0.parquet' }, 'h3:periods': { grain: 'decade', values: ['1990'], placeholder: 'decade', resolutions: [1, 2, 3, 4, 5] } }
    expect(releaseLayer(one, { base: BASE, keys: { layer: 'all' }, period: '1990' }).template).toBe(`${BASE}decade/all/decade=1990/res={res}/data_0.parquet`)
    expect(() => releaseLayer(one, { base: BASE, keys: { layer: 'all' } })).toThrow(/no value for \{decade\}/)
  })
  it('the keys fill the template as given (url-path-ready), {res} and {parent} stay open', () => {
    expect(fillTemplate('{layer}/res={res}/p={parent}/x', { layer: 'taxon/rank=class/taxon=Aves' })).toBe('taxon/rank=class/taxon=Aves/res={res}/p={parent}/x')
    expect(itemPath({ layer: 'eov', key: 'birds' })).toBe('eov/eov=birds')
    expect(itemPath({ layer: 'taxon', key: 'Aves', rank: 'class' })).toBe('taxon/rank=class/taxon=Aves')
    expect(layerOf({ keys: { layer: itemPath({ layer: 'eov', key: 'birds' }) } }).template).toBe(`${BASE}eov/eov=birds/res={res}/data_0.parquet`)
  })
  it('a pinned resolution must be published for the period', () => {
    expect(layerOf({ res: 2 }).pin).toBe(2)
    expect(() => layerOf({ period: '1990s', res: 5 })).toThrow(/resolution 5 is not published for decade 1990s \(1, 2, 3\)/)
  })
  it('the id column is the integer cell_id, the indicators every other numeric column', () => {
    expect(idColumn(COLLECTION)).toEqual({ id: 'cell_id', idType: 'int64' })
    expect(indicatorColumns(COLLECTION)).toEqual(['n', 'sp', 'shannon', 'simpson', 'es'])
    const noInt = { ...COLLECTION, 'table:columns': COLLECTION['table:columns'].filter((c) => c.name !== 'cell_id') }
    expect(idColumn(noInt)).toEqual({ id: 'h3', idType: 'string' })
  })
  it('the tile url carries the layer whole and reads back', () => {
    const l = layerOf({ period: '2000s' })
    const u = releaseTileUrl(l)
    expect(u.startsWith('h3r://') && u.endsWith('/{z}/{x}/{y}')).toBe(true)
    expect(parseReleaseTileUrl(u.replace('{z}/{x}/{y}', '4/3/5'))).toEqual(l)
    expect(parseReleaseTileUrl('h3j://x/1/2/3')).toBeNull()
  })
})

describe('the resolution ladder: zoom -> res -> file, never a roll-up', () => {
  it('auto: the table of tile zoom, resolution and path', () => {
    const l = layerOf()
    const table = [0, 2, 3, 4, 5, 6, 7, 9, 12].map((z) => { const f = releaseFile(l, z); return [z, f.res, f.url.slice(BASE.length), !!f.split] })
    expect(table).toEqual([
      [0, 1, 'all/res=1/data_0.parquet', false], [2, 1, 'all/res=1/data_0.parquet', false], [3, 2, 'all/res=2/data_0.parquet', false],
      [4, 3, 'all/res=3/data_0.parquet', false], [5, 4, 'all/res=4/data_0.parquet', false], [6, 5, 'all/res=5/data_0.parquet', false],
      [7, 6, 'all/res=6/data_0.parquet', true], [9, 6, 'all/res=6/data_0.parquet', true], [12, 6, 'all/res=6/data_0.parquet', true],
    ])
    const split = releaseFile(l, 7)
    expect(split.split!.url('8229affffffffff').slice(BASE.length)).toBe('all/res=6/p=8229affffffffff/data_0.parquet')
    expect(split.split!.parentRes).toBe(2)
  })
  it('a decade stops at its finest resolution (3), and a gap in the ladder takes the coarser file, not the finer rolled up', () => {
    expect(releaseFile(layerOf({ period: '1990s' }), 8).url.slice(BASE.length)).toBe('decade/all/decade=1990s/res=3/data_0.parquet')
    expect([5, 6, 7].map((z) => pickRes(z, [1, 3, 5]))).toEqual([3, 5, 5])
    expect(pickRes(0, [2, 3])).toBe(2)
    expect(pickRes(0, [1, 2, 3], 3)).toBe(3)
  })
  it('the source maxzoom is where the finest resolution starts, at least 6', () => {
    expect([releaseMaxzoom(layerOf()), releaseMaxzoom(layerOf({ period: '1990s' })), releaseMaxzoom(layerOf({ res: 1 }))]).toEqual([7, 6, 6])
  })
  it('rollUp refuses a diversity metric with any aggregate (ES(50) does not add across cells)', () => {
    const t = { h3: ['85283473fffffff'], v: [12] }
    expect(() => rollUp(t, 3, 'mean', { variable: 'es' })).toThrow(/es is a diversity metric/)
    expect(() => rollUp(t, 3, 'sum', { variable: 'sp' })).toThrow(/sp is a diversity metric/)
    expect(rollUp(t, 3, 'sum', { variable: 'n' }).h3).toEqual([cellToParent('85283473fffffff', 3)])
  })
})

// ---- the provider over the fixture ----

const CAL: [number, number] = [-121, 34]

describe('row-group pruning by cell_id statistics', () => {
  it('a z6 tile over California reads one of the three row groups of all/res=5 (the footer, then that group)', async () => {
    const { fetch, log } = s3()
    const reader = new ReleaseReader({ fetch, tail: 4096 })
    const [x, y] = lonLatToTile(...CAL, 6)
    const t = rowsOf(await releaseProvider(layerOf(), reader)(6, x, y, signal))
    expect([reader.groupsRead, reader.groupsSkipped]).toEqual([1, 2])
    expect(log.map((r) => [r.path, r.range.startsWith('bytes=-') ? 'tail' : 'group'])).toEqual([['all/res=5/data_0.parquet', 'tail'], ['all/res=5/data_0.parquet', 'group']])
    expect(reader.stats.bytes).toBeLessThan(fileSize('all/res=5/data_0.parquet') / 2)
    // every cell of the file that touches the tile is there, at res 5
    const all = await parquetReadObjects({ file: (await openRangeFile(`${BASE}all/res=5/data_0.parquet`, { fetch }))!, columns: ['h3'], compressors: COMPRESSORS })
    const touching = all.map((r) => r.h3 as string).filter((h) => cellTouchesTile(h, 6, x, y))
    expect(touching.length).toBeGreaterThan(100)
    const got = new Set(t.h3)
    expect(touching.filter((h) => !got.has(h))).toEqual([])
    expect(new Set(t.h3.map(getResolution))).toEqual(new Set([5]))
  })
  it('a tile over open ocean reads the footer and no row group', async () => {
    const reader = new ReleaseReader({ fetch: s3().fetch, tail: 4096 })
    const [x, y] = lonLatToTile(-30, -30, 6)
    expect(await releaseProvider(layerOf(), reader)(6, x, y, signal)).toBeNull()
    expect([reader.groupsRead, reader.groupsSkipped]).toEqual([0, 3])
  })
  it('the cache: a second tile in the same row group, and the same tile again, fetch nothing', async () => {
    const { fetch, log } = s3()
    const reader = new ReleaseReader({ fetch, tail: 4096 })
    const p = releaseProvider(layerOf(), reader)
    const [x, y] = lonLatToTile(...CAL, 7)
    await p(6, x >> 1, y >> 1, signal)
    const [n, bytes] = [log.length, reader.stats.bytes]
    // the next z6 tile east is still the California disc (one row group)
    expect(rowsOf(await p(6, (x >> 1) + 1, y >> 1, signal)).h3.length).toBeGreaterThan(100)
    await p(6, x >> 1, y >> 1, signal)
    expect([log.length, reader.stats.bytes, reader.groupsRead]).toEqual([n, bytes, 1])
    // another layer object over the same file (a slot remounted) shares the reader's cache
    await releaseProvider(layerOf(), reader)(6, x >> 1, y >> 1, signal)
    expect(log.length).toBe(n)
  })
  it('a missing file (403) is no cells, asked once', async () => {
    const { fetch, log } = s3()
    const reader = new ReleaseReader({ fetch })
    const p = releaseProvider(layerOf({ keys: { layer: 'taxon/rank=class/taxon=Aves' } }), reader)
    expect(await p(0, 0, 0, signal)).toBeNull()
    expect(await p(1, 0, 0, signal)).toBeNull()
    expect(log).toEqual([{ path: 'taxon/rank=class/taxon=Aves/res=1/data_0.parquet', range: 'bytes=-65536', status: 403, bytes: 0 }])
  })
})

describe('the parent split at res 6 (h3:layout.parent_template), and a layer left whole', () => {
  it('a z7 tile over California reads the files of its res-2 parents, never the whole layer', async () => {
    const { fetch, log } = s3()
    const reader = new ReleaseReader({ fetch })
    const [x, y] = lonLatToTile(...CAL, 7)
    const t = rowsOf(await releaseProvider(layerOf(), reader)(7, x, y, signal))
    expect(t.h3.length).toBeGreaterThan(100)
    expect(new Set(t.h3.map(getResolution))).toEqual(new Set([6]))
    const asked = [...new Set(log.map((r) => r.path))]
    expect(asked.every((p) => /^all\/res=6\/p=82[0-9a-f]{13}\/data_0\.parquet$/.test(p))).toBe(true)
    expect(asked).toContain('all/res=6/p=822917fffffffff/data_0.parquet')
    expect(reader.modes.get(`${BASE}all/res=6/data_0.parquet`)).toBe('split')
  })
  it('a layer whose parents are all missing reads its whole file once, and then only that', async () => {
    const { fetch, log } = s3()
    const reader = new ReleaseReader({ fetch })
    const p = releaseProvider(layerOf({ keys: { layer: 'taxon/rank=class/taxon=Aves' } }), reader)
    const [x, y] = lonLatToTile(...CAL, 7)
    const t = rowsOf(await p(7, x, y, signal))
    expect(t.h3.length).toBeGreaterThan(50)
    expect(log.filter((r) => r.status === 206).map((r) => r.path)).toEqual(['taxon/rank=class/taxon=Aves/res=6/data_0.parquet'])
    const before = log.length
    await p(7, x + 1, y, signal)
    expect(log.slice(before).every((r) => r.path === 'taxon/rank=class/taxon=Aves/res=6/data_0.parquet')).toBe(true)
    expect(reader.modes.get(`${BASE}taxon/rank=class/taxon=Aves/res=6/data_0.parquet`)).toBe('whole')
  })
})

describe('multi-indicator tiles', () => {
  it('every indicator column of the row is a property of its feature; a NULL ES(50) is left out', async () => {
    const reader = new ReleaseReader({ fetch: s3().fetch })
    const action = h3jAction(releaseProvider(layerOf(), reader))
    const [x, y] = lonLatToTile(...CAL, 6)
    const r = await action({ url: `h3r://k/6/${x}/${y}` } as never, new AbortController())
    const layer = new VectorTile(new PbfReader(new Uint8Array(r.data as ArrayBuffer))).layers.h3
    expect(layer.length).toBeGreaterThan(100)
    const props = Array.from({ length: layer.length }, (_, i) => layer.feature(i).properties)
    const keys = new Set(props.map((p) => Object.keys(p).sort().join(',')))
    expect(keys).toEqual(new Set(['es,h3,n,shannon,simpson,sp', 'h3,n,shannon,simpson,sp']))
    // the values are the file's: n and sp integers, es missing exactly under 50 records
    for (const p of props) {
      expect(Number.isInteger(p.n) && Number.isInteger(p.sp)).toBe(true)
      expect('es' in p).toBe((p.n as number) >= 50)
    }
    const file = await parquetReadObjects({ file: (await openRangeFile(`${BASE}all/res=5/data_0.parquet`, { fetch: s3().fetch }))!, compressors: COMPRESSORS })
    const byH3 = new Map(file.map((row) => [row.h3 as string, row]))
    const one = props.find((p) => 'es' in p)!
    const src = byH3.get(one.h3 as string)!
    expect(one).toEqual({ h3: src.h3, n: Number(src.n), sp: Number(src.sp), shannon: src.shannon, simpson: src.simpson, es: src.es })
  })
  it('a decade tile carries that decade\'s values (the fixture shifts n by 1,000 for the 1990s)', async () => {
    const reader = new ReleaseReader({ fetch: s3().fetch })
    const all = rowsOf(await releaseProvider(layerOf(), reader)(0, 0, 0, signal))
    const dec = rowsOf(await releaseProvider(layerOf({ period: '1990s' }), reader)(0, 0, 0, signal))
    const i = all.h3.indexOf(dec.h3[0])
    expect(dec.columns.n[0] - all.columns.n[i]).toBe(1000)
  })
})

describe('the crossing-55 seam through the release provider (spike 1 condition 4)', () => {
  it('tile x = 0 and x = 2^z - 1 both hold every crossing cell Mercator draws, at z6 (res 5)', async () => {
    const reader = new ReleaseReader({ fetch: s3().fetch })
    const p = releaseProvider(layerOf({ keys: { layer: 'seam' } }), reader)
    const drawn = CROSSING.h3.filter((h) => Math.abs(cellToLatLng(h)[0]) < 85.0511)
    expect(drawn).toHaveLength(52)
    const byRow = new Map<number, string[]>()
    for (const h of drawn) { const [, y] = lonLatToTile(180, cellToLatLng(h)[0], 6); byRow.set(y, [...(byRow.get(y) ?? []), h]) }
    for (const [y, hs] of byRow) {
      const west = new Set(rowsOf(await p(6, 0, y, signal)).h3), east = new Set(rowsOf(await p(6, 63, y, signal)).h3)
      expect(hs.filter((h) => !west.has(h)), `x0 y${y}`).toEqual([])
      expect(hs.filter((h) => !east.has(h)), `x63 y${y}`).toEqual([])
    }
  })
})

// ---- the legend ----

/** R type 7 / DuckDB quantile_cont */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo)
}

describe('the legend reader over stats.parquet', () => {
  it('statsMatch names the release\'s rows: all time, a decade, a year', () => {
    expect(statsMatch({ layer: 'all' }, null)).toEqual({ layer: 'all', key: '', rank: '', period: null })
    expect(statsMatch({ layer: 'all' }, { grain: 'decade', value: '1990s' })).toEqual({ layer: 'decade_all', key: '', rank: '', period: { column: 'decade', value: 1990 } })
    expect(statsMatch({ layer: 'eov', key: 'birds' }, { grain: 'year', value: '2015' }).layer).toBe('year_eov')
  })
  it('one read gives every resolution and variable of the layer; p02 and p98 are the file\'s quantiles', async () => {
    const { fetch } = s3()
    const rows = await readReleaseStats(`${BASE}stats.parquet`, statsMatch({ layer: 'all' }, null), { fetch })
    expect(rows.map((r) => `${r.res}:${r.variable}`)).toEqual([1, 2, 3, 4, 5].flatMap((r) => ['es', 'n', 'shannon', 'simpson', 'sp'].map((v) => `${r}:${v}`)))
    const es = (await parquetReadObjects({ file: (await openRangeFile(`${BASE}all/res=3/data_0.parquet`, { fetch }))!, columns: ['es'], compressors: COMPRESSORS }))
      .map((r) => r.es as number | null).filter((v): v is number => v != null).sort((a, b) => a - b)
    const row = rows.find((r) => r.res === 3 && r.variable === 'es')!
    expect(row.n_cells).toBe(es.length)
    expect(row.p02).toBeCloseTo(quantile(es, 0.02), 9)
    expect(row.p98).toBeCloseTo(quantile(es, 0.98), 9)
    expect(releaseDomains(rows, 'es').get(3)).toEqual([row.p02, row.p98])
  })
  it('a decade\'s rows and a year\'s rows, and only the row group of the layer is read', async () => {
    const { fetch } = s3()
    const stats = newReadStats()
    const dec = await readReleaseStats(`${BASE}stats.parquet`, statsMatch({ layer: 'all' }, { grain: 'decade', value: '1990s' }), { fetch, stats, tail: 2048 })
    expect(dec.map((r) => r.res)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3])
    const yr = await readReleaseStats(`${BASE}stats.parquet`, statsMatch({ layer: 'all' }, { grain: 'year', value: '2015' }), { fetch })
    expect(yr).toHaveLength(15)
    expect(yr.find((r) => r.res === 1 && r.variable === 'n')!.min).not.toBe(dec.find((r) => r.res === 1 && r.variable === 'n')!.min)
    // decade_all lies in the first of the five row groups (sorted by layer, key): the tail and that group's columns
    expect(stats.bytes).toBeLessThan(fileSize('stats.parquet') / 2)
    const aves = await readReleaseStats(`${BASE}stats.parquet`, { layer: 'taxon', key: 'Aves', rank: 'class' }, { fetch })
    expect(aves.map((r) => r.res)).toEqual([5, 5, 5, 5, 5, 6, 6, 6, 6, 6])
  })
})

// ---- the slot on a stand-in map ----

function fakeMap(zoom = 4) {
  const calls: string[] = []
  const sources = new Map<string, unknown>(), layers = new Map<string, Record<string, unknown>>()
  const handlers = new Map<string, () => void>()
  const m = {
    calls, sources, layers, zoom,
    addSource(id: string, s: Record<string, unknown>) { calls.push(`addSource ${id}`); sources.set(id, { ...s, setTiles(t: string[]) { calls.push('setTiles'); (sources.get(id) as { tiles: string[] }).tiles = t } }) },
    addLayer(l: Record<string, unknown>) { calls.push(`addLayer ${l.id}`); layers.set(l.id as string, l) },
    getSource: (id: string) => sources.get(id), getLayer: (id: string) => layers.get(id),
    removeLayer(id: string) { calls.push(`removeLayer ${id}`); layers.delete(id) },
    removeSource(id: string) { calls.push(`removeSource ${id}`); sources.delete(id) },
    setPaintProperty(id: string, k: string, v: unknown) { calls.push(`paint ${k}`); (layers.get(id)!.paint as Record<string, unknown>)[k] = v },
    setFilter(id: string, f: unknown) { calls.push('filter'); layers.get(id)!.filter = f },
    getStyle: () => ({ layers: [...layers.keys()].map((id) => ({ id })) }),
    getZoom: () => m.zoom,
    on(e: string, f: () => void) { handlers.set(e, f) }, off(e: string) { handlers.delete(e) },
    fire(e: string) { handlers.get(e)?.() },
  }
  return m
}

describe('h3ReleaseSlot', () => {
  const settle = (slot: { statsRows(): unknown }) => new Promise<void>((done) => { const t = setInterval(() => { if (slot.statsRows()) { clearInterval(t); done() } }, 5) })

  it('mounts one source over the release and a fill on the indicator, then the legend from stats.parquet', async () => {
    const m = fakeMap(4)
    const slot = h3ReleaseSlot({ collection: COLLECTION, base: BASE, indicator: 'es', fetch: s3().fetch })
    slot.mount(m as never, null, null)
    expect(m.calls).toEqual(['addSource slot:h3', 'addLayer slot:h3:fill'])
    expect(m.sources.get('slot:h3')).toMatchObject({ type: 'vector', tiles: [releaseTileUrl(slot.layer())], maxzoom: 7, promoteId: 'h3' })
    expect(m.layers.get('slot:h3:fill')).toMatchObject({ type: 'fill', 'source-layer': 'h3', filter: ['has', 'es'] })
    await settle(slot)
    const lg = slot.legend()
    const es3 = slot.statsRows()!.find((r) => r.res === 3 && r.variable === 'es')!
    expect([lg.ramp!.min, lg.ramp!.max, lg.stats!.minimum, lg.stats!.maximum, lg.t]).toEqual([es3.p02, es3.p98, es3.min, es3.max, null])
    expect(lg.via).toBe('h3 hexagons, res 3, from the release\'s Parquet (worker)')
    expect(m.calls.slice(2)).toEqual(['paint fill-color', 'filter'])
  })
  it('update: the indicator is a paint change; a period or pinned res changes the tiles only when the file does', async () => {
    const m = fakeMap(4)
    const slot = h3ReleaseSlot({ collection: COLLECTION, base: BASE, indicator: 'es', statsHref: null, domain: [0, 50] })
    slot.mount(m as never, null, null)
    m.calls.length = 0
    slot.update({ indicator: 'sp' })
    expect(m.calls).toEqual(['paint fill-color', 'filter'])
    expect(m.layers.get('slot:h3:fill')!.filter).toEqual(['has', 'sp'])
    expect(JSON.stringify((m.layers.get('slot:h3:fill')!.paint as Record<string, unknown>)['fill-color'])).toContain('["get","sp"]')
    m.calls.length = 0
    slot.update({ indicator: 'sp' })
    slot.update(null)
    expect(m.calls.filter((c) => /setTiles|Source/.test(c))).toEqual([])
    // the 1990s stop at res 3: a new maxzoom (6), so a new source
    slot.update('1990s')
    expect(m.calls.filter((c) => /setTiles|Source/.test(c))).toEqual(['removeSource slot:h3', 'addSource slot:h3'])
    m.calls.length = 0
    slot.update({ period: '2000s' })
    slot.update({ period: '2000s' })
    slot.update({ res: 2 })
    expect(m.calls.filter((c) => /setTiles|Source/.test(c))).toEqual(['setTiles', 'setTiles'])
    expect((m.sources.get('slot:h3') as { tiles: string[] }).tiles).toEqual([releaseTileUrl({ ...layerOf({ period: '2000s', res: 2 }), tap: slot.layer().tap })])
    expect(slot.legend().t).toBe('2000s')
    expect(slot.view()).toEqual({ indicator: 'sp', period: '2000s', res: 2 })
  })
  it('the legend follows the resolution the zoom draws', async () => {
    const m = fakeMap(4)
    let changes = 0
    const slot = h3ReleaseSlot({ collection: COLLECTION, base: BASE, indicator: 'n', fetch: s3().fetch, onchange: () => { changes++ } })
    slot.mount(m as never, null, null)
    await settle(slot)
    m.zoom = 6.4
    const before = changes
    m.fire('zoomend')
    expect(changes).toBe(before + 1)
    const n5 = slot.statsRows()!.find((r) => r.res === 5 && r.variable === 'n')!
    expect([slot.legend().ramp!.min, slot.legend().ramp!.max]).toEqual([n5.p02, n5.p98])
    slot.unmount(m as never)
    expect([m.sources.size, m.layers.size]).toEqual([0, 0])
  })
  it('two slots of one layer side by side take instance ids', () => {
    const m = fakeMap()
    h3ReleaseSlot({ collection: COLLECTION, base: BASE, indicator: 'es', statsHref: null, instance: 'then', period: '1990s' }).mount(m as never, null, null)
    h3ReleaseSlot({ collection: COLLECTION, base: BASE, indicator: 'es', statsHref: null, instance: 'now' }).mount(m as never, null, null)
    expect([...m.sources.keys()]).toEqual(['slot:h3@then', 'slot:h3@now'])
  })
  it('the fill steps with the zoom, each resolution on its own domain; pinned, one ramp', () => {
    const d = new Map<number, [number, number]>([[1, [1, 10]], [2, [2, 20]], [3, [3, 30]], [4, [4, 40]], [5, [5, 50]], [6, [6, 60]]])
    const e = releaseFillColor(layerOf(), 'es', d) as unknown[]
    expect(e.slice(0, 2)).toEqual(['step', ['zoom']])
    expect(e.filter((x) => typeof x === 'number')).toEqual([3, 4, 5, 6, 7])
    const ramps = e.filter((x) => Array.isArray(x) && x[0] === 'interpolate') as unknown[][]
    expect(ramps.map((r) => [r[2], r[3], r[r.length - 2]])).toEqual([1, 2, 3, 4, 5, 6].map((k) => [['get', 'es'], k, k * 10]))
    const pinned = releaseFillColor(layerOf({ res: 2 }), 'es', d) as unknown[]
    expect([pinned[0], pinned[2], pinned[3]]).toEqual(['interpolate', ['get', 'es'], 2])
  })
})

// ---- what the tiles cost, from the worker to the page (h3Tap.ts) ----

describe('tile stats: the worker posts per built tile, the slot totals them', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const until = async (f: () => boolean) => { for (let i = 0; i < 400 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); expect(f()).toBe(true) }
  const slotOf = (extra: Partial<Parameters<typeof h3ReleaseSlot>[0]> = {}) =>
    h3ReleaseSlot({ collection: COLLECTION, base: BASE, indicator: 'es', statsHref: null, domain: [0, 50], ...extra })
  // the worker's side: a provider over the slot's own layer (it carries the tap), posting on the channel
  const workerOf = (slot: ReturnType<typeof slotOf>, reader: ReleaseReader) => releaseProvider(slot.layer(), reader, { onTile: postTileStats })
  const tile6 = lonLatToTile(...CAL, 6)

  it('the message of a tile: tile, file, requests, bytes, row groups read and skipped, ms, cached', async () => {
    const { fetch } = s3()
    const reader = new ReleaseReader({ fetch, tail: 4096 })
    const got: H3TileStats[] = []
    const p = releaseProvider({ ...layerOf(), tap: 'abc' }, reader, { onTile: (m) => got.push(m) })
    const [x, y] = tile6
    await p(6, x, y, signal)
    expect(got).toHaveLength(1)
    const m = got[0]
    expect(Object.keys(m).sort()).toEqual(['bytes', 'cached', 'file', 'ms', 'requests', 'rowGroupsRead', 'rowGroupsSkipped', 'tap', 'tile'])
    expect(m).toMatchObject({ tile: { z: 6, x, y }, file: `${BASE}all/res=5/data_0.parquet`, tap: 'abc', requests: 2, rowGroupsRead: 1, rowGroupsSkipped: 2, cached: false })
    // what the tile read is what the reader read: the footer and one row group, nothing else
    expect(m.bytes).toBe(reader.stats.bytes)
    expect(m.bytes).toBeGreaterThan(0)
    expect(typeof m.ms === 'number' && m.ms >= 0).toBe(true)
    // the same tile again: no request, no byte, the row group not read again, the skips counted again
    await p(6, x, y, signal)
    expect(got[1]).toMatchObject({ requests: 0, bytes: 0, rowGroupsRead: 0, rowGroupsSkipped: 2, cached: true })
  })
  it('a tile that reads nothing still reports (open ocean: the footer and no row group; a missing file: one miss)', async () => {
    const reader = new ReleaseReader({ fetch: s3().fetch, tail: 4096 })
    const got: H3TileStats[] = []
    const [x, y] = lonLatToTile(-30, -30, 6)
    await releaseProvider(layerOf(), reader, { onTile: (m) => got.push(m) })(6, x, y, signal)
    expect(got[0]).toMatchObject({ requests: 1, rowGroupsRead: 0, rowGroupsSkipped: 3, cached: false })
    expect(got[0].tap).toBeUndefined()
    await releaseProvider(layerOf({ keys: { layer: 'taxon/rank=class/taxon=Aves' } }), reader, { onTile: (m) => got.push(m) })(0, 0, 0, signal)
    expect(got[1]).toMatchObject({ requests: 1, bytes: 0, rowGroupsRead: 0, cached: false })
  })
  it('tiles in flight together are billed apart: the one that reads the group pays, the other is cached', async () => {
    const reader = new ReleaseReader({ fetch: s3().fetch, tail: 4096 })
    const got: H3TileStats[] = []
    const p = releaseProvider(layerOf(), reader, { onTile: (m) => got.push(m) })
    const [x, y] = tile6
    await Promise.all([p(6, x, y, signal), p(6, x + 1, y, signal)])
    expect(got.map((m) => m.requests).sort()).toEqual([0, 2])
    expect(got.reduce((n, m) => n + m.bytes, 0)).toBe(reader.stats.bytes)
    expect(got.reduce((n, m) => n + m.rowGroupsRead, 0)).toBe(reader.groupsRead)
  })
  it('totals after two tiles of one file: the second is cached, 0 bytes; the subscription fires with each', async () => {
    const slot = slotOf()
    slot.mount(fakeMap(6) as never, null, null)
    expect(slot.layer().tap).toMatch(/^[a-z0-9]+$/)
    expect(slot.stats()).toMatchObject({ tiles: 0, requests: 0, bytes: 0, file: null, files: [] })
    const seen: [number, H3TileStats][] = []
    const off = slot.onStats((s, t) => seen.push([s.tiles, t]))
    const reader = new ReleaseReader({ fetch: s3().fetch, tail: 4096 })
    const p = workerOf(slot, reader)
    const [x, y] = tile6
    await p(6, x, y, signal)
    await until(() => slot.stats().tiles === 1)
    await p(6, x + 1, y, signal)
    await until(() => slot.stats().tiles === 2)
    const st = slot.stats()
    expect(seen.map(([n, t]) => [n, t.cached, t.bytes === 0])).toEqual([[1, false, false], [2, true, true]])
    expect(st).toMatchObject({ tiles: 2, cachedTiles: 1, requests: 2, bytes: reader.stats.bytes, rowGroupsRead: 1, rowGroupsSkipped: 4, file: `${BASE}all/res=5/data_0.parquet` })
    expect(st.ms).toBeGreaterThanOrEqual(0)
    expect(st.files).toEqual([{ file: `${BASE}all/res=5/data_0.parquet`, period: null, res: 5, current: true, tiles: 2, cachedTiles: 1, requests: 2, bytes: reader.stats.bytes, rowGroupsRead: 1, rowGroupsSkipped: 4, ms: st.ms }])
    // a snapshot does not move with later tiles; an unsubscribed callback is not called
    off()
    await p(6, x, y, signal)
    await until(() => slot.stats().tiles === 3)
    expect([st.tiles, seen.length]).toEqual([2, 2])
    slot.unmount(fakeMap() as never)
  })
  it('update({ indicator }) resets nothing; a period or resolution change keeps the totals and marks the new file', async () => {
    const slot = slotOf()
    const m = fakeMap(6)
    slot.mount(m as never, null, null)
    const reader = new ReleaseReader({ fetch: s3().fetch, tail: 4096 })
    const [x, y] = tile6
    await workerOf(slot, reader)(6, x, y, signal)
    await until(() => slot.stats().tiles === 1)
    const before = slot.stats(), tap = slot.layer().tap
    slot.update({ indicator: 'sp' })
    expect(slot.stats()).toEqual(before)
    expect(slot.layer().tap).toBe(tap)
    // the 2000s stop at res 3: another file, read by the same tap
    slot.update({ period: '2000s' })
    expect(slot.layer().tap).toBe(tap)
    expect(slot.stats().files.map((f) => f.current)).toEqual([false])
    await workerOf(slot, reader)(6, x, y, signal)
    await until(() => slot.stats().tiles === 2)
    const st = slot.stats()
    expect(st.files.map((f) => [f.file.slice(BASE.length), f.res, f.period, f.current, f.tiles])).toEqual([
      ['all/res=5/data_0.parquet', 5, null, false, 1],
      ['decade/all/decade=2000s/res=3/data_0.parquet', 3, { grain: 'decade', value: '2000s' }, true, 1],
    ])
    expect(st.file).toBe(`${BASE}decade/all/decade=2000s/res=3/data_0.parquet`)
    expect(st.bytes).toBe(before.bytes + st.files[1].bytes)
    expect(st.requests).toBe(reader.stats.requests)
    // back to all time: the first file is current again, its counts kept
    slot.update({ period: null })
    expect(slot.stats().files.map((f) => f.current)).toEqual([true, false])
    slot.unmount(m as never)
  })
  it('counts only its own tap: another slot, another tab and a hand-built layer on the same channel are not counted', async () => {
    const a = slotOf(), b = slotOf({ instance: 'other' })
    const m = fakeMap(6)
    a.mount(m as never, null, null); b.mount(m as never, null, null)
    expect(a.layer().tap).not.toBe(b.layer().tap)
    const reader = new ReleaseReader({ fetch: s3().fetch, tail: 4096 })
    const [x, y] = tile6
    await releaseProvider(layerOf(), reader, { onTile: postTileStats })(6, x, y, signal)
    await workerOf(b, reader)(6, x, y, signal)
    await until(() => b.stats().tiles === 1)
    expect([a.stats().tiles, b.stats().tiles]).toEqual([0, 1])
    a.unmount(m as never); b.unmount(m as never)
  })
  it('without BroadcastChannel the layer is as before and stats() stays at zero (stats: false is the same)', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const slot = slotOf()
    slot.mount(fakeMap(6) as never, null, null)
    expect(slot.layer()).toEqual(layerOf())
    expect(slot.stats()).toMatchObject({ tiles: 0, bytes: 0, files: [] })
    expect(() => postTileStats({ tile: { z: 0, x: 0, y: 0 }, file: 'f', requests: 0, bytes: 0, rowGroupsRead: 0, rowGroupsSkipped: 0, ms: 0, cached: true })).not.toThrow()
    vi.unstubAllGlobals()
    expect(slotOf({ stats: false }).layer()).toEqual(layerOf())
  })
})
