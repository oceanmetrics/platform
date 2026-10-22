// the Engine on DuckDB-WASM (node-blocking bundle): a Parquet slab registered as a buffer, the mask inserted through
// Arrow IPC, the templates run over them. the slab and the mask are extract/tests/test_stats.py's (fixtures/slabs,
// written by pyarrow with float32 axes as ERDDAP's parquet has them), and the expected rows are that test's
// hand-computed numbers, so the browser engine and om_extract are held to the same answers.
//   day 1  values -2, 0, 2   weights 1, .5, .5   -> n 3, mean 0, mean_wt (-2 + 0 + 1) / 2 = -0.5, sd 2
//   day 2  NULL, 0, 2        weights (1), .5, .5 -> n 2, mean 1, mean_wt (0 + 1) / 1 = 1, sd sqrt(2)
import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectBrowser, type Engine } from '../src/engine.js'
import { isoDay } from '../src/preview.js'
import { duckdbWasmVersion, nodeEngine } from './helpers/nodeDb.js'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const slabBytes = (f: string) => new Uint8Array(fs.readFileSync(path.join(PKG, 'fixtures', 'slabs', f)))
const LATS = [20.0, 20.05, 20.1], LONS = [-160.0, -159.95, -159.9]
const MASK = [{ lon: LONS[0], lat: LATS[0], weight: 1 }, { lon: LONS[1], lat: LATS[1], weight: 0.5 }, { lon: LONS[2], lat: LATS[2], weight: 0.5 }]
const P = { slab: "read_parquet('stats.parquet')", mask: 'mask' }
const days = (rows: Record<string, any>[]) => rows.map((r) => ({ ...r, date: isoDay(r.date) }))

let e: Engine
beforeAll(async () => {
  e = nodeEngine()
  await e.registerBuffer('stats.parquet', slabBytes('stats_3x3x2.parquet'))
  await e.insertMask(MASK)
}, 30_000)

describe(`Engine on DuckDB-WASM ${duckdbWasmVersion()}`, () => {
  it('stats_daily: the rows of test_stats.py DAILY, exactly', async () => {
    const rows = days(await e.runTemplate('stats_daily', { expr: 's."SST"', ...P }))
    expect(rows).toEqual([
      { date: '2026-01-01', n: 3, mean: 0, mean_wt: -0.5, sd: 2, min: -2, max: 2, p10: -1.6, p90: 1.6, weight_sum: 2 },
      { date: '2026-01-02', n: 2, mean: 1, mean_wt: 1, sd: Math.sqrt(2), min: 0, max: 2, p10: 0.2, p90: 1.8, weight_sum: 1 },
    ])
    expect(Object.keys(rows[0])).toEqual(['date', 'n', 'mean', 'mean_wt', 'sd', 'min', 'max', 'p10', 'p90', 'weight_sum'])
  })

  it('stats_daily: a unit conversion in the value expression shifts the mean, not n or weight_sum', async () => {
    const rows = await e.runTemplate('stats_daily', { expr: '(s."SST" - 273.15)', ...P })
    expect(rows.map((r) => [r.n, r.mean, r.weight_sum])).toEqual([[3, 0 - 273.15, 2], [2, 1 - 273.15, 1]])
  })

  it('stats_categorical: the rows of test_stats.py CATEGORICAL (fractions by area, percent by cells)', async () => {
    const rows = days(await e.runTemplate('stats_categorical', { expr: 's."CLASS"', ...P }))
    expect(rows).toEqual([
      { date: '2026-01-01', class: 1, n: 2, weight: 1.5, fraction: 0.75, percent_cells: 200 / 3 },
      { date: '2026-01-01', class: 2, n: 1, weight: 0.5, fraction: 0.25, percent_cells: 100 / 3 },
      { date: '2026-01-02', class: 3, n: 2, weight: 1, fraction: 1, percent_cells: 100 },
    ])
  })

  it('last_step: the masked cells of the last day, the NULL kept (test_stats.py)', async () => {
    const rows = days(await e.runTemplate('last_step', { expr: 's."SST"', ...P }))
    expect(rows).toEqual([
      { date: '2026-01-02', latitude: 20, longitude: -160, weight: 1, value: null },
      { date: '2026-01-02', latitude: 20.05, longitude: -159.95, weight: 0.5, value: 0 },
      { date: '2026-01-02', latitude: 20.1, longitude: -159.9, weight: 0.5, value: 2 },
    ])
  })

  it('records what it did (marks) and the last SQL', async () => {
    await e.runTemplate('stats_daily', { expr: 's."SST"', ...P })
    expect(e.lastSql).toContain(`FROM read_parquet('stats.parquet') s`)
    expect(e.marks.map((m) => m.name)).toEqual(expect.arrayContaining(['connect', 'register:stats.parquet', 'mask:mask', 'query:stats_daily']))
  })

  it('one failed query does not stop the queue', async () => {
    await expect(e.exec('SELECT * FROM no_such_table')).rejects.toThrow(/no_such_table/)
    expect(await e.exec('SELECT 1 AS one')).toEqual([{ one: 1 }])
  })

  it('insertRows + toParquet: rows to a table and back out as Parquet bytes DuckDB wrote', async () => {
    // the node-blocking bundle writes the COPY on the real filesystem (a browser writes into the WASM one)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-engine-'))
    try {
      const buf = await e.toParquet([{ a: 1.5, b: 'x' }, { a: null, b: null }], '_export', path.join(tmp, 'export.parquet'))
      expect([...buf.slice(0, 4)]).toEqual([0x50, 0x41, 0x52, 0x31])        // "PAR1"
      await e.registerBuffer('back.parquet', buf)
      expect(await e.exec(`SELECT a, b FROM read_parquet('back.parquet') ORDER BY b NULLS LAST`))
        .toEqual([{ a: 1.5, b: 'x' }, { a: NaN, b: null }])     // a null in a numeric column goes in as NaN (as in erddap-places)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  // regression: DuckDB-WASM returns DECIMAL as the unscaled integer; points_tabledap's `1.0 AS weight` came back as 10
  it('toRows scales DECIMAL columns', async () => {
    expect(await e.exec('SELECT 1.0 AS w, 20.05 AS lat, 12.5::DECIMAL(18,3) AS v, NULL::DECIMAL(4,1) AS n'))
      .toEqual([{ w: 1, lat: 20.05, v: 12.5, n: null }])
  })
})

describe('connectBrowser', () => {
  it("is erddap-places' boot: select the bundle, start its worker, instantiate with the pthread worker, connect", async () => {
    const calls: string[] = []
    const g = globalThis as any
    const had = g.Worker
    g.Worker = class { constructor(url: string) { calls.push(`worker ${url}`) } }
    try {
      const conn = { query: () => null, insertArrowFromIPCStream: () => null }
      const duckdb: any = {
        VoidLogger: class {},
        selectBundle: async (b: any) => { calls.push(`select ${Object.keys(b).join(',')}`); return { mainModule: 'eh.wasm', mainWorker: 'eh.worker.js', pthreadWorker: null } },
        AsyncDuckDB: class {
          constructor(_logger: unknown, w: unknown) { calls.push(`db ${typeof w}`) }
          async instantiate(m: string, p: unknown) { calls.push(`instantiate ${m} ${p}`) }
          async connect() { calls.push('connect'); return conn }
        },
      }
      const duck = await connectBrowser(duckdb, { mvp: { mainModule: 'mvp.wasm', mainWorker: 'mvp.worker.js' }, eh: { mainModule: 'eh.wasm', mainWorker: 'eh.worker.js' } })
      expect(calls).toEqual(['select mvp,eh', 'worker eh.worker.js', 'db object', 'instantiate eh.wasm null', 'connect'])
      expect(duck.conn).toBe(conn)
    } finally {
      g.Worker = had
    }
  })
})
