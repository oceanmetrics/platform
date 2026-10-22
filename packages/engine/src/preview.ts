// the live preview: a series for any polygon x ERDDAP grid, in the browser, with the precompute's own chunking. a long
// window is a chain of griddap requests (at most 90 steps and 100,000 values each, `chunkDaysFor`), and each chunk's
// statistics are handed to the caller as they land, oldest first, so a chart draws while the rest is still coming.
// the per-lobe masking (the 0..360 shift included) is the precompute's `maskLobe` and the App's run(); the slab of a
// chunk is `(SELECT DISTINCT * FROM read_parquet([...one file per lobe]))` and the SQL is `stats_daily` or
// `stats_categorical`, exactly as `precompute/src/stats.ts` `computeOne` runs them. `sliceSource` is the map's half: one
// step's `last_step` rows for `@oceanmetrics/map`'s grid slot.
import { chunkDaysFor, chunks, type ChunkLimits } from './chunks.js'
import { lobeLonSpan, statsTemplate, toDatasetLon, valueExpr, type CubeVariable, type Dataset } from './dataset.js'
import type { Engine, Row } from './engine.js'
import { AXIS_TIMEOUT_MS, SLICE_TIMEOUT_MS, fetchAxis, fetchSlab, griddapSliceUrl, griddapUrl, isParquet, noonZ, type Format } from './erddap.js'
import { timeInstant, type TimeExtent } from './extent.js'
import type { RetryOpts } from './fetchRetry.js'
import type { Lobe } from './lobes.js'
import { gridMask, type MaskCell } from './mask.js'

/** what a preview reads of a dataset (a `toDataset()` result has all of it) */
export type PreviewDataset = Pick<Dataset, 'baseUrl' | 'datasetId' | 'latDescending' | 'lonRange'> &
  Partial<Pick<Dataset, 'depth' | 'protocol'>> & { format?: Format }

/** one lobe's axis vectors as the server returns them: its own order, its own longitude frame */
export interface LobeAxes { lon: number[]; lat: number[] }

type FetchFn = typeof fetch

// ---- the chunk rule ----

/**
 * Days per request for a window over `cells` axis cells per step (the largest lobe's lon x lat) of a grid whose step
 * is `stepDays`: the precompute's `chunkDaysFor`, at most `maxDays` steps and `maxValues` values a request.
 */
export function previewWindow(cells: number, stepDays = 1, { maxValues = 100_000, maxDays = 90 }: ChunkLimits = {}): number {
  return chunkDaysFor(cells, stepDays, { maxValues, maxDays })
}

// ---- the mask ----

/**
 * The mask of every lobe on its axes, in the dataset's own longitude frame (a 0..360 grid's axis goes to the polygon's
 * -180..180 for the mask and its cells come back to 0..360, so they join the slab), and the cells per step of the
 * largest lobe (what sets the chunk size).
 */
export function lobeMasks(dataset: Pick<Dataset, 'lonRange'>, lobes: Lobe[], axes: LobeAxes[]): { cells: MaskCell[]; cellsPerStep: number } {
  if (lobes.length !== axes.length) throw new Error(`lobeMasks: ${lobes.length} lobe(s) but ${axes.length} axis pair(s)`)
  const shifted = dataset.lonRange[1] > 180
  const toPoly  = (x: number) => (shifted && x > 180 ? x - 360 : x)
  const cells: MaskCell[] = []
  for (const [i, lobe] of lobes.entries()) {
    const m = gridMask(lobe.geojson, axes[i].lon.map(toPoly), axes[i].lat)
    for (const c of m.cells) cells.push(shifted ? { ...c, lon: toDatasetLon(c.lon, dataset.lonRange) } : c)
  }
  return { cells, cellsPerStep: Math.max(0, ...axes.map((a) => a.lon.length * a.lat.length)) }
}

/** each lobe's axis vectors from the server (`fetchAxis`, the lobe's longitude span in the dataset's frame) */
export async function lobeAxes(dataset: Pick<Dataset, 'baseUrl' | 'datasetId' | 'latDescending' | 'lonRange'>, lobes: Lobe[],
                               { fetch: fetchFn, signal, retry = {} }: { fetch?: FetchFn; signal?: AbortSignal; retry?: Omit<RetryOpts, 'signal' | 'fetchFn'> } = {}): Promise<LobeAxes[]> {
  const r = { timeoutMs: AXIS_TIMEOUT_MS, ...retry, ...(fetchFn ? { fetchFn } : {}) }
  return Promise.all(lobes.map(async (lobe) => {
    const [lo, hi] = lobeLonSpan(lobe.bbox, dataset.lonRange)
    const [lon, lat] = await Promise.all([
      fetchAxis(dataset.baseUrl, dataset.datasetId, 'longitude', lo, hi, false, signal, r),
      fetchAxis(dataset.baseUrl, dataset.datasetId, 'latitude', lobe.bbox[1], lobe.bbox[3], dataset.latDescending, signal, r),
    ])
    return { lon, lat }
  }))
}

// ---- shared ----

let seq = 0
const uid = (what: string) => `${what}_${++seq}`
const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError') }

/** a yyyy-mm-dd UTC day from what DuckDB-WASM hands back for a DATE (epoch ms, a Date, or a string) */
export function isoDay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' || typeof v === 'bigint') return new Date(Number(v)).toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

function slabUrl(dataset: PreviewDataset, variable: string, ax: LobeAxes, time: [string, string] | { at: string }): string {
  const grid = {
    base: dataset.baseUrl, datasetId: dataset.datasetId, variable,
    lat : [ax.lat[ax.lat.length - 1], ax.lat[0]] as [number, number], lon: [ax.lon[0], ax.lon[ax.lon.length - 1]] as [number, number],
    latDescending: dataset.latDescending, depth: dataset.depth, format: dataset.format ?? 'parquet',
  }
  return Array.isArray(time) ? griddapUrl({ ...grid, time }) : griddapSliceUrl({ ...grid, at: time.at })
}

function parquetFormat(dataset: PreviewDataset): Format {
  if (dataset.protocol === 'tabledap') throw new Error(`${dataset.datasetId}: the preview is for griddap datasets (tabledap has no lattice)`)
  const f = dataset.format ?? 'parquet'
  if (!isParquet(f)) throw new Error(`${dataset.datasetId}: the preview reads Parquet slabs, and this server offers .${f}`)
  return f
}

/** fetch every lobe's slab for one request, register each under a fresh name; the read_parquet() list of them */
async function loadSlabs(engine: Engine, urls: string[], format: Format, signal: AbortSignal | undefined,
                         retry: Omit<RetryOpts, 'signal'>): Promise<string[]> {
  const slabs = await Promise.all(urls.map((u) => fetchSlab(u, format, undefined, signal, retry)))
  aborted(signal)
  const files: string[] = []
  for (const s of slabs) {
    const f = `${uid('slab')}.parquet`
    await engine.registerBuffer(f, s.buffer!)
    files.push(f)
  }
  return files
}
const readList = (files: string[]) => `read_parquet([${files.map((f) => `'${f}'`).join(', ')}])`

// ---- the preview ----

export interface PreviewChunk {
  /** 0-based, in time order */
  index: number
  count: number
  /** the chunk's first and last day, yyyy-mm-dd */
  start: string
  end  : string
  /** one griddap request per lobe */
  urls : string[]
}

export interface PreviewOptions {
  dataset  : PreviewDataset
  variable : CubeVariable
  /** the place's lobes (`placeLobes`); not needed when `mask` is given */
  lobes   ?: Lobe[]
  /** each lobe's axis vectors (`lobeAxes`, or the provenance's `axes`): they bound the requests and set the chunk size */
  axes     : LobeAxes[]
  /** a mask already computed (`lobeMasks(...).cells`), so a preview and a slice share one masking */
  mask    ?: MaskCell[]
  /** the window, yyyy-mm-dd UTC days, both included */
  t0       : string
  t1       : string
  engine   : Engine
  fetch   ?: FetchFn
  /** the rows of each chunk as it lands, in time order; a date already given by an earlier chunk is not repeated */
  onChunk ?: (rows: Row[], chunk: PreviewChunk) => void
  signal  ?: AbortSignal
  /** the live extent: its step sets the chunk days, its endpoints the exact instants of the first and last request */
  extent  ?: TimeExtent | null
  /** the grid's step in days when there is no extent (default 1) */
  stepDays?: number
  limits  ?: ChunkLimits
  /** requests in flight: the next chunk is fetched while this one is aggregated (default 2, the precompute's CONCURRENCY) */
  concurrency?: number
  retry   ?: Omit<RetryOpts, 'signal' | 'fetchFn'>
}

export interface PreviewResult {
  /** every chunk's rows, in time order, `date` as yyyy-mm-dd */
  rows     : Row[]
  chunks   : PreviewChunk[]
  chunkDays: number
  template : 'stats_daily' | 'stats_categorical'
  maskCells: number
}

/**
 * The statistics of `variable` over the place for [t0, t1], chunk by chunk. Each chunk's slab (one Parquet request per
 * lobe) is registered, aggregated with the template over the mask and dropped; `onChunk` gets its rows as soon as they
 * are computed, in time order. `signal` stops the chain: the in-flight requests are cancelled, nothing after the abort
 * reaches `onChunk`, and the promise rejects with the abort reason. The mask table and the slabs are dropped either way.
 */
export async function runPreview(o: PreviewOptions): Promise<PreviewResult> {
  const { dataset, variable, axes, engine, signal } = o
  const format = parquetFormat(dataset)
  aborted(signal)
  const masked = o.mask
    ? { cells: o.mask, cellsPerStep: Math.max(0, ...axes.map((a) => a.lon.length * a.lat.length)) }
    : lobeMasks(dataset, o.lobes ?? [], axes)
  const name = statsTemplate(variable) as 'stats_daily' | 'stats_categorical'
  const chunkDays = previewWindow(masked.cellsPerStep, o.stepDays ?? o.extent?.stepDays ?? 1, o.limits)
  const at = (d: string) => timeInstant(d, o.extent ?? null, noonZ)
  const list: PreviewChunk[] = chunks(o.t0, o.t1, chunkDays).map(([s, e], index, all) => ({
    index, count: all.length, start: s, end: e,
    urls: axes.map((ax) => slabUrl(dataset, variable.name, ax, [at(s), at(e)])),
  }))
  const result: PreviewResult = { rows: [], chunks: list, chunkDays, template: name, maskCells: masked.cells.length }
  if (!masked.cells.length || !list.length) return result

  const retry = { ...o.retry, ...(o.fetch ? { fetchFn: o.fetch } : {}) }
  const mask = uid('preview_mask')
  const expr = valueExpr(variable)
  const seen = new Set<string>()
  const inFlight: Array<Promise<Array<Awaited<ReturnType<typeof fetchSlab>>>>> = []
  // the fetch half of a chunk: started up to `concurrency` chunks ahead, consumed in order
  const start = (k: number) => {
    if (k < list.length && !inFlight[k]) {
      inFlight[k] = Promise.all(list[k].urls.map((u) => fetchSlab(u, format, undefined, signal, retry)))
      inFlight[k].catch(() => {})        // a later chunk's failure surfaces when it is awaited, or never (after an abort)
    }
  }
  const ahead = Math.max(1, o.concurrency ?? 2)
  try {
    await engine.insertMask(masked.cells, mask)
    for (const chunk of list) {
      for (let k = chunk.index; k < chunk.index + ahead; k++) start(k)
      const slabs = await inFlight[chunk.index]
      aborted(signal)
      const files: string[] = []
      try {
        for (const s of slabs) { const f = `${uid('slab')}.parquet`; await engine.registerBuffer(f, s.buffer!); files.push(f) }
        // DISTINCT: a coarse axis (the 8-day grid) can snap a chunk's two endpoints onto one step
        const slab = `(SELECT DISTINCT * FROM ${readList(files)})`
        const out  = await engine.runTemplate(name, { expr, slab, mask })
        aborted(signal)
        // two chunks snapped onto the same step of a coarse axis give that step twice, identical: keep the first
        const rows = out.map((r) => ({ ...r, date: isoDay(r.date) })).filter((r) => !seen.has(r.date))
        for (const r of rows) seen.add(r.date)
        result.rows.push(...rows)
        o.onChunk?.(rows, chunk)
      } finally {
        for (const f of files) await engine.dropFile(f).catch(() => {})
      }
    }
  } finally {
    await engine.exec(`DROP TABLE IF EXISTS ${mask}`, 'drop').catch(() => {})
  }
  return result
}

// ---- the map's slice ----

/** one cell of a step, as `@oceanmetrics/map`'s `SliceCell` */
export interface SliceCell { lat: number; lon: number; value: number | null; weight: number }
/** `@oceanmetrics/map`'s `SliceSource`, structurally: the grid slot's data */
export interface SliceSource { slice(t: string | null, signal?: AbortSignal): Promise<SliceCell[]> }

export interface SliceSourceOptions {
  dataset : PreviewDataset
  variable: CubeVariable
  lobes  ?: Lobe[]
  axes    : LobeAxes[]
  mask   ?: MaskCell[]
  engine  : Engine
  fetch  ?: FetchFn
  /** a null `t` is the extent's last step (ERDDAP's `last` when there is no extent) */
  extent ?: TimeExtent | null
  retry  ?: Omit<RetryOpts, 'signal' | 'fetchFn'>
}

/**
 * A `SliceSource` for the grid slot: `slice(t)` fetches the one step `t` (a yyyy-mm-dd day or an ISO instant; null for
 * the newest) of every lobe and runs `last_step` over the mask: the masked cells with their own lat/lon, the area
 * weight and the value (null where the step has no data). The mask goes into the engine once, at the first slice.
 */
export function sliceSource(o: SliceSourceOptions): SliceSource {
  const format = parquetFormat(o.dataset)
  const cells = o.mask ?? lobeMasks(o.dataset, o.lobes ?? [], o.axes).cells
  const mask = uid('slice_mask')
  let inserted: Promise<void> | null = null
  const retry = { timeoutMs: SLICE_TIMEOUT_MS, ...o.retry, ...(o.fetch ? { fetchFn: o.fetch } : {}) }
  return {
    async slice(t, signal) {
      aborted(signal)
      if (!cells.length) return []
      const at = t === null ? (o.extent ? o.extent.end : 'last')
        : t.length <= 10 ? timeInstant(t, o.extent ?? null, noonZ) : t
      inserted ??= o.engine.insertMask(cells, mask).catch((e) => { inserted = null; throw e })
      const urls = o.axes.map((ax) => slabUrl(o.dataset, o.variable.name, ax, { at }))
      const files = await loadSlabs(o.engine, urls, format, signal, retry)
      try {
        await inserted
        aborted(signal)
        const rows = await o.engine.runTemplate('last_step', { expr: valueExpr(o.variable), slab: readList(files), mask })
        return rows.map((r) => ({
          lat: Number(r.latitude), lon: Number(r.longitude), weight: Number(r.weight),
          value: r.value === null || r.value === undefined ? null : Number(r.value),
        }))
      } finally {
        for (const f of files) await o.engine.dropFile(f).catch(() => {})
      }
    },
  }
}
