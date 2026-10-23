// the tile lookup over a table of h3 cells, and the resolution each tile zoom draws. ported from platform spike 1
// (`spikes/h3j-source/src/cellIndex.ts`, 2026-10-22), generalised from res 5 to any resolution:
//   - the cells are grouped by a coarser parent (three levels up: res 5 by res 2, the shape of obis-hex's parent
//     partitions); a tile asks h3-js for the parents of the cells that touch it and geojson-vt's tile buffer (or, when
//     the tile holds too many cells to list, the parents whose hexagon meets the bbox grown by how far a parent's
//     descendants reach past it: tileParents), then takes their children. the bbox edges are densified every 2° (h3's
//     edges are great circles, a bbox's are parallels).
//   - a tile near ±180 also takes the strip on the other side of the seam, so the wrapped copies (h3.ts cellRing)
//     reach tile x = 0 and x = 2^z - 1 (spike 1 condition 4).
//   - the resolution steps with zoom (spike 1 condition 3): at res 5 a z1 tile held 25,000 to 50,000 cells and took 40
//     to 85 ms. RES_FOR_ZOOM is obis-hex's zoom_to_res (MarineSensitivity h3-db app.R) at each tile zoom.
import { cellToBoundary, cellToParent, getHexagonAreaAvg, getHexagonEdgeLengthAvg, getResolution, polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS, UNITS } from 'h3-js'
import { zoomToRes } from './h3Zoom.js'

/** one table of cells, columnar: h3 ids and one value per id (the shape of an h3j tile and of obis-hex's partitions) */
export interface H3jTile {
  h3: string[]
  v: ArrayLike<number>
}

/** one table of cells with several value columns (a release row: n, sp, shannon, simpson, es); NaN is a missing value,
 * left out of the feature's properties. the tiles of the release provider carry every column, so the slot switches
 * indicator with a paint change and no new tile */
export interface H3Rows {
  h3: string[]
  columns: Record<string, ArrayLike<number>>
}

/** what a provider returns for a tile: one value per cell (`{ h3, v }`) or several (`{ h3, columns }`) */
export type H3TileData = H3jTile | H3Rows

/** the MVT tile geometry the lookup grows its bbox by (h3.ts cuts tiles with the same) */
export const EXTENT = 4096
export const BUFFER = 64
const MAX_LAT = 89.5
const KM_PER_DEG = 111.32

// ---- the resolution per zoom (h3Zoom.ts: no h3-js, so the main thread's release slot imports it alone) ----

export { RES_FOR_ZOOM, resForZoom, ZOOM_BREAKS, zoomToRes } from './h3Zoom.js'

// ---- tiles ----

/** tile z/x/y as [west, south, east, north] in degrees (web mercator) */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)]
}

/** the tile of a lon/lat at zoom z */
export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z, r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
  const x = Math.floor(((lon + 180) / 360) * n), y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))]
}

/** the hexagon of one cell as a closed GeoJSON ring ([lng, lat]). a cell across the antimeridian comes back from h3-js
 * with its vertices split between +179 and -179 (a ring spanning ~358°); its negative longitudes get +360 so it is
 * continuous east of +180, and geojson-vt's wrap then draws it on both sides of the seam (mapgl PR 211) */
export function cellRing(h3: string): [number, number][] {
  const ring = cellToBoundary(h3, true) as [number, number][]
  let min = 180, max = -180
  for (const p of ring) {
    if (p[0] < min) min = p[0]
    if (p[0] > max) max = p[0]
  }
  return max - min > 180 ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring
}

/** whether a cell's hexagon (unwrapped, and its copies 360° either side) reaches tile z/x/y or its buffer: the exact
 * test the archive writer keeps a cell by (the lookup is generous on purpose, geojson-vt clips what it brings) */
export function cellTouchesTile(h3: string, z: number, x: number, y: number): boolean {
  const ring = cellRing(h3)
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon; if (lon > e) e = lon
    if (lat < s) s = lat; if (lat > n) n = lat
  }
  const [tw, ts, te, tn] = tileBounds(z, x, y)
  const pad = ((te - tw) * BUFFER) / EXTENT, latPad = ((tn - ts) * BUFFER) / EXTENT
  if (s > tn + latPad || n < ts - latPad) return false
  return [-360, 0, 360].some((k) => w + k <= te + pad && e + k >= tw - pad)
}

/** a bbox as h3 polygons of at most 60° of longitude, edges densified every 2° */
function bboxPolygons(w: number, s: number, e: number, n: number): number[][][] {
  const out: number[][][] = []
  for (let a = w; a < e; a += 60) {
    const b = Math.min(e, a + 60)
    const ring: number[][] = []
    const steps = Math.max(1, Math.ceil((b - a) / 2))
    for (let i = 0; i <= steps; i++) ring.push([a + ((b - a) * i) / steps, s])
    for (let i = 0; i <= steps; i++) ring.push([b - ((b - a) * i) / steps, n])
    ring.push([a, s])
    out.push(ring)
  }
  return out
}

/** the lon spans of a tile's grown bbox, split at ±180 so the other side of the seam comes too */
export function seamSpans(w: number, e: number): [number, number][] {
  if (e - w >= 360) return [[-180, 180]]
  const spans: [number, number][] = []
  if (w < -180) { spans.push([w + 360, 180]); w = -180 }
  if (e > 180) { spans.push([-180, e - 360]); e = 180 }
  spans.push([w, e])
  return spans
}

/** two cells of `res`, in degrees of latitude (CellIndex.marginDeg; tileParents no longer grows its box by it) */
export const marginDegFor = (res: number): number => (2 * getHexagonEdgeLengthAvg(res, UNITS.km)) / KM_PER_DEG

/** how far the descendants of a cell of `parentRes` reach past its own hexagon, as a share of its edge length (its
 * radius): measured with h3-js over cells at res 0 to 5 and their children one to four levels down, at most 0.203
 * (res 0), 0.165 at res 1 to 5. rounded up to a quarter, so the bound stays under one parent radius */
export const OVERHANG = 0.25

/** the most cells of `res` a tile's lookup lists one by one (tileParents' exact path); a pinned fine resolution at a
 * low zoom has more and takes the parents' own hexagons instead */
export const EXACT_CELLS = 20_000

const EARTH_KM2 = 4 * Math.PI * 6371.0088 ** 2

/** a rough count of the cells of `res` in a box (its spherical area over the mean cell area) */
function boxCells(w: number, s: number, e: number, n: number, res: number): number {
  const rad = Math.PI / 180
  const frac = ((Math.min(360, e - w) * rad) * Math.abs(Math.sin(n * rad) - Math.sin(s * rad))) / (4 * Math.PI)
  return (frac * EARTH_KM2) / getHexagonAreaAvg(res, UNITS.km2)
}

/** the cells of `res` whose hexagon meets the box [w, s, e, n] grown by `km` (split at ±180, densified), in degrees */
function cellsNear(w0: number, s0: number, e0: number, n0: number, km: number, res: number): Set<string> {
  const latPad = km / KM_PER_DEG
  const s = Math.max(-MAX_LAT, s0 - latPad)
  const n = Math.min(MAX_LAT, n0 + latPad)
  const cos = Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180)
  const lonPad = latPad / Math.max(cos, 0.01)
  const out = new Set<string>()
  for (const [a, b] of seamSpans(w0 - lonPad, e0 + lonPad))
    for (const poly of bboxPolygons(a, s, b, n))
      for (const c of polygonToCellsExperimental(poly, res, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true))
        out.add(c)
  return out
}

/**
 * the cells of `parentRes` whose children at `res` can touch tile z/x/y (the tile and geojson-vt's buffer, as
 * cellTouchesTile says), split at ±180 so the strip on the other side of the seam comes too (spike 1 condition 4).
 * the lookup CellIndex keys its groups by, and the release provider turns into cell_id ranges and parent files.
 *   - exact, when the box holds at most EXACT_CELLS cells of `res` (every tile of the auto rule, where the resolution
 *     steps with zoom): the cells of `res` whose hexagon meets the box grown by one of their own edges (a hexagon's
 *     bbox reaches past it by less), kept by cellTouchesTile, and their parents. so a parent comes only when one of
 *     its cells reaches the tile (map 0.3.2: at Monterey z9, res 7, the view's nine tiles read 8 res-3 parent files,
 *     not 9).
 *   - else the parents whose own hexagon meets the box grown by how far their descendants reach past it (OVERHANG of
 *     the parent's edge, under one parent radius) and one edge of `res`. 0.3.1 grew the box by two cells of `res` at
 *     every resolution, short of the overhang when `res` is three or more levels finer than `parentRes`.
 */
export function tileParents(z: number, x: number, y: number, res: number, parentRes: number): Set<string> {
  const [w, s, e, n] = tileBounds(z, x, y)
  const pad = ((e - w) * BUFFER) / EXTENT, latPad = ((n - s) * BUFFER) / EXTENT
  const box: [number, number, number, number] = [w - pad, Math.max(-MAX_LAT, s - latPad), e + pad, Math.min(MAX_LAT, n + latPad)]
  const edge = getHexagonEdgeLengthAvg(res, UNITS.km)
  const out = new Set<string>()
  if (parentRes >= res || boxCells(...box, res) <= EXACT_CELLS) {
    for (const c of cellsNear(...box, edge, res))
      if (cellTouchesTile(c, z, x, y)) out.add(parentRes >= res ? c : cellToParent(c, parentRes))
    return out
  }
  return cellsNear(...box, OVERHANG * getHexagonEdgeLengthAvg(parentRes, UNITS.km) + edge, parentRes)
}

export class CellIndex {
  readonly byParent = new Map<string, number[]>()
  readonly cells: H3jTile
  readonly res: number
  readonly parentRes: number
  /** two cells of the table's resolution, in degrees of latitude */
  readonly marginDeg: number

  /** the cells must share one resolution; parentRes defaults to three levels coarser (res 5 by res 2, as spike 1) */
  constructor(cells: H3jTile, opts: { parentRes?: number } = {}) {
    this.cells = cells
    this.res = cells.h3.length ? getResolution(cells.h3[0]) : 0
    this.parentRes = Math.min(this.res, opts.parentRes ?? Math.max(0, this.res - 3))
    this.marginDeg = marginDegFor(this.res)
    for (let i = 0; i < cells.h3.length; i++) {
      const p = cellToParent(cells.h3[i], this.parentRes)
      const list = this.byParent.get(p)
      if (list) list.push(i)
      else this.byParent.set(p, [i])
    }
  }

  /** the parents overlapping tile z/x/y plus its margin, across the antimeridian when it is near */
  parents(z: number, x: number, y: number): Set<string> {
    return tileParents(z, x, y, this.res, this.parentRes)
  }

  /** the cells (ids and values) that may touch tile z/x/y */
  tile(z: number, x: number, y: number): H3jTile {
    const h3: string[] = []
    const v: number[] = []
    for (const p of this.parents(z, x, y)) {
      const list = this.byParent.get(p)
      if (!list) continue
      for (const i of list) {
        h3.push(this.cells.h3[i])
        v.push(this.cells.v[i])
      }
    }
    return { h3, v }
  }
}

// ---- coarser resolutions ----

export type Aggregate = 'mean' | 'sum' | 'min' | 'max' | ((values: number[]) => number)

const AGGREGATES: Record<Exclude<Aggregate, (values: number[]) => number>, (values: number[]) => number> = {
  mean: (vs) => vs.reduce((a, b) => a + b, 0) / vs.length,
  sum: (vs) => vs.reduce((a, b) => a + b, 0),
  min: (vs) => Math.min(...vs),
  max: (vs) => Math.max(...vs),
}

/** the diversity metrics of the obis-h3 release: none of them adds across cells (the richness of a parent is not the
 * sum, mean or max of its children's; ES(50), Shannon and Simpson come from the parent's own records), so each
 * resolution is its own file and these never roll up */
export const NON_ADDITIVE: readonly string[] = ['sp', 'es', 'shannon', 'simpson', 'hill_1', 'hill_2']

/** the cells rolled up to their parents at `res` (sorted by id), each parent's value the aggregate of its children's
 * (NaN children left out); the table unchanged when it is at `res` or coarser. for additive values only: a producer
 * with per-resolution partitions passes those instead (a mean of means is not the mean of the records), and a
 * `variable` among NON_ADDITIVE is refused with any aggregate. */
export function rollUp(cells: H3jTile, res: number, agg: Aggregate = 'mean', opts: { variable?: string } = {}): H3jTile {
  if (opts.variable && NON_ADDITIVE.includes(opts.variable))
    throw new RangeError(`rollUp: ${opts.variable} is a diversity metric and does not add across cells; read the release's own resolution ${res} file`)
  if (!cells.h3.length || getResolution(cells.h3[0]) <= res) return cells
  const f = typeof agg === 'function' ? agg : AGGREGATES[agg]
  const groups = new Map<string, number[]>()
  for (let i = 0; i < cells.h3.length; i++) {
    const v = cells.v[i]
    if (v !== v) continue
    const p = cellToParent(cells.h3[i], res)
    const g = groups.get(p)
    if (g) g.push(v)
    else groups.set(p, [v])
  }
  const h3 = [...groups.keys()].sort()
  return { h3, v: h3.map((p) => f(groups.get(p)!)) }
}
