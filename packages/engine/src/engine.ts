// DuckDB-WASM as the statistics engine: the slab goes in as a registered Parquet buffer, the mask as an Arrow table,
// and every statistic is a sql/ template rendered with {{named}} params. moved from erddap-places
// `app/src/lib/engine.ts`; the methods are unchanged, but the package never boots DuckDB itself: the app owns the
// bundles and the Web Worker (Vite `?url` imports, a CDN, or the node-blocking bundle in tests) and hands the Engine a
// `connect()` that resolves to `{ db, conn }`. `connectBrowser(duckdb, bundles)` is that boot for a browser app, with the
// duckdb-wasm module passed in (a peer dependency, never imported at run time here).
import { DataType, tableFromArrays, tableToIPC } from 'apache-arrow'
import type * as duckdbWasm from '@duckdb/duckdb-wasm'
import type { MaskCell } from './mask.js'
import { render } from './sql.js'
import type { Params } from './sql.js'

// ---- the database it runs on ----

/** the slice of a DuckDB-WASM database the engine uses: `AsyncDuckDB` in a browser, the node-blocking bindings in tests */
export interface DuckDbLike {
  registerFileBuffer(name: string, buf: Uint8Array): unknown
  copyFileToBuffer(name: string): Uint8Array | Promise<Uint8Array>
  dropFile(name: string): unknown
}
/** the slice of a connection the engine uses: `AsyncDuckDBConnection`, or the blocking `DuckDBConnection` */
export interface DuckConnLike {
  /** an Arrow table (or a promise of one): iterable rows, `schema.fields`, `numRows` */
  query(sql: string): any
  insertArrowFromIPCStream(buf: Uint8Array, opts: { name: string; create?: boolean }): unknown
}
export interface Duck { db: DuckDbLike; conn: DuckConnLike }

/**
 * The browser boot erddap-places' engine did itself: pick the bundle (eh or mvp), start its Web Worker, instantiate,
 * connect. `duckdb` is the app's `import * as duckdb from '@duckdb/duckdb-wasm'`, `bundles` the module and worker
 * URLs it serves (see the README, "Worker setup").
 */
export async function connectBrowser(duckdb: typeof duckdbWasm, bundles: duckdbWasm.DuckDBBundles,
                                     logger: duckdbWasm.Logger = new duckdb.VoidLogger()): Promise<Duck> {
  const bundle = await duckdb.selectBundle(bundles)
  const worker = new Worker(bundle.mainWorker!)
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  return { db, conn: await db.connect() }
}

// ---- rows ----
export type Row = Record<string, any>
/**
 * an Arrow result as plain rows: BIGINT as a number, and DECIMAL scaled. DuckDB-WASM hands a DECIMAL back as its
 * unscaled integer (`1.0 AS weight` in points_tabledap.sql arrived as 10, a `VALUES (20.05, ...)` latitude as 2005);
 * erddap-places' toRows passed it through, which no ERDDAP slab (float axes, float values) ever exercised.
 */
export function toRows(t: any): Row[] {
  const cols: string[] = t.schema.fields.map((f: any) => f.name)
  const scale: number[] = t.schema.fields.map((f: any) => (DataType.isDecimal(f.type) ? 10 ** f.type.scale : 0))
  const out: Row[] = []
  for (const r of t) {
    const o: Row = {}
    cols.forEach((c, i) => {
      const v = r[c]
      o[c] = typeof v === 'bigint' ? Number(v) : scale[i] && v !== null && v !== undefined ? Number(v) / scale[i] : v
    })
    out.push(o)
  }
  return out
}

export interface EngineEvent { name: string; ms: number; note?: string }

const now = () => (globalThis.performance ?? Date).now()

export class Engine {
  db!: DuckDbLike
  conn!: DuckConnLike
  ready: Promise<void>
  marks: EngineEvent[] = []
  lastSql = ''
  private q: Promise<any> = Promise.resolve() // one connection: serialize everything

  /** `connect` runs at once (construct the engine when the app first needs it) */
  constructor(connect: () => Promise<Duck> | Duck) { this.ready = this.init(connect) }
  private mark(name: string, ms: number, note?: string) { this.marks.push({ name, ms: Math.round(ms), note }) }

  private async init(connect: () => Promise<Duck> | Duck) {
    const t = now()
    const { db, conn } = await connect()
    this.db = db
    this.conn = conn
    this.mark('connect', now() - t)
  }

  /** register an already-fetched slab (parquet bytes) under a virtual file name. */
  async registerBuffer(name: string, buf: Uint8Array) {
    const run = async () => {
      await this.ready
      const t = now()
      await this.db.registerFileBuffer(name, buf)
      this.mark(`register:${name}`, now() - t, `${(buf.byteLength / 1e3).toFixed(0)} kB`)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /** forget a registered file (a slab whose statistics are done). */
  async dropFile(name: string) {
    const run = async () => {
      await this.ready
      await this.db.dropFile(name)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /** the gridMask cells as a DuckDB table (via Arrow IPC, so no giant VALUES list). */
  async insertMask(cells: MaskCell[], table = 'mask') {
    const run = async () => {
      await this.ready
      const t = now()
      const arrow = tableFromArrays({
        latitude : Float64Array.from(cells.map((c) => c.lat)),
        longitude: Float64Array.from(cells.map((c) => c.lon)),
        weight   : Float64Array.from(cells.map((c) => c.weight)),
      })
      await this.conn.query(`DROP TABLE IF EXISTS ${table}`)
      await this.conn.insertArrowFromIPCStream(tableToIPC(arrow, 'stream'), { name: table, create: true })
      this.mark(`mask:${table}`, now() - t, `${cells.length} cells`)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /** rows from a non-Parquet slab (.csvp / .jsonp) as a table, so the same SQL works on them. */
  async insertRows(rows: Record<string, unknown>[], table: string) {
    const run = async () => {
      await this.ready
      const t = now()
      const cols = Object.keys(rows[0] ?? {})
      const arrays: Record<string, any> = {}
      for (const c of cols) {
        const vals = rows.map((r) => r[c])
        arrays[c] = vals.every((v) => typeof v === 'number' || v === null)
          ? Float64Array.from(vals.map((v) => (v === null ? NaN : (v as number))))
          : vals.map((v) => (v === null || v === undefined ? null : String(v)))
      }
      await this.conn.query(`DROP TABLE IF EXISTS ${table}`)
      await this.conn.insertArrowFromIPCStream(tableToIPC(tableFromArrays(arrays), 'stream'), { name: table, create: true })
      this.mark(`rows:${table}`, now() - t, `${rows.length} rows`)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  exec(sql: string, label = 'exec'): Promise<Row[]> {
    const run = async () => {
      await this.ready
      const t = now()
      this.lastSql = sql
      const res = await this.conn.query(sql)
      this.mark(`query:${label}`, now() - t, `${res.numRows} rows`)
      return toRows(res)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /**
   * The result table as Parquet bytes, written by DuckDB itself.
   *
   * The rows go back into a temporary table (Arrow IPC, as the mask does), `COPY … TO` writes a
   * Parquet file into the WASM filesystem and `copyFileToBuffer` hands it back. Going through the
   * rows rather than re-running the statistics keeps the download identical to what is on screen,
   * whatever has happened to the registered slab since.
   */
  async toParquet(rows: Record<string, unknown>[], table = '_export', file = 'export.parquet'): Promise<Uint8Array> {
    if (!rows.length) throw new Error('nothing to export')
    await this.insertRows(rows, table)
    const run = async () => {
      await this.ready
      const t = now()
      await this.conn.query(`COPY (SELECT * FROM ${table}) TO '${file}' (FORMAT PARQUET)`)
      const buf = await this.db.copyFileToBuffer(file)
      await Promise.resolve(this.db.dropFile(file)).catch(() => {})
      await this.conn.query(`DROP TABLE IF EXISTS ${table}`)
      this.mark(`parquet:${file}`, now() - t, `${rows.length} rows, ${(buf.byteLength / 1e3).toFixed(0)} kB`)
      return buf
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /** render a `sql/<name>.sql` template with {{params}} and run it. */
  runTemplate(name: string, params: Params): Promise<Row[]> { return this.exec(render(name, params), name) }
}
