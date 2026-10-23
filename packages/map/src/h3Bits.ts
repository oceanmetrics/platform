// H3 parents and child ranges by bit arithmetic on the 64-bit index, no h3-js (platform spike 4's verdict: a parent is
// the index with its resolution in bits 52-55 and the finer 3-bit digits set to 7; plain SQL doing this took 7 to 23 ms
// on 676,874 cells, as fast as DuckDB's h3 extension). the layout of a cell index (mode 1):
//   bit 63 reserved (0) | 59-62 mode | 56-58 reserved | 52-55 resolution | 45-51 base cell | 15 digits of 3 bits,
//   digit 1 at bits 42-44 ... digit 15 at bits 0-2; the digits finer than the resolution are 7.
// so the cells of one resolution sort by base cell, then digit by digit: the children of a parent at a finer
// resolution are one contiguous range of ids, which is what lets a reader of a cell-sorted Parquet file skip the row
// groups whose cell_id statistics fall outside a tile's parents. pentagons lack one child each; the range still bounds
// the rest. no maplibre-gl, no h3-js: the worker and the main thread both load it.

const RES_MASK = 0xfn << 52n

/** the 64-bit id of a cell from its hex string (`85ba00dbfffffff`) */
export const cellIdOf = (h3: string): bigint => BigInt(`0x${h3}`)

/** the hex string of a cell id (lowercase, as h3-js and the release's `h3` column write it) */
export const h3OfCellId = (id: bigint): string => id.toString(16)

/** the resolution of a cell id */
export const cellIdRes = (id: bigint): number => Number((id >> 52n) & 0xfn)

/** the digits finer than `res`, all ones: the bits that are 7 in a cell of `res` */
const finerThan = (res: number): bigint => (1n << (3n * BigInt(15 - res))) - 1n

/** the parent of a cell id at `res` (at or coarser than the cell's own): its resolution set, the finer digits set to 7 */
export function parentId(id: bigint, res: number): bigint {
  if (res < 0 || res > 15) throw new RangeError(`h3 resolution ${res} is not 0 to 15`)
  if (res > cellIdRes(id)) throw new RangeError(`res ${res} is finer than the cell's ${cellIdRes(id)}`)
  return (id & ~RES_MASK) | (BigInt(res) << 52n) | finerThan(res)
}

/** the first and last id (inclusive) a child of `parent` at the finer `res` can have: the digits between the two
 * resolutions all 0, then all 7. every child lies inside, and no cell of another parent does */
export function childRange(parent: bigint, res: number): [bigint, bigint] {
  const p = cellIdRes(parent)
  if (res < p || res > 15) throw new RangeError(`res ${res} is not between the parent's ${p} and 15`)
  const below = finerThan(res)
  const between = finerThan(p) ^ below
  const base = (parent & ~RES_MASK) | (BigInt(res) << 52n) | below
  return [base & ~between, base | between]
}

/** sorted, merged [lo, hi] ranges (inclusive) */
export function mergeRanges(ranges: [bigint, bigint][]): [bigint, bigint][] {
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const out: [bigint, bigint][] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1n) { if (r[1] > last[1]) last[1] = r[1] }
    else out.push([r[0], r[1]])
  }
  return out
}

/** whether an id lies in one of the merged ranges (binary search) */
export function inRanges(id: bigint, ranges: readonly [bigint, bigint][]): boolean {
  let lo = 0, hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (id < ranges[mid][0]) hi = mid - 1
    else if (id > ranges[mid][1]) lo = mid + 1
    else return true
  }
  return false
}

/** whether [min, max] (a row group's statistics) meets one of the merged ranges */
export function overlapsRanges(min: bigint, max: bigint, ranges: readonly [bigint, bigint][]): boolean {
  let lo = 0, hi = ranges.length - 1
  // the first range ending at or after min
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid][1] < min) lo = mid + 1
    else hi = mid
  }
  return ranges.length > 0 && ranges[lo][1] >= min && ranges[lo][0] <= max
}
