// the grid provider: one time step of a slab (gridded data masked to a place) drawn as squares, one per cell, sized from
// the dataset's own axis step. a port of erddap-places `app/src/lib/cells.ts` `cellSquares` (and `palette.ts` for the
// colours) with the `sql/last_step.sql` semantics: the cells of one step, the mask's own lat/lon centres (so squares
// land on the dataset grid), the area weight and the value, a cell without data kept with a null value (drawn as a
// hole, so its neighbours do not move). the rows come from a `SliceSource` the app implements (the engine's SQL in
// DuckDB-WASM, build week 2 step 2); this module draws them into a GeoJSON source with a data-driven fill.
//
// antimeridian: a place like PMNM has cells on both sides of ±180. when the cells span more than 180° of longitude they
// are put in [0, 360) and the squares run past 180 (179.95 -> 180.05) instead of wrapping the globe.
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { classColors, DEFAULT_RAMP, interpolateColors, rampStops, UNKNOWN_CLASS_COLOR } from './ramps.js'
import { formatLayerKey, SLOT_PREFIX } from './slot.js'
import type { LayerSlot, LayerSpec, LegendClass, LegendSpec } from './slot.js'

// ---- the squares ----

/** one cell of a slice: its centre, area weight (0, 1] and value (null when the step has no data there) */
export interface SliceCell { lat: number; lon: number; value: number | null; weight: number }

/** the rows of one step, as `last_step.sql` returns them; t null = the slab's newest step */
export interface SliceSource {
  slice(t: string | null, signal?: AbortSignal): Promise<SliceCell[]>
}

/** what each square carries into the map (a hover shows value and weight) */
export interface CellProps { lon: number; lat: number; weight: number; value: number | null }

export type LonCenter = 0 | 180
export interface CellSquaresOptions {
  /** cell width in degrees; inferred from the distinct cell longitudes when omitted */
  lonSpacing?: number
  /** cell height in degrees; inferred from the distinct cell latitudes when omitted */
  latSpacing?: number
  /** longitude frame: (-180, 180] for 0, [0, 360) for 180, or 'auto' by the cells' own span */
  center?: LonCenter | 'auto'
}
export interface CellSquares {
  geojson: FeatureCollection<Polygon, CellProps>
  lonSpacing: number
  latSpacing: number
  center: LonCenter
  /** [west, south, east, north] of the squares, in the chosen frame (east may exceed 180) */
  bbox: [number, number, number, number]
  /** value range over the cells that have one ([0, 0] when none does) */
  range: [number, number]
}

/** a longitude in the frame `center` names: (-180, 180] for 0, [0, 360) for 180 */
export function normalizeLon(lon: number, center: LonCenter = 0): number {
  let x = ((((lon + 180) % 360) + 360) % 360) - 180
  if (x === -180) x = 180
  return center === 180 && x < 0 ? x + 360 : x
}

/** the step of an axis from the values used: the median positive gap between distinct sorted values (gaps left by
 * cells outside the mask cannot inflate it); 0 when there is nothing to measure */
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

/** the frame the cells fit in without wrapping: 180 when they span more than half the globe */
export function pickCenter(lons: number[]): LonCenter {
  if (!lons.length) return 0
  const x = lons.map((l) => normalizeLon(l, 0))
  return Math.max(...x) - Math.min(...x) > 180 ? 180 : 0
}

/** one square per cell, lon ± lonSpacing/2 by lat ± latSpacing/2 (latitude clamped to the poles), in one continuous
 * longitude frame; a cell without a value is kept with value null */
export function cellSquares(cells: readonly SliceCell[], opts: CellSquaresOptions = {}): CellSquares {
  const center = opts.center === undefined || opts.center === 'auto' ? pickCenter(cells.map((c) => c.lon)) : opts.center
  const lons = cells.map((c) => normalizeLon(c.lon, center))
  let dx = opts.lonSpacing ?? axisSpacing(lons)
  let dy = opts.latSpacing ?? axisSpacing(cells.map((c) => c.lat))
  // a single row or column gives that axis no gap to measure: borrow the other axis's step
  if (!dx) dx = dy
  if (!dy) dy = dx
  const hx = dx / 2, hy = dy / 2
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
      type: 'Feature', id: i,
      properties: { lon: x, lat: y, weight: c.weight, value },
      geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
    }
  })
  return {
    geojson: { type: 'FeatureCollection', features },
    lonSpacing: dx, latSpacing: dy, center,
    bbox: features.length ? [w, s, e, n] : [0, 0, 0, 0],
    range: Number.isFinite(vmin) ? [vmin, vmax] : [0, 0],
  }
}

// ---- the colour ----

/** the classes of a categorical grid: the value each class has and its label */
export interface GridClass { value: string | number; label: string }

/** a categorical grid's classes with their colours (the reversed Spectral, as seascapeR, unless a ramp is named) */
export function classLegend(classes: readonly GridClass[], ramp?: string): LegendClass[] {
  const cols = classColors(classes.map((c) => c.value), ramp)
  return classes.map((c) => ({ value: c.value, label: c.label, color: cols.get(String(c.value))! }))
}

/** the fill colour: a `match` on the value's string for classes (an unknown value grey), else a linear ramp over the
 * range with a null value transparent (erddap-places App.svelte) */
export function gridFillColor(opts: { range: [number, number]; ramp?: string; classes?: readonly LegendClass[] | null; stops?: number }): ExpressionSpecification {
  if (opts.classes?.length) {
    return ['match', ['to-string', ['get', 'value']], ...opts.classes.flatMap((c) => [String(c.value), c.color]), UNKNOWN_CLASS_COLOR] as ExpressionSpecification
  }
  return ['case', ['==', ['get', 'value'], null], 'rgba(0,0,0,0)',
    ['interpolate', ['linear'], ['get', 'value'], ...rampStops(opts.range[0], opts.range[1], opts.ramp ?? DEFAULT_RAMP, opts.stops ?? 7)]] as ExpressionSpecification
}

// ---- the slot ----

export interface GridSlotOptions {
  title?: string
  credit?: string
  units?: string | null
  /** the ramp of a continuous grid (ramps.ts id); default viridis */
  ramp?: string
  /** a categorical grid's classes, in legend order; set = draw classes, not a ramp */
  classes?: readonly GridClass[]
  /** the colour domain: fixed, or read at each slice and at `repaint()` (null = the slice's own value range, as when
   * omitted). a function lets two slots share one scale: both read the union of their `cellRange()`s (0.2.3) */
  domain?: [number, number] | (() => [number, number] | null | undefined)
  opacity?: number
  /** the squares' outline colour. `undefined` = by the grid: `GRID_OUTLINE` for a grid coarser than `OUTLINE_BELOW`
   * degrees, none for a finer one (the outlines of 0.01 degree squares draw a mesh over the data); `null` = none; a
   * string = that colour whatever the grid. none leaves MapLibre's default, the outline in the fill colour */
  outline?: string | null
  /** the legend's `via` */
  via?: string
  /** a name that keeps this slot's ids apart from another grid slot's on the same map (`gridIds(instance)`): two slots
   * of one layer at two periods (a Then vs Now swipe) mount side by side. omitted = `slot:grid`, as before (0.2.3) */
  instance?: string
  onchange?: () => void
}

/** a grid slot with what a second slot beside it needs: its ids, the value range of its last slice, a repaint */
export interface GridSlot extends LayerSlot {
  /** the source and fill layer ids this slot adds (`gridIds(opts.instance)`) */
  ids: { source: string; layer: string }
  /** the value range of the last slice drawn, whatever the domain (null before one arrives or when it had no value) */
  cellRange(): [number, number] | null
  /** paint the squares again under the current `domain` without a new slice (the other slot's range moved) */
  repaint(): void
}

export const GRID_SOURCE = `${SLOT_PREFIX}grid`
export const GRID_LAYER = `${SLOT_PREFIX}grid:fill`
const INSTANCE = /^[A-Za-z0-9_-]+$/
/** the source and fill ids of a grid slot: `slot:grid` and `slot:grid:fill`, or `slot:grid@<instance>` and
 * `slot:grid@<instance>:fill` (still `slot:`, so `isSlotLayer` and an app's clear() treat them as the slot's) */
export function gridIds(instance?: string | null): { source: string; layer: string } {
  if (!instance) return { source: GRID_SOURCE, layer: GRID_LAYER }
  if (!INSTANCE.test(instance)) throw new Error(`gridSlot instance "${instance}" must be letters, digits, _ or -`)
  return { source: `${GRID_SOURCE}@${instance}`, layer: `${GRID_SOURCE}@${instance}:fill` }
}
/** the outline of a coarse grid's squares */
export const GRID_OUTLINE = 'rgba(0,0,0,0.12)'
/** the axis step (degrees) above which the automatic outline is drawn: at 0.05 and finer it is a mesh */
export const OUTLINE_BELOW = 0.05

/** the outline colour for squares of this axis step (the finer of lon and lat) under the `outline` option; null = none */
export function gridOutline(spacing: number, outline?: string | null): string | null {
  if (outline !== undefined) return outline
  return spacing > OUTLINE_BELOW ? GRID_OUTLINE : null
}

/** the grid slot: mount adds an empty GeoJSON source and its fill, then each step's rows replace the data */
export function gridSlot(spec: LayerSpec, source: SliceSource, opts: GridSlotOptions = {}): GridSlot {
  const title = opts.title ?? spec.variable ?? spec.id
  const classes = opts.classes ? classLegend(opts.classes, opts.ramp) : null
  const ids = gridIds(opts.instance)
  const domainNow = () => (typeof opts.domain === 'function' ? opts.domain() ?? null : opts.domain ?? null)
  let map: MlMap | null = null
  let t: string | null = null
  let range: [number, number] | null = null
  let own: [number, number] | null = null
  let problem: string | null = null
  let ctl: AbortController | null = null
  const changed = () => opts.onchange?.()

  async function load() {
    ctl?.abort()
    const mine = (ctl = new AbortController())
    try {
      const sq = cellSquares(await source.slice(t, mine.signal))
      if (mine.signal.aborted || !map) return
      own = sq.geojson.features.some((f) => f.properties.value !== null) ? sq.range : null
      range = domainNow() ?? sq.range
      problem = sq.geojson.features.length ? null : 'no cells in this period'
      ;(map.getSource(ids.source) as GeoJSONSource | undefined)?.setData(sq.geojson)
      map.setPaintProperty(ids.layer, 'fill-color', gridFillColor({ range, ramp: opts.ramp, classes }))
      if (sq.geojson.features.length) {
        const o = gridOutline(Math.min(sq.lonSpacing, sq.latSpacing), opts.outline)
        map.setPaintProperty(ids.layer, 'fill-outline-color', o ?? undefined)
      }
    } catch (err) {
      if (mine.signal.aborted) return
      problem = `no data: ${(err as Error).message}`
    }
    changed()
  }

  return {
    id: formatLayerKey(spec),
    kind: 'grid',
    title,
    credit: opts.credit,
    ids,
    mount(m, beforeId, t0) {
      map = m
      t = t0
      m.addSource(ids.source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: ids.layer, type: 'fill', source: ids.source,
        paint: { 'fill-color': gridFillColor({ range: domainNow() ?? [0, 1], ramp: opts.ramp, classes }), 'fill-opacity': opts.opacity ?? 0.8,
          ...(typeof opts.outline === 'string' ? { 'fill-outline-color': opts.outline } : {}) } },
      beforeId ?? undefined)
      void load()
    },
    update(t1) {
      t = t1
      if (map) void load()
    },
    unmount(m) {
      ctl?.abort()
      if (m.getLayer(ids.layer)) m.removeLayer(ids.layer)
      if (m.getSource(ids.source)) m.removeSource(ids.source)
      map = null
    },
    cellRange: () => own,
    repaint() {
      if (!map || !own || classes) return
      const next = domainNow() ?? own
      if (range && next[0] === range[0] && next[1] === range[1]) return
      range = next
      map.setPaintProperty(ids.layer, 'fill-color', gridFillColor({ range, ramp: opts.ramp, classes }))
      changed()
    },
    legend() {
      return gridLegend({ title, t, via: opts.via ?? 'grid slice', problem, units: opts.units ?? null, range, ramp: opts.ramp, classes })
    },
  }
}

/** the legend of a grid: its classes, or the ramp over the range (null before the first slice arrives) */
export function gridLegend(o: { title: string; t: string | null; via: string; problem: string | null; units?: string | null;
  range: [number, number] | null; ramp?: string; classes?: LegendClass[] | null }): LegendSpec {
  const base = { title: o.title, t: o.t, via: o.via, problem: o.problem, units: o.units ?? null }
  if (o.classes?.length) return { ...base, classes: o.classes, ramp: null }
  return { ...base, classes: null, ramp: o.range ? { min: o.range[0], max: o.range[1], colors: interpolateColors(7, o.ramp ?? DEFAULT_RAMP) } : null }
}
