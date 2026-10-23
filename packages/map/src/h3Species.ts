// the species of one hexagon from a species table sorted by cell id (the obis-h3 release's `species_flat/res=3.parquet`:
// `h3, cell_id, name_key, aphiaid, n, year_min, year_max`, one row per cell and species): the atlas's Cell pane. the
// file holds every cell of one resolution, so a read must touch only the row groups of the cell asked:
//   - a cell at the file's resolution is one cell id;
//   - a coarser cell is the cell ids of its children at the file's resolution, which are one contiguous range
//     (h3Bits.ts childRange: a parent's children share its base cell and digits, the finer digits run 0 to 6), so in a
//     file sorted by cell_id they are one run of rows, and the row groups whose cell_id statistics meet the range are
//     the only ones read (h3Species.test.ts checks the range against h3-js over every res-3 cell);
//   - a finer cell has no rows of its own: its parent's at the file's resolution are returned, and `scope` says so.
// the rows come back as the file has them (a coarser cell's are its children's, one per child and species: summing
// them is the caller's, as the atlas's sumBySpecies does). the file's footer is read once per reader, so a second
// cell of the same file costs its row groups only.
import { parquetRead } from 'hyparquet'
import { cellIdOf, cellIdRes, childRange, h3OfCellId, parentId } from './h3Bits.js'
import { ReleaseReader } from './h3Parquet.js'
import { COMPRESSORS } from './parquetFile.js'

export interface SpeciesForCellOptions {
  /** the file's resolution (`species_flat/res=3.parquet`: 3) */
  res: number
  /** the cell id column, BIGINT; default `cell_id` */
  id?: string
  /** the columns returned besides the id; default every column but the id and `h3` */
  columns?: string[]
  /** a reader whose open files are kept (the footer read once per file); default a new one */
  reader?: ReleaseReader
  fetch?: typeof fetch
  /** the suffix read first; default 64 KiB. a footer longer than the tail costs a second request (the release's
   * species_flat footer is 245 kB: pass 262,144 to read it in one) */
  tail?: number
}

/** one value of a row: numbers as numbers (an INT64 that fits a double too), strings, null; the id as a bigint */
export type SpeciesValue = number | string | bigint | null

export interface CellSpecies {
  cell: string
  /** the cell's resolution and the file's */
  cellRes: number
  fileRes: number
  /** the rows are the cell's own, its children's at the file's resolution, or its parent's */
  scope: 'cell' | 'children' | 'parent'
  /** the cell ids read (inclusive) */
  range: [bigint, bigint]
  rows: Record<string, SpeciesValue>[]
  /** row groups read, and skipped by their cell_id statistics */
  groupsRead: number
  groupsSkipped: number
  /** this call's requests and response bytes (the footer's too on the file's first call) */
  requests: number
  bytes: number
}

/** the cell ids a cell reads in a file of resolution `fileRes`, and how they relate to it */
export function cellRange(cell: string, fileRes: number): { cellRes: number; scope: CellSpecies['scope']; range: [bigint, bigint] } {
  if (!/^[0-9a-f]{15}$/.test(cell)) throw new RangeError(`${cell} is not an h3 cell (15 lowercase hex digits)`)
  const id = cellIdOf(cell), cellRes = cellIdRes(id)
  if (cellRes === fileRes) return { cellRes, scope: 'cell', range: [id, id] }
  if (cellRes < fileRes) return { cellRes, scope: 'children', range: childRange(id, fileRes) }
  const p = parentId(id, fileRes)
  return { cellRes, scope: 'parent', range: [p, p] }
}

const value = (v: unknown): SpeciesValue =>
  v == null ? null : typeof v === 'bigint' ? (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v)
    : typeof v === 'number' || typeof v === 'string' ? v : String(v)

/** the rows of `cell` in the species table at `href` (sorted by cell id); null when the file is not there */
export async function speciesForCell(href: string, cell: string, opts: SpeciesForCellOptions): Promise<CellSpecies | null> {
  const reader = opts.reader ?? new ReleaseReader({ fetch: opts.fetch, tail: opts.tail })
  const id = opts.id ?? 'cell_id'
  const { cellRes, scope, range } = cellRange(cell, opts.res)
  const before = { requests: reader.stats.requests, bytes: reader.stats.bytes, skipped: reader.groupsSkipped }
  const f = await reader.open(href)
  if (!f) return null
  if (!f.names.has(id)) throw new Error(`${href}: no column ${id}`)
  const columns = (opts.columns ?? [...f.names].filter((c) => c !== id && c !== 'h3')).filter((c) => f.names.has(c))
  const groups = reader.groupsFor(f, id, 'int64', [range])
  const [lo, hi] = range
  const parts = await Promise.all(groups.map(async (g) => {
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
    const ids = raw[id] ?? []
    const out: Record<string, SpeciesValue>[] = []
    for (let i = 0; i < n; i++) {
      const v = ids[i]
      const k = typeof v === 'bigint' ? v : v == null ? null : BigInt(v as number)
      if (k == null || k < lo || k > hi) continue
      const r: Record<string, SpeciesValue> = { [id]: k }
      for (const c of columns) r[c] = value(raw[c]?.[i])
      out.push(r)
    }
    return out
  }))
  reader.groupsRead += groups.length
  return {
    cell, cellRes, fileRes: opts.res, scope, range,
    rows: parts.flat(),
    groupsRead: groups.length, groupsSkipped: reader.groupsSkipped - before.skipped,
    requests: reader.stats.requests - before.requests, bytes: reader.stats.bytes - before.bytes,
  }
}

/** the hex id of a row's cell (the id column is a bigint) */
export const rowCell = (r: Record<string, SpeciesValue>, id = 'cell_id'): string => h3OfCellId(r[id] as bigint)
