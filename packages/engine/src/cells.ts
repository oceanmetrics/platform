// the masked grid, as map geometry: one GeoJSON square per mask cell, sized from the dataset's own
// axis spacing (lon/lat +- half a step), carrying the cell's value and area weight.
//
// antimeridian: the mask cells of a place like PMNM arrive on both sides of +-180. drawn naively in
// the (-180, 180] frame, the two halves sit at opposite edges of the map and any square straddling
// the line wraps the whole globe. so the whole set is put in one continuous frame first: when the
// cells span more than 180 degrees of longitude, they are expressed in [0, 360) ("centred at 180")
// and the squares keep going past 180 (179.95 -> 180.05) instead of wrapping. MapLibre accepts
// longitudes outside [-180, 180] and draws them across the seam.
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'

/** a mask cell with the value of one time step (null when the grid has no data there). */
export interface ValueCell { lon: number; lat: number; weight: number; value?: number | null }
/** what each square carries into the map (hover shows `value` and `weight`). */
export interface CellProps { lon: number; lat: number; weight: number; value: number | null }

export type LonCenter = 0 | 180
export interface CellSquaresOptions {
  /** cell width in degrees; inferred from the distinct cell longitudes when omitted. */
  lonSpacing?: number
  /** cell height in degrees; inferred from the distinct cell latitudes when omitted. */
  latSpacing?: number
  /** longitude frame: (-180, 180] for 0, [0, 360) for 180, or 'auto' by the cells' own span. */
  center?: LonCenter | 'auto'
}
export interface CellSquares {
  geojson   : FeatureCollection<Polygon, CellProps>
  lonSpacing: number
  latSpacing: number
  center    : LonCenter
  /** [west, south, east, north] of the squares, in the chosen frame (east may exceed 180). */
  bbox      : [number, number, number, number]
  /** value range over the cells that have one, for the colour ramp ([0, 0] when there are none). */
  range     : [number, number]
}

/** a longitude in the frame `center` names: (-180, 180] for 0, [0, 360) for 180. */
export function normalizeLon(lon: number, center: LonCenter = 0): number {
  let x = ((((lon + 180) % 360) + 360) % 360) - 180   // (-180, 180]
  if (x === -180) x = 180
  return center === 180 && x < 0 ? x + 360 : x
}

/**
 * The step of an axis given only the values that were used: the **median** positive gap between
 * distinct sorted values, so gaps left by cells outside the mask (2x, 3x the step) cannot inflate
 * it. Returns 0 when there is nothing to measure (fewer than two distinct values).
 */
export function axisSpacing(values: number[]): number {
  const v = [...new Set(values.filter((x) => Number.isFinite(x)))].sort((a, b) => a - b)
  if (v.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1]; if (d > 0) gaps.push(d) }
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  const m = gaps.length >> 1
  return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2
}

/** the frame the cells fit in without wrapping: 180 when they span more than half the globe. */
export function pickCenter(lons: number[]): LonCenter {
  if (!lons.length) return 0
  const x = lons.map((l) => normalizeLon(l, 0))
  return Math.max(...x) - Math.min(...x) > 180 ? 180 : 0
}

/**
 * One square per mask cell: `lon +- lonSpacing/2`, `lat +- latSpacing/2` (latitude clamped to the
 * poles), in a single continuous longitude frame, with `value`, `weight`, `lon` and `lat` as
 * properties. Cells whose value is missing are kept (drawn as a gap) with `value: null`.
 */
export function cellSquares(cells: ValueCell[], opts: CellSquaresOptions = {}): CellSquares {
  const center = opts.center === undefined || opts.center === 'auto'
    ? pickCenter(cells.map((c) => c.lon))
    : opts.center
  const lons = cells.map((c) => normalizeLon(c.lon, center))
  let dx     = opts.lonSpacing ?? axisSpacing(lons)
  let dy     = opts.latSpacing ?? axisSpacing(cells.map((c) => c.lat))
  // a single row or column gives that axis no gap to measure: borrow the other axis's step
  if (!dx) dx = dy
  if (!dy) dy = dx
  const hx   = dx / 2, hy = dy / 2

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  let vmin = Infinity, vmax = -Infinity
  const features: Feature<Polygon, CellProps>[] = cells.map((c, i) => {
    const x = lons[i], y = c.lat
    const x0 = x - hx, x1 = x + hx
    const y0 = Math.max(-90, y - hy), y1 = Math.min(90, y + hy)
    const value = typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null
    if (value !== null) { if (value < vmin) vmin = value; if (value > vmax) vmax = value }
    if (x0 < w) w = x0; if (x1 > e) e = x1
    if (y0 < s) s = y0; if (y1 > n) n = y1
    return {
      type      : 'Feature',
      id        : i,
      properties: { lon: x, lat: y, weight: c.weight, value },
      geometry  : { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
    }
  })

  return {
    geojson   : { type: 'FeatureCollection', features },
    lonSpacing: dx, latSpacing: dy, center,
    bbox      : features.length ? [w, s, e, n] : [0, 0, 0, 0],
    range     : Number.isFinite(vmin) ? [vmin, vmax] : [0, 0],
  }
}

// ── map bounds for a place ────────────────────────────────────────────────────
/**
 * Map bounds for a place, antimeridian-aware.
 *
 * The gazetteer splits geometry at +-180, so a place that straddles the line (PMNM) has the useless
 * stored bbox `[-180, .., 180, ..]`. Only in that case — width > 180 — is the geometry walked, in
 * the [0, 360) frame, giving bounds like `[177.8, 19.2, 210.0, 31.8]` that MapLibre fits across the
 * seam. Every other place returns its stored bbox untouched, so selecting a place still does no
 * geometry work (the FKNMS/TBNMS vertex counts are the reason that matters).
 */
export function placeMapBounds(
  place: { bbox: [number, number, number, number]; geometry?: unknown },
): [number, number, number, number] {
  const [x0, y0, x1, y1] = place.bbox
  if (x1 - x0 <= 180 || !place.geometry) return [x0, y0, x1, y1]
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (c: any) => {
    if (typeof c?.[0] === 'number') {
      const x = normalizeLon(c[0], 180), y = c[1]
      if (x < w) w = x; if (x > e) e = x
      if (y < s) s = y; if (y > n) n = y
    } else if (Array.isArray(c)) for (const k of c) walk(k)
  }
  const g: any = place.geometry
  if (g.type === 'GeometryCollection') for (const sub of g.geometries) walk(sub.coordinates)
  else walk(g.coordinates)
  return Number.isFinite(w) ? [w, s, e, n] : [x0, y0, x1, y1]
}

/**
 * The box to fit for a place of the gazetteer index. The index unwraps a place cut at the antimeridian
 * (NMS:PMNM is 177.8..199.0, `centroid_lon` 188), so its bbox fits directly. A few rows still read -180..180
 * (the geometry is split but the bbox is not unwrapped): those need the geometry, and give null until it is
 * loaded (the caller fits when it arrives).
 */
export function indexBounds(
  bbox: [number, number, number, number],
  geometry?: unknown,
): [number, number, number, number] | null {
  if (bbox[2] - bbox[0] <= 180) return bbox
  return geometry ? placeMapBounds({ bbox, geometry }) : null
}

// ── points (tabledap) ─────────────────────────────────────────────────────────
export interface CellPoints {
  geojson: FeatureCollection<Point, CellProps>
  center : LonCenter
  bbox   : [number, number, number, number]
  range  : [number, number]
}

/**
 * One point per sample position, for a **tabledap** run: there is no cell to draw, so the map gets
 * circles instead of squares. Same longitude framing as `cellSquares()`, so an antimeridian place
 * stays in one piece, and the same properties, so the hover popup and the colour ramp are shared.
 */
export function cellPoints(cells: ValueCell[], opts: { center?: LonCenter | 'auto' } = {}): CellPoints {
  const center = opts.center === undefined || opts.center === 'auto'
    ? pickCenter(cells.map((c) => c.lon))
    : opts.center
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  let vmin = Infinity, vmax = -Infinity
  const features: Feature<Point, CellProps>[] = cells.map((c, i) => {
    const x = normalizeLon(c.lon, center), y = c.lat
    const value = typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null
    if (value !== null) { if (value < vmin) vmin = value; if (value > vmax) vmax = value }
    if (x < w) w = x; if (x > e) e = x
    if (y < s) s = y; if (y > n) n = y
    return {
      type: 'Feature', id: i,
      properties: { lon: x, lat: y, weight: c.weight, value },
      geometry  : { type: 'Point', coordinates: [x, y] },
    }
  })
  return {
    geojson: { type: 'FeatureCollection', features },
    center,
    bbox   : features.length ? [w, s, e, n] : [0, 0, 0, 0],
    range  : Number.isFinite(vmin) ? [vmin, vmax] : [0, 0],
  }
}
