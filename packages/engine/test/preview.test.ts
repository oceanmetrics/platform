// the chunked live preview and the map's slice, against a stub ERDDAP: an injected fetch that serves the checked-in
// synthetic slabs (fixtures/slabs, pyarrow) cut to each request's time and lat/lon box by a second DuckDB-WASM, the
// endpoints snapped to the nearest step in the file as ERDDAP snaps them. no network.
//   daily_3x3x100.parquet  a 3 x 3 grid over 2026-01-01 .. 04-10, SST = the day of the year everywhere
//   stats_3x3x2.parquet    extract/tests/test_stats.py's slab (two days, the diagonal -2/0/2 then NULL/0/2)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SliceSource as MapSliceSource } from '../../map/src/grid.js'
import type { CubeVariable } from '../src/dataset.js'
import type { Engine } from '../src/engine.js'
import type { Lobe } from '../src/lobes.js'
import { lobeAxes, lobeMasks, previewWindow, runPreview, sliceSource, type PreviewChunk, type PreviewDataset } from '../src/preview.js'
import { nodeEngine } from './helpers/nodeDb.js'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LATS = [20.0, 20.05, 20.1], LONS = [-160.0, -159.95, -159.9]
const DS: PreviewDataset = { baseUrl: 'https://erddap.test/erddap', datasetId: 'grid', latDescending: false, lonRange: [-180, 180], format: 'parquet' }
const SST: CubeVariable = { name: 'SST', unit: 'degree_C', description: 'sst', categorical: false }
const CLASS: CubeVariable = { name: 'CLASS', unit: null, description: 'class', categorical: true }
const box = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
const lobe = (id: string, b: [number, number, number, number]): Lobe => ({
  id, bbox: b, nParts: 1,
  geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: box(...b) } }] },
})
/** the whole 3 x 3 grid as one lobe: its cell edges are the centres +- 0.025 */
const WHOLE = lobe('TEST:BOX', [-160.025, 19.975, -159.875, 20.125])
const AXES = [{ lon: LONS, lat: LATS }]
/** test_stats.py's mask: the diagonal, weights 1, .5, .5 */
const DIAGONAL = [{ lon: LONS[0], lat: LATS[0], weight: 1 }, { lon: LONS[1], lat: LATS[1], weight: 0.5 }, { lon: LONS[2], lat: LATS[2], weight: 0.5 }]

// ---- the stub ERDDAP ----
// the node-blocking bundle writes COPY ... TO on the real filesystem: the stub's answers go to a temporary folder
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'om-engine-'))
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))
let stub: Engine
let n = 0
interface Hit { url: string; t: [string, string]; done: number }
function erddap(file: string, opts: { delay?: (i: number) => number; hits?: Hit[] } = {}) {
  const hits = opts.hits ?? []
  let i = 0, done = 0
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input))
    const k = i++
    const m = /\[\(([^)]+)\):1:\(([^)]+)\)\]\[\(([^)]+)\):1:\(([^)]+)\)\]\[\(([^)]+)\):1:\(([^)]+)\)\]/.exec(url)
    if (!m) return new Response('bad request', { status: 400 })
    const [t0, t1, la0, la1, lo0, lo1] = m.slice(1)
    const hit: Hit = { url, t: [t0, t1], done: -1 }
    hits.push(hit)
    if (opts.delay) await new Promise((ok, no) => {
      const timer = setTimeout(ok, opts.delay!(k))
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); no(init.signal!.reason) })
    })
    // the nearest step in the file to each endpoint (ERDDAP's snapping); 'last' is the last step
    const steps = (await stub.exec(`SELECT DISTINCT epoch_ms(time) AS ms FROM read_parquet('${file}') ORDER BY 1`)).map((r) => Number(r.ms))
    const snap = (t: string) => t === 'last' ? steps[steps.length - 1] : steps.reduce((a, b) => (Math.abs(b - Date.parse(t)) < Math.abs(a - Date.parse(t)) ? b : a))
    const out = path.join(TMP, `out_${++n}.parquet`)
    await stub.exec(`COPY (SELECT * FROM read_parquet('${file}')
      WHERE epoch_ms(time) BETWEEN ${snap(t0)} AND ${snap(t1)}
        AND latitude BETWEEN ${Math.min(+la0, +la1) - 1e-4} AND ${Math.max(+la0, +la1) + 1e-4}
        AND longitude BETWEEN ${Math.min(+lo0, +lo1) - 1e-4} AND ${Math.max(+lo0, +lo1) + 1e-4}
      ORDER BY time, latitude, longitude) TO '${out}' (FORMAT PARQUET)`)
    const buf = await stub.db.copyFileToBuffer(out)
    hit.done = done++
    return new Response(buf as unknown as BodyInit)
  }) as unknown as typeof fetch
  return { fetchFn, hits }
}
const span = (h: Hit) => `${h.t[0].slice(0, 10)}..${h.t[1].slice(0, 10)}`

beforeAll(async () => {
  stub = nodeEngine()
  for (const f of ['daily_3x3x100.parquet', 'stats_3x3x2.parquet'])
    await stub.registerBuffer(f, new Uint8Array(fs.readFileSync(path.join(PKG, 'fixtures', 'slabs', f))))
}, 30_000)

const tables = async (e: Engine) => (await e.exec(`SELECT table_name FROM duckdb_tables() ORDER BY 1`)).map((r) => r.table_name)

// ---- the chunk rule ----
describe('previewWindow (chunkDaysFor in the browser)', () => {
  it('90 days for a small place, fewer when a request would pass 100,000 values, never under one step', () => {
    expect(previewWindow(9)).toBe(90)
    expect(previewWindow(1_200)).toBe(83)
    expect(previewWindow(101_000)).toBe(1)
    expect(previewWindow(25_000, 8)).toBe(32)
    expect(previewWindow(9, 1, { maxValues: 270 })).toBe(30)
    expect(previewWindow(9, 1, { maxDays: 7 })).toBe(7)
  })
})

describe('lobeMasks', () => {
  it('masks a 0..360 grid in the polygon frame and gives the cells back in the grid frame', () => {
    const lons = [200, 200.05, 200.1]
    const m = lobeMasks({ lonRange: [0, 360] }, [WHOLE], [{ lon: lons, lat: LATS }])
    expect(m.cellsPerStep).toBe(9)
    expect([...new Set(m.cells.map((c) => c.lon))].sort()).toEqual(lons)
    expect(m.cells).toHaveLength(9)
  })
  it('refuses lobes and axes that do not pair up', () => {
    expect(() => lobeMasks(DS, [WHOLE], [])).toThrow(/1 lobe\(s\) but 0 axis pair\(s\)/)
  })
})

describe('lobeAxes', () => {
  it("asks the server for each lobe's axes, in the dataset's own frame and lat order", async () => {
    const urls: string[] = []
    const fetchFn = (async (u: string) => {
      urls.push(decodeURIComponent(u))
      const axis = u.includes('longitude') ? [200, 200.05] : [20.1, 20.05]
      return Response.json({ table: { columnNames: ['x'], rows: axis.map((x) => [x]) } })
    }) as unknown as typeof fetch
    const ax = await lobeAxes({ ...DS, lonRange: [0, 360], latDescending: true }, [WHOLE], { fetch: fetchFn })
    expect(ax).toEqual([{ lon: [200, 200.05], lat: [20.1, 20.05] }])
    expect(urls.sort()).toEqual([
      'https://erddap.test/erddap/griddap/grid.json?latitude[(20.125):1:(19.975)]',
      'https://erddap.test/erddap/griddap/grid.json?longitude[(199.975):1:(200.125)]',
    ])
  })
})

// ---- the preview ----
describe('runPreview', () => {
  it('cuts a 100-day window at 90 days: two requests, every day once, in order', async () => {
    const { fetchFn, hits } = erddap('daily_3x3x100.parquet')
    const got: PreviewChunk[] = []
    const r = await runPreview({ dataset: DS, variable: SST, lobes: [WHOLE], axes: AXES, t0: '2026-01-01', t1: '2026-04-10',
      engine: nodeEngine(), fetch: fetchFn, onChunk: (_, c) => got.push(c) })
    expect(r.chunkDays).toBe(90)
    expect(hits.map(span)).toEqual(['2026-01-01..2026-03-31', '2026-04-01..2026-04-10'])
    expect(got.map((c) => [c.index, c.count, c.start, c.end])).toEqual([[0, 2, '2026-01-01', '2026-03-31'], [1, 2, '2026-04-01', '2026-04-10']])
    expect(r.rows).toHaveLength(100)
    expect(r.rows.map((x) => x.mean)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))   // the day of the year
    expect(r.rows[0]).toMatchObject({ date: '2026-01-01', n: 9, mean: 1 })
    expect(r.rows[99]).toMatchObject({ date: '2026-04-10', n: 9, mean: 100 })
    expect(r.template).toBe('stats_daily')
    expect(r.maskCells).toBe(9)
  }, 30_000)

  it('the value cap cuts smaller chunks (30 days of 9 cells = 270 values)', async () => {
    const { fetchFn, hits } = erddap('daily_3x3x100.parquet')
    const r = await runPreview({ dataset: DS, variable: SST, lobes: [WHOLE], axes: AXES, t0: '2026-01-01', t1: '2026-04-10',
      engine: nodeEngine(), fetch: fetchFn, limits: { maxValues: 270 } })
    expect(hits.map(span)).toEqual(['2026-01-01..2026-01-30', '2026-01-31..2026-03-01', '2026-03-02..2026-03-31', '2026-04-01..2026-04-10'])
    expect(r.rows.map((x) => x.date)).toEqual([...new Set(r.rows.map((x) => x.date))])
    expect(r.rows).toHaveLength(100)
  }, 30_000)

  it('calls onChunk in time order even when a later chunk lands first', async () => {
    const { fetchFn, hits } = erddap('daily_3x3x100.parquet', { delay: (i) => (i === 0 ? 150 : 0) })
    const order: number[] = []
    await runPreview({ dataset: DS, variable: SST, lobes: [WHOLE], axes: AXES, t0: '2026-01-01', t1: '2026-02-09',
      engine: nodeEngine(), fetch: fetchFn, limits: { maxDays: 20 }, concurrency: 2, onChunk: (rows, c) => order.push(c.index) })
    expect(hits.map(span)).toEqual(['2026-01-01..2026-01-20', '2026-01-21..2026-02-09'])
    expect(hits.map((h) => h.done)).toEqual([1, 0])          // the second request answered first
    expect(order).toEqual([0, 1])                              // the chart still gets January's first twenty days first
  }, 30_000)

  it('one request per lobe per chunk; the lobes are unioned DISTINCT, so a shared column counts once', async () => {
    const { fetchFn, hits } = erddap('daily_3x3x100.parquet')
    const west = lobe('TEST:W', [-160.025, 19.975, -159.975, 20.125]), east = lobe('TEST:E', [-159.975, 19.975, -159.875, 20.125])
    const r = await runPreview({ dataset: DS, variable: SST, lobes: [west, east],
      axes: [{ lon: [-160, -159.95], lat: LATS }, { lon: [-159.95, -159.9], lat: LATS }],
      t0: '2026-01-01', t1: '2026-01-05', engine: nodeEngine(), fetch: fetchFn })
    expect(r.chunks[0].urls).toHaveLength(2)
    expect(hits).toHaveLength(2)
    expect(r.maskCells).toBe(9)
    expect(r.rows.map((x) => [x.date, x.n, x.mean])).toEqual([1, 2, 3, 4, 5].map((d) => [`2026-01-0${d}`, 9, d]))
  }, 30_000)

  it('a step two chunks snap onto is given once (the precompute merge is DISTINCT)', async () => {
    // a two-step file, one-day chunks over four days: 01-03 and 01-04 both snap to 01-02, as on a coarse axis
    const { fetchFn, hits } = erddap('stats_3x3x2.parquet')
    const per: number[] = []
    const r = await runPreview({ dataset: DS, variable: SST, mask: DIAGONAL, axes: AXES, t0: '2026-01-01', t1: '2026-01-04',
      engine: nodeEngine(), fetch: fetchFn, limits: { maxDays: 1 }, onChunk: (rows) => per.push(rows.length) })
    expect(hits).toHaveLength(4)
    expect(per).toEqual([1, 1, 0, 0])
    expect(r.rows.map((x) => x.date)).toEqual(['2026-01-01', '2026-01-02'])
  }, 30_000)

  it("the statistics are test_stats.py's: stats_daily and stats_categorical over the diagonal mask", async () => {
    const e = nodeEngine()
    const { fetchFn } = erddap('stats_3x3x2.parquet')
    const daily = await runPreview({ dataset: DS, variable: SST, mask: DIAGONAL, axes: AXES, t0: '2026-01-01', t1: '2026-01-02', engine: e, fetch: fetchFn })
    expect(daily.rows).toEqual([
      { date: '2026-01-01', n: 3, mean: 0, mean_wt: -0.5, sd: 2, min: -2, max: 2, p10: -1.6, p90: 1.6, weight_sum: 2 },
      { date: '2026-01-02', n: 2, mean: 1, mean_wt: 1, sd: Math.sqrt(2), min: 0, max: 2, p10: 0.2, p90: 1.8, weight_sum: 1 },
    ])
    const cat = await runPreview({ dataset: DS, variable: CLASS, mask: DIAGONAL, axes: AXES, t0: '2026-01-01', t1: '2026-01-02', engine: e, fetch: fetchFn })
    expect(cat.template).toBe('stats_categorical')
    expect(cat.rows).toEqual([
      { date: '2026-01-01', class: 1, n: 2, weight: 1.5, fraction: 0.75, percent_cells: 200 / 3 },
      { date: '2026-01-01', class: 2, n: 1, weight: 0.5, fraction: 0.25, percent_cells: 100 / 3 },
      { date: '2026-01-02', class: 3, n: 2, weight: 1, fraction: 1, percent_cells: 100 },
    ])
  }, 30_000)

  it('abort mid-chain: nothing after the abort reaches onChunk, the promise rejects, the mask and slabs are dropped', async () => {
    const e = nodeEngine()
    const { fetchFn, hits } = erddap('daily_3x3x100.parquet')
    const ctrl = new AbortController()
    const seen: number[] = []
    const p = runPreview({ dataset: DS, variable: SST, lobes: [WHOLE], axes: AXES, t0: '2026-01-01', t1: '2026-04-10', engine: e,
      fetch: fetchFn, limits: { maxDays: 10 }, signal: ctrl.signal,
      onChunk: (_, c) => { seen.push(c.index); if (c.index === 1) ctrl.abort(new DOMException('a newer place', 'AbortError')) } })
    await expect(p).rejects.toMatchObject({ name: 'AbortError', message: 'a newer place' })
    expect(seen).toEqual([0, 1])
    expect(hits.length).toBeLessThanOrEqual(3)                 // chunk 2 may already be in flight (concurrency 2), no more
    expect(await tables(e)).toEqual([])                        // the preview_mask_* table is gone
    expect(await e.exec('SELECT 1 AS ok')).toEqual([{ ok: 1 }]) // and the engine still answers
  }, 30_000)

  it('an abort while a request hangs cancels it', async () => {
    const { fetchFn } = erddap('daily_3x3x100.parquet', { delay: () => 60_000 })
    const ctrl = new AbortController()
    const p = runPreview({ dataset: DS, variable: SST, lobes: [WHOLE], axes: AXES, t0: '2026-01-01', t1: '2026-01-10',
      engine: nodeEngine(), fetch: fetchFn, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(new DOMException('stop', 'AbortError')), 20)
    const t = Date.now()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - t).toBeLessThan(5_000)
  }, 30_000)

  it('an empty mask asks nothing; a tabledap or csvp dataset is refused', async () => {
    const { fetchFn, hits } = erddap('daily_3x3x100.parquet')
    const far = lobe('TEST:FAR', [10, 10, 11, 11])
    const r = await runPreview({ dataset: DS, variable: SST, lobes: [far], axes: AXES, t0: '2026-01-01', t1: '2026-01-10', engine: nodeEngine(), fetch: fetchFn })
    expect([r.rows, r.maskCells, hits.length]).toEqual([[], 0, 0])
    const o = { variable: SST, lobes: [WHOLE], axes: AXES, t0: '2026-01-01', t1: '2026-01-02', engine: nodeEngine(), fetch: fetchFn }
    await expect(runPreview({ ...o, dataset: { ...DS, protocol: 'tabledap' } })).rejects.toThrow(/griddap datasets/)
    await expect(runPreview({ ...o, dataset: { ...DS, format: 'csvp' } })).rejects.toThrow(/Parquet slabs/)
  }, 30_000)

  it('the extent sets the step (chunk days) and the exact instants of the window ends', async () => {
    const { fetchFn, hits } = erddap('daily_3x3x100.parquet')
    const r = await runPreview({ dataset: DS, variable: SST, lobes: [WHOLE], axes: AXES, t0: '2026-01-01', t1: '2026-01-03', engine: nodeEngine(),
      fetch: fetchFn, extent: { start: '2025-01-01T09:00:00Z', end: '2026-01-03T09:00:00Z', stepDays: 8 } })
    expect(r.chunkDays).toBe(720)                              // 90 steps of 8 days
    expect(hits[0].t).toEqual(['2026-01-01T12:00:00Z', '2026-01-03T09:00:00Z'])
  }, 30_000)
})

// ---- the slice ----
describe('sliceSource', () => {
  it("slice(t) is one step's last_step rows: the mask's cells, the area weight, the value, a NULL kept", async () => {
    const { fetchFn, hits } = erddap('stats_3x3x2.parquet')
    const src: MapSliceSource = sliceSource({ dataset: DS, variable: SST, mask: DIAGONAL, axes: AXES, engine: nodeEngine(), fetch: fetchFn })
    expect(await src.slice('2026-01-02')).toEqual([
      { lat: 20, lon: -160, value: null, weight: 1 },
      { lat: 20.05, lon: -159.95, value: 0, weight: 0.5 },
      { lat: 20.1, lon: -159.9, value: 2, weight: 0.5 },
    ])
    expect(hits[0].t).toEqual(['2026-01-02T12:00:00Z', '2026-01-02T12:00:00Z'])
    expect((await src.slice('2026-01-01T12:00:00Z')).map((c) => c.value)).toEqual([-2, 0, 2])
  }, 30_000)

  it("slice(null) is the newest step: the extent's end, or ERDDAP's last", async () => {
    const { fetchFn, hits } = erddap('stats_3x3x2.parquet')
    const o = { dataset: DS, variable: SST, mask: DIAGONAL, axes: AXES, engine: nodeEngine(), fetch: fetchFn }
    const a = await sliceSource({ ...o, extent: { start: '2026-01-01T12:00:00Z', end: '2026-01-02T12:00:00Z' } }).slice(null)
    const b = await sliceSource(o).slice(null)
    expect(hits.map((h) => h.t[0])).toEqual(['2026-01-02T12:00:00Z', 'last'])
    expect(a).toEqual(b)
    expect(a.map((c) => c.value)).toEqual([null, 0, 2])
  }, 30_000)

  it('masks from lobes + axes when no mask is given, once, and drops each step\'s slab', async () => {
    const e = nodeEngine()
    const { fetchFn } = erddap('daily_3x3x100.parquet')
    const src = sliceSource({ dataset: DS, variable: SST, lobes: [WHOLE], axes: AXES, engine: e, fetch: fetchFn })
    const s1 = await src.slice('2026-02-01')
    const s2 = await src.slice('2026-02-02')
    expect(s1).toHaveLength(9)
    expect(s1.every((c) => c.value === 32) && s2.every((c) => c.value === 33)).toBe(true)
    expect((await tables(e)).filter((t) => t.startsWith('slice_mask'))).toHaveLength(1)
  }, 30_000)

  it('an aborted slice rejects', async () => {
    const { fetchFn } = erddap('stats_3x3x2.parquet')
    const src = sliceSource({ dataset: DS, variable: SST, mask: DIAGONAL, axes: AXES, engine: nodeEngine(), fetch: fetchFn })
    await expect(src.slice('2026-01-01', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  })
})
