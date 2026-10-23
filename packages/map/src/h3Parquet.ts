// the release provider: tiles built from the obis-h3 release's own Parquet inside MapLibre's worker (decision D4 of the
// week 4 plan: no prebuilt archives; the release already is a pyramid by resolution and parent, and its metrics do not
// roll up). for a tile at zoom z (h3ReleaseLayer.ts releaseFile):
//   1. the resolution and its file: the pin or the ladder's resolution for z;
//   2. the cells under the tile: tileParents at a resolution two coarser (the bbox grown by its margins, the strip
//      across ±180), each parent turned into the cell_id range of its children by bit arithmetic (h3Bits.ts);
//   3. the row groups whose cell_id statistics meet a range, and only those, read with hyparquet (column projection:
//      the id and the indicator columns; the h3 string column is not read, the id gives it), each row group cached in
//      the worker (LRU by decoded bytes), so the next tile in the same group, and an indicator switch, fetch nothing;
//   4. the rows in the ranges, every indicator column carried (multi-indicator tiles), handed to the h3j tile builder
//      (h3Tiles.ts: the PR 211 unwrap, geojson-vt tolerance 0, vt-pbf).
// at a split resolution (h3:layout.parent_res) it reads the files of the parents under the tile instead, and when none
// of them is there it tries the whole file once per layer and resolution (a small layer is left whole).
// a file the release does not have (403/404) is no cells, remembered.
import { parquetMetadataAsync, parquetRead } from 'hyparquet'
import type { FileMetaData } from 'hyparquet'
import { cellIdOf, childRange, h3OfCellId, mergeRanges, inRanges, overlapsRanges, parentId } from './h3Bits.js'
import { tileParents, zoomToRes } from './h3Index.js'
import type { H3Rows } from './h3Index.js'
import { releaseFile } from './h3ReleaseLayer.js'
import type { H3ReleaseLayer } from './h3ReleaseLayer.js'
import type { TileProvider } from './h3Tiles.js'
import { COMPRESSORS, DEFAULT_TAIL, newReadStats, openRangeFile } from './parquetFile.js'
import type { RangeFile, ReadStats } from './parquetFile.js'

type Range = [bigint, bigint]

/** one row group decoded: the ids and the value columns (NaN for a missing value) */
interface GroupData {
  ids: bigint[]
  columns: Record<string, Float64Array>
  bytes: number
}

interface OpenFile {
  file: RangeFile
  metadata: FileMetaData
  /** the first row of each group, and its row count */
  starts: number[]
  rows: number[]
  /** the schema's column names */
  names: Set<string>
}

export interface ReleaseReaderOptions {
  fetch?: typeof fetch
  /** the suffix read first per file (the footer); default 64 KiB */
  tail?: number
  /** the decoded row groups kept, in bytes; default 64 MB */
  maxBytes?: number
}

const toBig = (v: unknown, idType: 'int64' | 'string'): bigint | null =>
  v == null ? null : idType === 'string' ? cellIdOf(String(v)) : typeof v === 'bigint' ? v : BigInt(v as number)

/** the reader of one worker: files opened once, row groups cached across tiles, layers and periods */
export class ReleaseReader {
  readonly stats: ReadStats = newReadStats()
  /** row groups read, and row groups skipped by their statistics */
  groupsRead = 0
  groupsSkipped = 0
  private readonly files = new Map<string, Promise<OpenFile | null>>()
  private readonly groups = new Map<string, Promise<GroupData>>()
  private readonly sizes = new Map<string, number>()
  private bytes = 0
  /** per split resolution template: whether its layer is split ('split') or one whole file ('whole') */
  readonly modes = new Map<string, 'split' | 'whole'>()

  constructor(private readonly opts: ReleaseReaderOptions = {}) {}

  /** the file and its footer, once; null when the release has no such file */
  open(url: string): Promise<OpenFile | null> {
    let p = this.files.get(url)
    if (!p) {
      p = (async () => {
        const tail = this.opts.tail ?? DEFAULT_TAIL
        const file = await openRangeFile(url, { fetch: this.opts.fetch, tail, stats: this.stats })
        if (!file) return null
        const metadata = await parquetMetadataAsync(file, { initialFetchSize: Math.min(tail, file.byteLength), geoparquet: false })
        const starts: number[] = [], rows: number[] = []
        let at = 0
        for (const g of metadata.row_groups) { starts.push(at); rows.push(Number(g.num_rows)); at += Number(g.num_rows) }
        return { file, metadata, starts, rows, names: new Set(metadata.schema.slice(1).map((s) => s.name)) }
      })()
      p.catch(() => this.files.delete(url))
      this.files.set(url, p)
    }
    return p
  }

  /** the row groups of a file whose id statistics meet the ranges (a group without statistics is always read) */
  groupsFor(f: OpenFile, id: string, idType: 'int64' | 'string', ranges: readonly Range[]): number[] {
    const out: number[] = []
    f.metadata.row_groups.forEach((g, i) => {
      const chunk = g.columns.find((c) => c.meta_data?.path_in_schema[0] === id)
      const st = chunk?.meta_data?.statistics
      const lo = toBig(st?.min_value ?? st?.min, idType), hi = toBig(st?.max_value ?? st?.max, idType)
      if (lo == null || hi == null || overlapsRanges(lo, hi, ranges)) out.push(i)
      else this.groupsSkipped++
    })
    return out
  }

  /** one row group's ids and columns, read once and kept while the cache has room */
  group(url: string, f: OpenFile, g: number, id: string, idType: 'int64' | 'string', columns: string[]): Promise<GroupData> {
    const key = `${url}#${g}#${columns.join(',')}`
    let p = this.groups.get(key)
    if (p) {
      // refresh its place in the LRU
      this.groups.delete(key); this.groups.set(key, p)
      return p
    }
    p = this.readGroup(f, g, id, idType, columns.filter((c) => f.names.has(c)))
    this.groups.set(key, p)
    p.then((d) => {
      if (!this.groups.has(key)) return
      this.sizes.set(key, d.bytes)
      this.bytes += d.bytes
      this.evict()
    }, () => this.groups.delete(key))
    return p
  }

  private evict(): void {
    const max = this.opts.maxBytes ?? 64e6
    for (const key of this.groups.keys()) {
      if (this.bytes <= max) break
      const b = this.sizes.get(key)
      if (b == null) continue
      this.groups.delete(key); this.sizes.delete(key)
      this.bytes -= b
    }
  }

  private async readGroup(f: OpenFile, g: number, id: string, idType: 'int64' | 'string', columns: string[]): Promise<GroupData> {
    this.groupsRead++
    const start = f.starts[g], n = f.rows[g]
    const raw: Record<string, unknown[]> = {}
    await parquetRead({
      file: f.file, metadata: f.metadata, columns: [id, ...columns], rowStart: start, rowEnd: start + n,
      compressors: COMPRESSORS, utf8: true,
      onChunk: ({ columnName, columnData, rowStart }) => {
        const a = (raw[columnName] ??= new Array(n))
        const off = rowStart - start
        for (let i = 0; i < columnData.length; i++) if (off + i >= 0 && off + i < n) a[off + i] = columnData[i]
      },
    })
    const ids = (raw[id] ?? []).map((v) => toBig(v, idType) ?? -1n)
    const out: Record<string, Float64Array> = {}
    for (const c of columns) {
      const src = raw[c] ?? [], dst = new Float64Array(n)
      for (let i = 0; i < n; i++) { const v = src[i]; dst[i] = v == null ? NaN : Number(v) }
      out[c] = dst
    }
    return { ids, columns: out, bytes: n * (16 + 8 * columns.length) }
  }

  /** the rows of a file whose id lies in the ranges, every column carried; null when the file is not there */
  async rows(url: string, ranges: readonly Range[], l: Pick<H3ReleaseLayer, 'id' | 'idType' | 'columns'>): Promise<H3Rows | null> {
    const f = await this.open(url)
    if (!f) return null
    const columns = l.columns.filter((c) => f.names.has(c))
    const groups = await Promise.all(this.groupsFor(f, l.id, l.idType, ranges).map((g) => this.group(url, f, g, l.id, l.idType, columns)))
    const h3: string[] = [], keep: [GroupData, number][] = []
    for (const d of groups) for (let i = 0; i < d.ids.length; i++) if (inRanges(d.ids[i], ranges)) { h3.push(h3OfCellId(d.ids[i])); keep.push([d, i]) }
    const out: Record<string, Float64Array> = {}
    for (const c of columns) {
      const a = new Float64Array(keep.length)
      for (let k = 0; k < keep.length; k++) a[k] = keep[k][0].columns[c][keep[k][1]]
      out[c] = a
    }
    return { h3, columns: out }
  }
}

/** concatenate tables of the same columns */
function concatRows(parts: (H3Rows | null)[], columns: string[]): H3Rows {
  const got = parts.filter((p): p is H3Rows => !!p && p.h3.length > 0)
  if (got.length === 1) return got[0]
  const h3 = got.flatMap((p) => p.h3)
  const out: Record<string, Float64Array> = {}
  for (const c of columns) {
    const a = new Float64Array(h3.length).fill(NaN)
    let at = 0
    for (const p of got) { if (p.columns[c]) a.set(p.columns[c] as Float64Array, at); at += p.h3.length }
    out[c] = a
  }
  return { h3, columns: out }
}

/** the cell_id ranges at `res` under tile z/x/y: tileParents at a resolution two coarser (never coarser than the view's
 * own minus two, so a pinned fine resolution at a low zoom asks few parents), each parent's children's range */
export function tileRanges(z: number, x: number, y: number, res: number, parentRes?: number): { parents: Set<string>; ranges: Range[] } {
  const q = parentRes ?? Math.max(0, Math.min(res, zoomToRes(Math.floor(z))) - 2)
  const parents = tileParents(z, x, y, res, q)
  return { parents, ranges: mergeRanges([...parents].map((p) => childRange(cellIdOf(p), res))) }
}

/** the tile provider over one release layer (h3ReleaseLayer.ts); one reader per worker shares its cache across layers */
export function releaseProvider(l: H3ReleaseLayer, reader: ReleaseReader = new ReleaseReader()): TileProvider {
  return async (z, x, y, signal) => {
    const file = releaseFile(l, z)
    let rows: H3Rows | null
    if (!file.split) {
      rows = await reader.rows(file.url, tileRanges(z, x, y, file.res).ranges, l)
    } else {
      const mode = reader.modes.get(file.url)
      if (mode === 'whole') rows = await reader.rows(file.url, tileRanges(z, x, y, file.res).ranges, l)
      else {
        // the fine ranges, grouped by the parent file they lie in
        const { split } = file
        const { parents, ranges } = tileRanges(z, x, y, file.res, Math.max(split.parentRes, Math.min(file.res, zoomToRes(Math.floor(z))) - 2))
        const byFile = new Map<string, Range[]>()
        for (const p of parents) {
          const top = h3OfCellId(parentId(cellIdOf(p), split.parentRes))
          if (!byFile.has(top)) byFile.set(top, [])
        }
        for (const top of byFile.keys()) {
          const [lo, hi] = childRange(cellIdOf(top), file.res)
          byFile.set(top, ranges.filter((r) => r[1] >= lo && r[0] <= hi))
        }
        const parts = await Promise.all([...byFile].map(([top, rs]) => reader.rows(split.url(top), rs, l)))
        if (parts.some((p) => p)) { reader.modes.set(file.url, 'split'); rows = concatRows(parts, l.columns) }
        else if (mode == null) {
          rows = await reader.rows(file.url, ranges, l)
          reader.modes.set(file.url, rows ? 'whole' : 'split')
        } else rows = null
      }
    }
    if (signal.aborted) return null
    return rows && rows.h3.length ? rows : null
  }
}
