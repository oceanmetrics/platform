// the tile lookup over a table of h3 cells, and the resolution each tile zoom draws. ported from platform spike 1
// (`spikes/h3j-source/src/cellIndex.ts`, 2026-10-22), generalised from res 5 to any resolution:
//   - the cells are grouped by a coarser parent (three levels up: res 5 by res 2, the shape of obis-hex's parent
//     partitions); a tile asks h3-js for the parents overlapping its bbox, grown by two cells of the table's resolution
//     (a child can poke out of its parent by part of a cell) and geojson-vt's tile buffer, then takes their children.
//     the bbox edges are densified every 2° (h3's edges are great circles, a bbox's are parallels).
//   - a tile near ±180 also takes the strip on the other side of the seam, so the wrapped copies (h3.ts cellRing)
//     reach tile x = 0 and x = 2^z - 1 (spike 1 condition 4).
//   - the resolution steps with zoom (spike 1 condition 3): at res 5 a z1 tile held 25,000 to 50,000 cells and took 40
//     to 85 ms. RES_FOR_ZOOM is obis-hex's zoom_to_res (MarineSensitivity h3-db app.R) at each tile zoom.
import { cellToBoundary, cellToParent, getHexagonEdgeLengthAvg, getResolution, polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS, UNITS } from 'h3-js'

/** one table of cells, columnar: h3 ids and one value per id (the shape of an h3j tile and of obis-hex's partitions) */
export interface H3jTile {
  h3: string[]
  v: ArrayLike<number>
}

/** the MVT tile geometry the lookup grows its bbox by (h3.ts cuts tiles with the same) */
export const EXTENT = 4096
export const BUFFER = 64
const MAX_LAT = 89.5
const KM_PER_DEG = 111.32

// ---- the resolution per zoom ----

/** obis-hex `ZOOM_BREAKS`: 0, 2.2, 3.4, 4.6, 5.8, 7, 8.2, 9.4, 10.6, 11.8, 22 */
export const ZOOM_BREAKS: readonly number[] = Array.from({ length: 11 }, (_, i) => (i === 0 ? 0 : i === 10 ? 22 : 1 + ((13 - 1) * i) / 10))

/** the h3 resolution a view zoom draws: R's findInterval(z, ZOOM_BREAKS) clamped to 1..10 (obis-hex zoomToRes) */
export function zoomToRes(zoom: number): number {
  let k = 0
  for (const b of ZOOM_BREAKS) if (zoom >= b) k++
  return Math.max(1, Math.min(10, k))
}

/** the resolution of each tile zoom 0..12 (index = z) */
export const RES_FOR_ZOOM: readonly number[] = Array.from({ length: 13 }, (_, z) => zoomToRes(z))

/** the resolution a tile at zoom z carries, capped at the finest the data has */
export const resForZoom = (z: number, maxRes = 15): number => Math.min(maxRes, zoomToRes(Math.floor(z)))

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
    this.marginDeg = (2 * getHexagonEdgeLengthAvg(this.res, UNITS.km)) / KM_PER_DEG
    for (let i = 0; i < cells.h3.length; i++) {
      const p = cellToParent(cells.h3[i], this.parentRes)
      const list = this.byParent.get(p)
      if (list) list.push(i)
      else this.byParent.set(p, [i])
    }
  }

  /** the parents overlapping tile z/x/y plus its margin, across the antimeridian when it is near */
  parents(z: number, x: number, y: number): Set<string> {
    const [w0, s0, e0, n0] = tileBounds(z, x, y)
    const pad = ((e0 - w0) * BUFFER) / EXTENT
    const latPad = this.marginDeg + ((n0 - s0) * BUFFER) / EXTENT
    const s = Math.max(-MAX_LAT, s0 - latPad)
    const n = Math.min(MAX_LAT, n0 + latPad)
    const cos = Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180)
    const lonPad = pad + this.marginDeg / Math.max(cos, 0.01)
    const out = new Set<string>()
    for (const [a, b] of seamSpans(w0 - lonPad, e0 + lonPad))
      for (const poly of bboxPolygons(a, s, b, n))
        for (const c of polygonToCellsExperimental(poly, this.parentRes, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true))
          out.add(c)
    return out
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

/** the cells rolled up to their parents at `res` (sorted by id), each parent's value the aggregate of its children's
 * (NaN children left out); the table unchanged when it is at `res` or coarser. a producer with per-resolution
 * partitions passes those instead: a mean of means is not the mean of the records. */
export function rollUp(cells: H3jTile, res: number, agg: Aggregate = 'mean'): H3jTile {
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
