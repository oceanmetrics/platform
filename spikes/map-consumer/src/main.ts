// the consumer page: @oceanmetrics/map wired the way an app wires it (the README's setup, CARTO's real styles through
// composeStyle, one slot at a time under the app's parts), plus the hooks scripts/run.mjs drives (`window.__c`).
// the harness only reads the map (pixels, layer ids, rendered features); every map change goes through the package.
import * as maplibre from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import h3WorkerUrl from '@oceanmetrics/map/h3-worker?worker&url'
import {
  basemapLayerIds, baseStyle, carrySlots, cogSlot, colorAt, composeStyle, H3_FILL, h3Slot, gridSlot, isPartFill, isSlotLayer, rampColors, rampStops, seaSurfaceId,
  setupMapLibre, slotBeforeId,
} from '@oceanmetrics/map'
import type { CogAsset, LayerSlot, SliceCell, SliceSource, Theme } from '@oceanmetrics/map'
import type { StyleSpecification } from 'maplibre-gl'

const params = new URLSearchParams(location.search)
const DATA = new URL('./data/', location.href).href

// ---- setup: the README's snippet; the module is wrapped only to record what registers on the main thread ----

export const mainProtocols: string[] = []
const lib = { ...maplibre, addProtocol: (s: string, a: maplibre.AddProtocolAction) => { mainProtocols.push(s); maplibre.addProtocol(s, a) } }

let map: maplibre.Map
let theme: Theme = (params.get('theme') as Theme) ?? 'light'
let slot: LayerSlot | null = null
const errors: string[] = []
const keepSlots = params.get('keep') !== '0'

async function composed(t: Theme, opts: Record<string, unknown> = {}): Promise<StyleSpecification> {
  return composeStyle(await baseStyle(t), { theme: t, ...opts })
}

// the app's own vector part, drawn over everything (indicators' `p<i>:fill`): a box over the Bahamas, off the grid
const PART: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-79, 24], [-76, 24], [-76, 27], [-79, 27], [-79, 24]]] } }
const PART_COLOR = '#e6007e'

function addPart() {
  map.addSource('p0', { type: 'geojson', data: PART })
  map.addLayer({ id: 'p0:fill', type: 'fill', source: 'p0', paint: { 'fill-color': PART_COLOR, 'fill-opacity': 1 } })
  map.addLayer({ id: 'p0:line', type: 'line', source: 'p0', paint: { 'line-color': '#000', 'line-width': 1 } })
}

/** indicators' clear() under the proposed rule: everything the composed style does not name (the slot, the parts) */
async function clearRule() {
  const basemap = basemapLayerIds(await composed(theme))
  const onMap = ids()
  return { clears: onMap.filter((id) => !basemap.has(id)), hits: onMap.filter((id) => !isSlotLayer(id) && !basemap.has(id)), oldBaseRuleKeeps: onMap.filter((id) => id.startsWith('base-')) }
}

/** the next idle, or after 15 s (a source that never settles must not hang the check; it is recorded). a repaint is
 * asked for every 250 ms: MapLibre does not schedule a frame when a source fails (a tier that 404s), so without the
 * nudge `idle` (and `load`) can wait for the next user gesture */
export const timeouts: string[] = []
const idle = (what = 'idle') => new Promise<void>((r) => {
  const nudge = setInterval(() => map.triggerRepaint(), 250)
  const t = setTimeout(() => { clearInterval(nudge); timeouts.push(what); r() }, 15000)
  map.once('idle', () => { clearTimeout(t); clearInterval(nudge); r() })
  map.triggerRepaint()
})
const raf = () => new Promise<number>((r) => requestAnimationFrame(r))

/** the README's flow: the boot style is CARTO's own (`dem: false`, first paint does not wait for terrain), then on
 * `load` the composed style with `setStyle(style, { diff: true })`. `o.direct` boots on the composed style instead and
 * reports whether `load` came without a nudge within `o.waitMs` (the stall a failing tier causes) */
async function boot(o: { center: [number, number]; zoom: number; style?: Record<string, unknown>; part?: boolean; direct?: boolean; waitMs?: number }) {
  await setupMapLibre({ maplibre: lib, workerUrl, h3WorkerUrl })
  const t0 = performance.now()
  map = new maplibre.Map({
    container: 'map', style: await composed(theme, o.direct ? o.style : { dem: false }), center: o.center, zoom: o.zoom,
    attributionControl: false, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true },
  })
  ;(window as any).__map = map
  map.on('error', (e) => errors.push(String((e as any)?.error?.message ?? e)))
  let loadMs: number | null = null
  await new Promise<void>((r) => {
    map.once('load', () => { loadMs = performance.now() - t0; r() })
    if (o.direct) setTimeout(() => { if (loadMs === null) { const k = setInterval(() => { if (loadMs !== null) clearInterval(k); else map.triggerRepaint() }, 250) } }, o.waitMs ?? 8000)
  })
  const unnudged = o.direct ? (loadMs ?? Infinity) < (o.waitMs ?? 8000) : null
  if (!o.direct) map.setStyle(await composed(theme, o.style), { diff: true })
  if (o.part !== false) addPart()
  await idle('boot')
  return { ids: ids(), mainProtocols, errors: errors.length, loadMs, loadUnnudged: unnudged }
}

const ids = () => map.getStyle().layers.map((l) => l.id)

// ---- pixels ----

const scratch = document.createElement('canvas')
scratch.width = scratch.height = 1
const sctx = scratch.getContext('2d', { willReadFrequently: true })!
/** the canvas's RGBA at each lon/lat (the drawing buffer is preserved) */
function pixels(pts: [number, number][]): number[][] {
  const c = map.getCanvas(), k = c.width / c.clientWidth
  return pts.map(([lon, lat]) => {
    const p = map.project([lon, lat])
    sctx.clearRect(0, 0, 1, 1)
    sctx.drawImage(c, Math.floor(p.x * k), Math.floor(p.y * k), 1, 1, 0, 0, 1, 1)
    return Array.from(sctx.getImageData(0, 0, 1, 1).data)
  })
}
/** a column of the canvas at a lon (device pixels), rows y0..y1 in css px: RGBA per row */
function column(lon: number, lat0: number, lat1: number, dx = 0): number[][] {
  const c = map.getCanvas(), k = c.width / c.clientWidth
  const x = Math.floor(map.project([lon, (lat0 + lat1) / 2]).x * k) + dx
  const y0 = Math.floor(map.project([lon, lat1]).y * k), y1 = Math.floor(map.project([lon, lat0]).y * k)
  const cv = document.createElement('canvas')
  cv.width = 1; cv.height = y1 - y0
  const g = cv.getContext('2d')!
  g.drawImage(c, x, y0, 1, y1 - y0, 0, 0, 1, y1 - y0)
  const d = g.getImageData(0, 0, 1, y1 - y0).data
  const out: number[][] = []
  for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2], d[i + 3]])
  return out
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

// ---- the grid: a synthetic 1° lattice with holes, two periods ----

/** gulf: lon -97.5..-81.5, lat 18.5..29.5; pmnm: across ±180, lon 170.5..-170.5, lat 20.5..29.5 */
function lattice(name: 'gulf' | 'pmnm') {
  const lons = name === 'gulf' ? Array.from({ length: 17 }, (_, i) => -97.5 + i) : Array.from({ length: 20 }, (_, i) => ((170.5 + i + 180) % 360) - 180)
  const lats = name === 'gulf' ? Array.from({ length: 12 }, (_, j) => 18.5 + j) : Array.from({ length: 10 }, (_, j) => 20.5 + j)
  const cells: { i: number; j: number; lon: number; lat: number; hole: boolean }[] = []
  lons.forEach((lon, i) => lats.forEach((lat, j) => cells.push({ i, j, lon, lat, hole: (i * 5 + j * 3) % 11 === 0 })))
  return cells
}
/** t1: value (i + 2j) mod 7, range [0, 6]; t2: 2 × ((i + 2j + 3) mod 7), range [0, 12]: each value sits on a ramp stop */
const valueAt = (c: { i: number; j: number }, t: string | null) => (t === '2024-02' ? 2 * ((c.i + 2 * c.j + 3) % 7) : (c.i + 2 * c.j) % 7)
const rangeOf = (t: string | null): [number, number] => (t === '2024-02' ? [0, 12] : [0, 6])

function sliceSource(name: 'gulf' | 'pmnm', delayMs = 30): SliceSource {
  return {
    async slice(t) {
      await new Promise((r) => setTimeout(r, delayMs)) // the engine's query time
      return lattice(name).map((c): SliceCell => ({ lat: c.lat, lon: c.lon, weight: 1, value: c.hole ? null : valueAt(c, t) }))
    },
  }
}

/** the colour MapLibre should paint at a cell centre: the value is on a stop of rampStops(range, viridis, 7) */
function expectedGrid(c: { i: number; j: number }, t: string | null): number[] {
  const [lo, hi] = rangeOf(t)
  const stops = rampStops(lo, hi, 'viridis', 7)
  const v = valueAt(c, t)
  const k = stops.findIndex((s, idx) => idx % 2 === 0 && s === v)
  return hex(stops[k + 1] as string)
}

function beforeId(): string | null {
  return slotBeforeId(ids().filter((id) => isPartFill(id) || /^p\d+:/.test(id)), { fallback: seaSurfaceId(map.getStyle()) })
}

async function settledSlot(sourceId: string) {
  for (let i = 0; i < 200; i++) {
    await idle()
    if (map.getSource(sourceId) && map.isSourceLoaded(sourceId)) return
  }
}

async function mountGrid(name: 'gulf' | 'pmnm', t: string | null = '2024-01') {
  unmount()
  const b = beforeId()
  slot = gridSlot({ kind: 'grid', id: `synthetic_${name}`, variable: 'v' }, sliceSource(name), { ramp: 'viridis', opacity: 1 })
  slot.mount(map, b, t)
  await settledSlot('slot:grid')
  await new Promise((r) => setTimeout(r, 100))
  await idle()
  return { beforeId: b, ids: ids(), legend: slot.legend() }
}

function unmount() {
  if (slot) { slot.unmount(map); slot = null }
}

// ---- the cog ----

const COGS: Record<string, CogAsset> = {
  am: { href: `${DATA}cogs/729c63f1d05d0515.tif`, title: 'am_native (AquaMaps native range, 3857 copy)', 'proj:code': 'EPSG:3857', 'atlas:colormap': 'viridis',
    bands: [{ nodata: 0, unit: 'probability %', statistics: { minimum: 1, maximum: 100, mean: 81.235, stddev: 27.069, valid_percent: 61.49 } }] },
  two: { href: `${DATA}cogs/two_band_3857.tif`, title: 'two_band (synthetic)', 'proj:code': 'EPSG:3857', 'atlas:colormap': 'viridis', 'atlas:bidx': 2, 'atlas:rescale': [0, 100],
    bands: [{ nodata: 255, statistics: { minimum: 10, maximum: 10 } }, { nodata: 255, statistics: { minimum: 0, maximum: 100 } }] },
  am4326: { href: `${DATA}cogs/729c63f1d05d0515_4326.tif`, title: 'am_native (4326 original)', 'proj:code': 'EPSG:4326', bands: [{ nodata: 0 }] },
}
/** the colour the cog colour function gives a value (alpha 255 at opacity 1) */
function expectedCog(asset: string, v: number): number[] {
  const a = COGS[asset]
  const [lo, hi] = Array.isArray(a['atlas:rescale']) ? a['atlas:rescale'] : [a.bands![0].statistics!.minimum, a.bands![0].statistics!.maximum]
  return colorAt(rampColors(a['atlas:colormap'] ?? 'viridis'), (v - lo) / (hi - lo > 0 ? hi - lo : 1))
}

async function mountCog(name: string) {
  unmount()
  try {
    slot = cogSlot({ kind: 'cog', id: name, variable: null }, COGS[name], { name, opacity: 1 })
  } catch (e) {
    return { error: (e as Error).name, message: (e as Error).message }
  }
  const b = beforeId()
  slot.mount(map, b, null)
  await settledSlot('slot:cog')
  await idle()
  return { beforeId: b, ids: ids(), legend: slot.legend() }
}

// ---- the hexagons ----

let pacific: { domain: [number, number]; h3: string[]; v: number[] } | null = null
async function mountH3(form: 'archive' | 'memory' | 'relative') {
  unmount()
  const spec = { kind: 'h3' as const, id: `es5_${form}`, variable: 'es' }
  if (form === 'memory') {
    pacific ??= await (await fetch(`${DATA}cells-pacific.json`)).json()
    slot = h3Slot(spec, { cells: { h3: pacific!.h3, v: pacific!.v } }, { domain: pacific!.domain, opacity: 1, maxzoom: 6 })
  } else {
    slot = h3Slot(spec, { url: form === 'relative' ? './data/es5.pmtiles' : `${DATA}es5.pmtiles` }, { opacity: 1 })
  }
  const b = beforeId()
  slot.mount(map, b, null)
  for (let i = 0; i < 100 && !map.getSource('slot:h3'); i++) await new Promise((r) => setTimeout(r, 20))
  await settledSlot('slot:h3')
  await idle()
  return { beforeId: b, ids: ids(), legend: slot.legend(), source: (map.getSource('slot:h3') as any)?.serialize?.() }
}

/** the resolutions of the hexagons drawn in the view (the second hex digit of an h3 index is its resolution) */
function h3Res() {
  const f = map.queryRenderedFeatures({ layers: [H3_FILL] })
  const res: Record<string, number> = {}
  for (const x of f) { const r = String(parseInt(String(x.properties.h3)[1], 16)); res[r] = (res[r] ?? 0) + 1 }
  return { features: f.length, res, tileZoom: Math.floor(map.getZoom()) }
}

// ---- motion: the spike's scripted pan, frame times from requestAnimationFrame ----

const VIEWS = {
  fiji: (u: number) => ({ center: [175 + 15 * u, -17.5 + 2 * Math.sin(2 * Math.PI * u)] as [number, number], zoom: 5 + 1.5 * Math.sin(Math.PI * u) }),
}
async function run(view: keyof typeof VIEWS, ms = 5000) {
  map.jumpTo(VIEWS[view](0))
  await idle()
  const idleF: number[] = []
  let last = await raf()
  for (let i = 0; i < 30; i++) { const t = await raf(); idleF.push(t - last); last = t }
  idleF.sort((a, b) => a - b)
  const frames: number[] = []
  const start = await raf()
  last = start
  for (;;) {
    const u = Math.min(1, (last - start) / ms)
    map.jumpTo(VIEWS[view](u))
    const t = await raf()
    frames.push(t - last)
    last = t
    if (u >= 1) break
  }
  const f = frames.slice().sort((a, b) => a - b)
  return { interval: idleF[15], frames: f.length, meanMs: f.reduce((s, x) => s + x, 0) / f.length, p95Ms: f[Math.floor(f.length * 0.95)], maxMs: f[f.length - 1] }
}

/** pixels at pts sampled on every frame for ms while fn runs (the flash check) */
async function sampleDuring(fn: () => void | Promise<void>, pts: [number, number][], ms = 1500) {
  const out: number[][][] = []
  const t0 = performance.now()
  void fn()
  while (performance.now() - t0 < ms) { await raf(); out.push(pixels(pts)) }
  return out
}

// ---- the theme flip, the way the README says (setStyle(composeStyle(other), { diff: true })) ----

async function flip(to: Theme, opts: { keep?: boolean } = {}) {
  theme = to
  const next = await composed(to)
  const before = ids()
  const keep = opts.keep ?? keepSlots
  if (keep) map.setStyle(next, { diff: true, transformStyle: carrySlots })
  else map.setStyle(next, { diff: true })
  await new Promise((r) => setTimeout(r, 50))
  await idle('flip')
  return { before, after: ids(), carrySlots: keep, basemap: [...basemapLayerIds(next)] }
}

;(window as any).__c = {
  boot, ids, pixels, column, idle, mountGrid, unmount, mountCog, mountH3, h3Res, run, sampleDuring, flip, lattice,
  expectedGrid, expectedCog, rangeOf, hex, errors: () => errors, timeouts: () => timeouts, loaded: () => ({ loaded: map.loaded(), sources: Object.keys(map.getStyle().sources).map((s) => [s, map.isSourceLoaded(s)]) }), mainProtocols: () => mainProtocols, partColor: hex(PART_COLOR),
  update: (t: string | null) => slot?.update(t), legend: () => slot?.legend(), jump: async (center: [number, number], zoom: number) => { map.jumpTo({ center, zoom }); await idle() },
  style: () => map.getStyle(), composed, isSlotLayer, clearRule,
  rendered: (layers: string[]) => map.queryRenderedFeatures({ layers: layers.filter((l) => map.getLayer(l)) }).length,
  querySource: (src: string, sourceLayer: string) => map.querySourceFeatures(src, { sourceLayer }).map((f) => f.properties),
}
;(window as any).__ready = true
