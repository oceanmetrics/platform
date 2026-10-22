// ERDDAP griddap client. no proxy of ours in the path: the browser talks to the ERDDAP server.
//
// URL shape (griddap): {base}/griddap/{dataset}.{fmt}?{var}[(t0):1:(t1)][(lat0):1:(lat1)][(lon0):1:(lon1)]
// each constraint's square brackets are percent-encoded (%5B / %5D); the rest of the query is left
// literal, because ERDDAP will not accept a fully encoded query string. constraint values go in the
// axis's own direction (latitude descends on the CRW grid, so [(22.4):1:(18.8)]). a 4-D grid
// (time, depth, latitude, longitude) gets one more constraint, a single depth level, after time.

import { fetchRetry, type RetryOpts } from './fetchRetry.js'

export type Format = 'parquet' | 'parquetWMeta' | 'csvp' | 'jsonp'
/** the two Parquet rungs are handled identically once the bytes are in hand. */
export const isParquet = (f: Format) => f === 'parquet' || f === 'parquetWMeta'

export interface ErddapMeta { version?: string; cors?: boolean; formats?: string[] }
export interface Collection { erddap: ErddapMeta }

export interface GriddapSpec {
  base          : string
  datasetId     : string
  variable      : string
  time          : [string, string]
  lat           : [number, number]  // [min, max], any order; reordered per latDescending
  lon           : [number, number]
  latDescending?: boolean
  /** a depth axis between time and latitude (CMEMS): the single level to slice, e.g. 0.494 (surface) */
  depth        ?: number
  format        ?: Format
  callback      ?: string           // jsonp only
}

const enc = (s: string) => s.replace(/\[/g, '%5B').replace(/\]/g, '%5D')
const stripSlash = (s: string) => s.replace(/\/+$/, '')
/** one axis constraint, `[(lo):1:(hi)]` with the brackets encoded. */
export function constraint(lo: string | number, hi: string | number, stride = 1): string {
  return enc(`[(${lo}):${stride}:(${hi})]`)
}
/** an ISO instant at 12:00Z for a Date or a yyyy-mm-dd string (ERDDAP daily grids sit at noon). */
export function noonZ(d: Date | string): string {
  const iso = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
  return `${iso}T12:00:00Z`
}

const EXT: Record<Format, string> = {
  parquet: '.parquet', parquetWMeta: '.parquetWMeta', csvp: '.csvp', jsonp: '.json',
}

/** the griddap request URL for one lobe. */
export function griddapUrl(s: GriddapSpec): string {
  const fmt  = s.format ?? 'parquet'
  const desc = s.latDescending ?? true
  const [y0, y1] = [Math.min(...s.lat), Math.max(...s.lat)]
  const [x0, x1] = [Math.min(...s.lon), Math.max(...s.lon)]
  const q =
    s.variable +
    constraint(s.time[0], s.time[1]) +
    (s.depth != null && Number.isFinite(s.depth) ? constraint(s.depth, s.depth) : '') +
    (desc ? constraint(y1, y0) : constraint(y0, y1)) +
    constraint(x0, x1)
  const tail = fmt === 'jsonp' ? `&.jsonp=${s.callback ?? 'erddapCb'}` : ''
  return `${stripSlash(s.base)}/griddap/${s.datasetId}${EXT[fmt]}?${q}${tail}`
}

/**
 * the griddap URL for ONE time step (`[(t):1:(t)]`), for the map when the statistics come from the
 * precomputed file: the same axis order, longitude range and depth as griddapUrl(), but a single step
 * (`at` is the ISO instant of that step, e.g. the dataset's last time).
 */
export function griddapSliceUrl(s: Omit<GriddapSpec, 'time'> & { at: string }): string {
  const { at, ...rest } = s
  return griddapUrl({ ...rest, time: [at, at] })
}

/** one URL per polygon lobe (bbox = [lonMin, latMin, lonMax, latMax]). */
export function griddapUrls(s: Omit<GriddapSpec, 'lat' | 'lon'>, bboxes: Array<[number, number, number, number]>): string[] {
  return bboxes.map((b) => griddapUrl({ ...s, lon: [b[0], b[2]], lat: [b[1], b[3]] }))
}

// ── tabledap ──────────────────────────────────────────────────────────────────
// URL shape: {base}/tabledap/{dataset}.{fmt}?{col},{col},…&{col}{op}{value}&…
// the column list is comma-separated and ERDDAP wants the commas percent-encoded (%2C); each
// constraint's operator is encoded too (%3E= / %3C= / %3D), and the values are left literal, which
// is what an ERDDAP 2.30 server accepts (verified against erddap.calcofi.io).

export type TableOp = '>=' | '<=' | '>' | '<' | '=' | '!=' | '=~'
export interface TableConstraint { column: string; op: TableOp; value: string | number }
export interface TabledapSpec {
  base       : string
  datasetId  : string
  columns    : string[]
  constraints?: TableConstraint[]
  format    ?: Format
  callback  ?: string
  /** extra server-side functions, e.g. `distinct()` or `orderByMax("time")`, appended literally. */
  functions ?: string[]
}

// only the comparison characters are encoded; `=` stays literal, as ERDDAP's own example URLs do
const OPS: Record<TableOp, string> = {
  '>=': '%3E=', '<=': '%3C=', '>': '%3E', '<': '%3C', '=': '=', '!=': '!=', '=~': '=~',
}
/** one tabledap constraint, `column%3E=value`. */
export function tableConstraint(c: TableConstraint): string {
  return `${c.column}${OPS[c.op] ?? c.op}${c.value}`
}

/** the tabledap request URL: the encoded column list, then one `&constraint` each. */
export function tabledapUrl(s: TabledapSpec): string {
  const fmt = s.format ?? 'parquetWMeta'
  const q = [
    s.columns.join('%2C'),
    ...(s.constraints ?? []).map(tableConstraint),
    ...(s.functions ?? []),
  ]
  const tail = fmt === 'jsonp' ? `&.jsonp=${s.callback ?? 'erddapCb'}` : ''
  return `${stripSlash(s.base)}/tabledap/${s.datasetId}${EXT[fmt]}?${q.join('&')}${tail}`
}

/**
 * The constraints for one place lobe and one time window: a bbox and a half-open-ish time range,
 * plus the long-format row filter when the dataset keeps its variables in a `measurement_type`
 * column (`erddap-places:long_format` in the STAC Collection).
 */
export function tabledapPlaceConstraints(o: {
  bbox: [number, number, number, number]   // [lonMin, latMin, lonMax, latMax]
  from: string                              // yyyy-mm-dd or an ISO instant
  to  : string
  typeColumn?: string
  typeValue ?: string
}): TableConstraint[] {
  const iso = (d: string, end = false) => (d.length > 10 ? d : `${d}T${end ? '23:59:59' : '00:00:00'}Z`)
  const cs: TableConstraint[] = [
    { column: 'time',      op: '>=', value: iso(o.from) },
    { column: 'time',      op: '<=', value: iso(o.to, true) },
    { column: 'longitude', op: '>=', value: o.bbox[0] },
    { column: 'longitude', op: '<=', value: o.bbox[2] },
    { column: 'latitude',  op: '>=', value: o.bbox[1] },
    { column: 'latitude',  op: '<=', value: o.bbox[3] },
  ]
  // a string value is quoted, and the quotes percent-encoded (%22), as ERDDAP requires
  if (o.typeColumn && o.typeValue) cs.push({ column: o.typeColumn, op: '=', value: `%22${o.typeValue}%22` })
  return cs
}

// ── axis vectors ──────────────────────────────────────────────────────────────
/**
 * per-attempt timeout of an axis request. small, but a busy server is slow whatever the size: PacIOOS answered
 * `dhw_5km` latitude requests in 13–19 s on 2026-10-20, past the old 15 s, so a live run failed while the server
 * was up ("did not answer (no response within 15 s, 2 tries)").
 */
export const AXIS_TIMEOUT_MS = 45_000
/** per-attempt timeout of the map's one-step slice: as small, and as slow on a busy server (PacIOOS took 27–31 s for 45 days of one pixel) */
export const SLICE_TIMEOUT_MS = 45_000

/**
 * `dataset.json?latitude[(min):1:(max)]` -> the axis values, in the server's own order. `AXIS_TIMEOUT_MS` per
 * attempt and one retry by default (`retry` overrides them; the precompute waits longer).
 */
export async function fetchAxis(base: string, datasetId: string, axis: string, min: number, max: number, descending = false,
                                signal?: AbortSignal, retry: Omit<RetryOpts, 'signal'> = {}): Promise<number[]> {
  const c   = descending ? constraint(max, min) : constraint(min, max)
  const url = `${stripSlash(base)}/griddap/${datasetId}.json?${axis}${c}`
  return fetchRetry(url, { timeoutMs: AXIS_TIMEOUT_MS, ...retry, signal }, async (res) => {
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
    const j: { table: { columnNames: string[]; rows: number[][] } } = await res.json()
    return j.table.rows.map((r) => Number(r[0]))
  })
}

// ── format rung ───────────────────────────────────────────────────────────────
/**
 * Best format this server can serve us: Parquet -> CSV (`.csvp`) -> JSONP.
 * CORS off means only JSONP (a `<script>` tag is not subject to CORS).
 */
export function pickFormat(collection: Collection): Format {
  const e    = collection?.erddap ?? {}
  const fmts = (e.formats ?? []).map((f) => f.replace(/^\./, '').toLowerCase())
  if (e.cors === false) return 'jsonp'
  if (fmts.length === 0) return 'parquet'
  // parquetWMeta is plain Parquet with ERDDAP's metadata in the file footer: prefer it when offered
  if (fmts.includes('parquetwmeta')) return 'parquetWMeta'
  if (fmts.includes('parquet')) return 'parquet'
  if (fmts.includes('csvp') || fmts.includes('csv')) return 'csvp'
  return 'jsonp'
}

// ── fetch ─────────────────────────────────────────────────────────────────────
export interface Slab {
  url    : string
  format : Format
  ms     : number
  bytes ?: number
  buffer?: Uint8Array                    // parquet
  rows  ?: Record<string, unknown>[]     // csvp / jsonp
  text  ?: string                        // csvp, raw
}

/** load a `.json?...&.jsonp=cb` URL through a <script> tag (browser only; no CORS needed). */
export function fetchJsonp(url: string, cbName: string, timeoutMs = 120_000, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('jsonp needs a browser document'))
    const done = (fn: () => void) => { clearTimeout(timer); delete (window as any)[cbName]; script.remove(); fn() }
    const timer = setTimeout(() => done(() => reject(new Error(`jsonp timeout: ${url}`))), timeoutMs)
    ;(window as any)[cbName] = (data: any) => done(() => resolve(data))
    // a <script> tag cannot be cancelled, but a superseded run must stop waiting on it
    signal?.addEventListener('abort', () => done(() => reject(new DOMException('aborted', 'AbortError'))), { once: true })
    const script  = document.createElement('script')
    script.src    = url
    script.onerror = () => done(() => reject(new Error(`jsonp failed: ${url}`)))
    document.head.appendChild(script)
  })
}

/** `{table:{columnNames, rows}}` -> array of objects. */
export function tableToRows(t: { table: { columnNames: string[]; rows: unknown[][] } }): Record<string, unknown>[] {
  const { columnNames, rows } = t.table
  return rows.map((r) => Object.fromEntries(columnNames.map((c, i) => [c, r[i]])))
}

/** minimal CSV parse for `.csvp` (ERDDAP quotes with " and doubles inner quotes). */
export function parseCsvp(text: string): Record<string, unknown>[] {
  const lines = text.split('\n').filter((l) => l.length)
  if (!lines.length) return []
  const split = (l: string) => {
    const out: string[] = []; let cur = '', q = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
      else if (ch === '"') q = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else if (ch !== '\r') cur += ch
    }
    out.push(cur); return out
  }
  const head = split(lines[0]).map((h) => h.replace(/\s*\(.*\)$/, '')) // strip the " (degree_C)" units suffix
  return lines.slice(1).map((l) => {
    const f = split(l)
    return Object.fromEntries(head.map((h, i) => {
      const v = f[i]
      const n = v === '' || v === 'NaN' ? null : Number(v)
      return [h, n === null || Number.isNaN(n) ? v : n]
    }))
  })
}

/**
 * fetch one slab in the given format. Parquet comes back as bytes for `registerFileBuffer`. `retry`
 * sets the per-attempt timeout and the tries (fetchRetry: 20 s and one retry unless the caller says
 * otherwise: a whole live window can take longer than the one-step map slice).
 */
export async function fetchSlab(url: string, format: Format = 'parquet', callback = 'erddapCb', signal?: AbortSignal,
                                retry: Omit<RetryOpts, 'signal'> = {}): Promise<Slab> {
  const t0 = (globalThis.performance ?? Date).now()
  if (format === 'jsonp') {
    const data = await fetchJsonp(url, callback, retry.timeoutMs ?? 120_000, signal)
    return { url, format, ms: (globalThis.performance ?? Date).now() - t0, rows: tableToRows(data) }
  }
  return fetchRetry(url, { ...retry, signal }, async (res): Promise<Slab> => {
    if (!res.ok) {
      const msg = (await res.text().catch(() => '')).slice(0, 400)
      throw new Error(`${res.status} ${res.statusText} from ERDDAP: ${msg}`)
    }
    if (format === 'csvp') {
      const text = await res.text()
      return { url, format, ms: (globalThis.performance ?? Date).now() - t0, bytes: text.length, text, rows: parseCsvp(text) }
    }
    // parquet and parquetWMeta alike: raw bytes for registerFileBuffer
    const buffer = new Uint8Array(await res.arrayBuffer())
    return { url, format, ms: (globalThis.performance ?? Date).now() - t0, bytes: buffer.byteLength, buffer }
  })
}
