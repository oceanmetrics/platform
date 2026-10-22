// the spike page: draws a COG through the cog:// protocol and exposes `window.spike` for the
// Playwright runner (run.mjs): draw, legend histogram, view statistics and point reads.
import { Map as MapLibreMap, addProtocol, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { cogProtocol, colorScale, locationValues, setColorFunction } from '@geomatico/maplibre-cog-protocol'
import { feature } from 'topojson-client'
import land110 from 'world-atlas/land-110m.json'
import { overviewStats, pointValues, setBlockSize, viewStats } from './stats'

setWorkerUrl(maplibreWorkerUrl)
addProtocol('cog', cogProtocol)

const land = feature(land110 as any, (land110 as any).objects.land) as any

const map = new MapLibreMap({
  container: 'map',
  style: {
    version: 8,
    sources: { land: { type: 'geojson', data: land } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#dfe7ee' } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#c9c3b6' } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#555', 'line-width': 0.6 } },
    ],
  },
  center: [0, 0], zoom: 1, attributionControl: false, fadeDuration: 0,
  canvasContextAttributes: { preserveDrawingBuffer: true } as any,
} as any)

const ready = new Promise<void>(r => map.once('load', () => r()))

/** a colour function per band for a multi-band COG (the atlas:bidx hook): a ColorBrewer ramp over
 * [min, max], nodata transparent. */
function bandColour(url: string, band: number, min: number, max: number, scheme = 'BrewerYlOrRd9') {
  const ramp = colorScale({ colorScheme: scheme, min, max, isContinuous: true })
  setColorFunction(url, (px: any, color: Uint8ClampedArray, md: any) => {
    const v = px[band - 1]
    if (v === md.noData || v !== v) { color[3] = 0; return }
    const [r, g, b] = ramp(v); color[0] = r; color[1] = g; color[2] = b; color[3] = 230
  })
}

interface DrawOpts { url: string; hash?: string; band?: number; range?: [number, number]; center: [number, number]; zoom: number }

let n = 0
/** draw one COG; resolves at the first idle after the source is added. */
async function draw(o: DrawOpts) {
  await ready
  for (const l of map.getStyle().layers) if (l.id.startsWith('cog')) map.removeLayer(l.id)
  for (const s of Object.keys(map.getStyle().sources)) if (s.startsWith('cog')) map.removeSource(s)
  map.jumpTo({ center: o.center, zoom: o.zoom })
  await new Promise<void>(r => (map.loaded() ? r() : map.once('idle', () => r())))
  if (o.band) bandColour(o.url, o.band, o.range?.[0] ?? 0, o.range?.[1] ?? 100)
  const id = `cog${++n}`, errors: string[] = []
  let first = NaN, tiles = 0
  const t0 = performance.now()
  const onData = (e: any) => {
    if (e.sourceId === id && e.dataType === 'source' && e.tile) { tiles++; if (first !== first) first = performance.now() - t0 }
  }
  const onErr = (e: any) => errors.push(String(e?.error?.message ?? e?.error ?? e))
  map.on('data', onData); map.on('error', onErr)
  map.addSource(id, { type: 'raster', url: `cog://${o.url}${o.hash ?? ''}`, tileSize: 256 } as any)
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-resampling': 'nearest' } } as any, 'coast')
  await new Promise<void>(r => map.once('idle', () => r()))
  const idle = performance.now() - t0
  map.off('data', onData); map.off('error', onErr)
  const src: any = map.getSource(id)
  return { id, firstTileMs: first, idleMs: idle, tiles, errors,
    tilejson: src ? { bounds: src.bounds, minzoom: src.minzoom, maxzoom: src.maxzoom, tiles: src.tiles } : null,
    view: { bounds: map.getBounds().toArray().flat(), zoom: map.getZoom(), width: map.getCanvas().clientWidth } }
}

/** draw a legend histogram in the panel. */
function showHist(label: string, buckets: number[], lo: number, hi: number) {
  const svg = document.getElementById('hist')!, W = 320, H = 60, m = Math.max(...buckets, 1)
  const ramp = colorScale({ colorScheme: 'BrewerYlOrRd9', min: 0, max: buckets.length - 1, isContinuous: true })
  svg.innerHTML = buckets.map((b, i) => {
    const h = (H - 12) * Math.sqrt(b / m), [r, g, bl] = ramp(i) // sqrt: the zero bucket dominates
    return `<rect x="${i * W / buckets.length}" y="${H - 12 - h}" width="${W / buckets.length - 1}" height="${h}" fill="rgb(${r},${g},${bl})"/>`
  }).join('') + `<text x="0" y="${H - 1}" font-size="10">${lo}</text><text x="${W}" y="${H - 1}" font-size="10" text-anchor="end">${hi}</text>`
  document.getElementById('label')!.textContent = label
}

async function bounds(): Promise<[number, number, number, number]> { await ready; return map.getBounds().toArray().flat() as any }

/** move the map without drawing a COG; returns the view's bounds and canvas width. */
async function jump(center: [number, number], zoom: number) {
  await ready
  map.jumpTo({ center, zoom })
  return { bounds: map.getBounds().toArray().flat(), width: map.getCanvas().clientWidth, zoom: map.getZoom() }
}

/** protocol point read, timed. */
async function protoPoint(url: string, lon: number, lat: number) {
  const t0 = performance.now()
  const values = await locationValues(url, { latitude: lat, longitude: lon })
  return { values, ms: performance.now() - t0 }
}

;(window as any).spike = {
  draw, jump, setBlockSize, overviewStats, viewStats, pointValues, protoPoint, showHist, bounds,
  setStatsText: (s: string) => { document.getElementById('vstats')!.textContent = s },
  width: () => map.getCanvas().clientWidth,
}
;(window as any).spikeReady = ready.then(() => true)
