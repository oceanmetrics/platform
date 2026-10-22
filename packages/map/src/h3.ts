// the h3 provider: hexagons drawn by an ordinary MapLibre vector source, the h3j source of platform spike 1 (GO on
// 2026-10-22 against deck.gl: p95 frame time 1.00 to 1.01x, no antimeridian artefacts, 294 kB gzip off the main thread).
// a typed port of h3j-h3t's tile path (INSPIDE/h3j-h3t src/index.js, MIT, (c) 2020 INSPIDE; the bbest fork 0.9.7 for the
// MapLibre >= 4 promise protocol) with the antimeridian fix of walkerke/mapgl PR 211 (bbest; open, not merged). a tile
// request `h3j://<archive>/{z}/{x}/{y}` asks a provider for the h3 ids and values in the tile (h3j: hex id + value, no
// geometry), builds each cell's hexagon with h3-js, cuts the tile with geojson-vt and encodes it as MVT with vt-pbf.
// the rules (spike 1's conditions, each tested in h3.test.ts):
//   1. the protocol runs in MapLibre's worker (h3Worker.ts, loaded by setupMapLibre with importScriptInWorkers); an
//      in-memory table (h3Slot with cells) runs on the main thread and is for small tables only (B on the main thread dropped 17 to
//      21 frames building z1-z2 tiles of res 5).
//   2. geojson-vt runs with tolerance 0: its default (3) folds a hexagon smaller than about a pixel (res 5 below z3)
//      into a ring of no area, which draws nothing; most low-latitude cells vanished at z1.
//   3. the resolution steps with zoom (h3Index.ts RES_FOR_ZOOM).
//   4. the PR 211 unwrap (cellRing) and the strip across ±180 (h3Index.ts seamSpans), tested on the 55 crossing cells
//      of the obis-h3 ES(50) release.
// this module is the light half the main thread loads (the slot, the urls, the tile encoding); the tile builder (h3-js,
// geojson-vt, vt-pbf: about 70 kB gzip) is h3Tiles.ts, imported by the worker, by producers, and lazily by the
// in-memory form only. neither imports maplibre-gl at run time.
import type { ExpressionSpecification, Map as MlMap, VectorSourceSpecification } from 'maplibre-gl'
import { PMTiles } from 'pmtiles'
import type { Aggregate, H3jTile } from './h3Index.js'
import { H3J_SCHEME, registerProtocol } from './maplibre.js'
import { DEFAULT_RAMP, interpolateColors, rampStops } from './ramps.js'
import { formatLayerKey, SLOT_PREFIX } from './slot.js'
import type { LayerSlot, LayerSpec, LegendSpec } from './slot.js'

export type { H3jTile } from './h3Index.js'

/** the MVT layer the tiles carry; each feature has properties { h3, v } */
export const H3_LAYER = 'h3'

// ---- the h3j tile encoding (inside the archive) ----

/** a tile as stored in an archive: columnar JSON `{"h3":[...],"v":[...]}` (gzip is the archive's) */
export const encodeH3jTile = (t: H3jTile): string => JSON.stringify({ h3: t.h3, v: Array.from(t.v) })
export function decodeH3jTile(bytes: ArrayBuffer | Uint8Array | string): H3jTile {
  const d = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)) as { h3?: unknown; v?: unknown }
  if (!Array.isArray(d.h3) || !Array.isArray(d.v) || d.h3.length !== d.v.length) throw new Error('not an h3j tile: { h3: string[], v: number[] } of one length')
  return { h3: d.h3 as string[], v: d.v as number[] }
}

// ---- the worker's urls ----

/** the tile url template of an archive read in the worker: `h3j://<encoded absolute url>/{z}/{x}/{y}` */
export const h3TileUrl = (archiveUrl: string): string => `${H3J_SCHEME}://${encodeURIComponent(archiveUrl)}/{z}/{x}/{y}`
/** the archive url of an h3j tile request; null for another url */
export function parseH3TileUrl(url: string): string | null {
  const m = new RegExp(`^${H3J_SCHEME}://([^/]+)/\\d+/\\d+/\\d+`).exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

// ---- the slot ----

export type H3Archive = { url: string } | { cells: H3jTile; aggregate?: Aggregate }

export interface H3SlotOptions {
  title?: string
  credit?: string
  units?: string | null
  ramp?: string
  /** the colour domain; default the archive metadata's `domain`, else the cells' range */
  domain?: [number, number]
  /** the source maxzoom (overzoomed beyond); default the archive's, else 6 */
  maxzoom?: number
  opacity?: number
  onchange?: () => void
}

export const H3_SOURCE = `${SLOT_PREFIX}h3`
export const H3_FILL = `${SLOT_PREFIX}h3:fill`

let memSchemes = 0

/** the fill colour of the hexagons: the ramp over the domain on the tiles' `v` (MapLibre interpolates in RGB) */
export const h3FillColor = (domain: [number, number], ramp = DEFAULT_RAMP): ExpressionSpecification =>
  ['interpolate', ['linear'], ['get', 'v'], ...rampStops(domain[0], domain[1], ramp, 9)] as ExpressionSpecification

/** the h3 slot: a PMTiles archive of h3j tiles read in MapLibre's worker (setupMapLibre with h3WorkerUrl first), or an
 * in-memory table drawn on the main thread. h3 layers are one period per archive: update(t) only records t */
export function h3Slot(spec: LayerSpec, archive: H3Archive, opts: H3SlotOptions = {}): LayerSlot {
  const title = opts.title ?? spec.variable ?? spec.id
  let t: string | null = null
  let domain: [number, number] | null = opts.domain ?? null
  let problem: string | null = null
  let mounted = false

  async function sourceSpec(): Promise<VectorSourceSpecification> {
    if ('url' in archive) {
      let maxzoom = opts.maxzoom
      if (maxzoom === undefined || !domain) {
        const p = new PMTiles(archive.url)
        const [h, meta] = await Promise.all([p.getHeader(), p.getMetadata() as Promise<{ domain?: [number, number] } | null>])
        maxzoom ??= h.maxZoom
        domain ??= meta?.domain ?? null
      }
      return { type: 'vector', tiles: [h3TileUrl(archive.url)], minzoom: 0, maxzoom: maxzoom ?? 6 }
    }
    if (!domain) domain = rangeOf(archive.cells.v)
    const scheme = `h3jm${++memSchemes}`
    const { cellsProvider, h3jAction } = await import('./h3Tiles.js')
    registerProtocol(scheme, h3jAction(cellsProvider(archive.cells, { aggregate: archive.aggregate })))
    return { type: 'vector', tiles: [`${scheme}://cells/{z}/{x}/{y}`], minzoom: 0, maxzoom: opts.maxzoom ?? 6 }
  }

  return {
    id: formatLayerKey(spec),
    kind: 'h3',
    title,
    credit: opts.credit,
    mount(m: MlMap, beforeId, t0) {
      t = t0
      mounted = true
      sourceSpec().then((src) => {
        if (!mounted) return
        m.addSource(H3_SOURCE, src)
        m.addLayer({ id: H3_FILL, type: 'fill', source: H3_SOURCE, 'source-layer': H3_LAYER,
          paint: { 'fill-color': h3FillColor(domain ?? [0, 1], opts.ramp), 'fill-opacity': opts.opacity ?? 0.85 } }, beforeId ?? undefined)
        if (!domain) problem = 'no colour domain: the archive metadata has no domain'
        opts.onchange?.()
      }, (err: Error) => {
        problem = `no hexagons: ${err.message}`
        opts.onchange?.()
      })
    },
    update(t1) { t = t1 },
    unmount(m) {
      mounted = false
      if (m.getLayer(H3_FILL)) m.removeLayer(H3_FILL)
      if (m.getSource(H3_SOURCE)) m.removeSource(H3_SOURCE)
    },
    legend(): LegendSpec {
      return { title, t, via: 'h3 hexagons', problem, units: opts.units ?? null, classes: null,
        ramp: domain ? { min: domain[0], max: domain[1], colors: interpolateColors(7, opts.ramp ?? DEFAULT_RAMP) } : null }
    },
  }
}

function rangeOf(v: ArrayLike<number>): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x < lo) lo = x; if (x > hi) hi = x }
  return Number.isFinite(lo) ? [lo, hi] : [0, 0]
}
