// the h3j tile builder: a tile's cells -> hexagons (h3-js, the PR 211 unwrap) -> one geojson-vt tile (tolerance 0) ->
// MVT (vt-pbf), and the protocol action and providers around it. split from h3.ts so the main thread never loads it for
// the PMTiles form (the worker does, h3Worker.ts); see h3.ts for the rules. never imports maplibre-gl at run time.
import { getResolution } from 'h3-js'
import { geoJSONToTile } from '@maplibre/geojson-vt'
import { fromGeojsonVt } from '@maplibre/vt-pbf'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { AddProtocolAction, VectorSourceSpecification } from 'maplibre-gl'
import type { PMTiles } from 'pmtiles'
import { decodeH3jTile, H3_LAYER } from './h3.js'
import { BUFFER, CellIndex, cellRing, EXTENT, resForZoom, rollUp } from './h3Index.js'
import type { Aggregate, H3jTile, H3TileData } from './h3Index.js'

export { cellRing } from './h3Index.js'

/** the cells of tile z/x/y (one value a cell, or several columns), or null for none */
export type TileProvider = (z: number, x: number, y: number, signal: AbortSignal) => Promise<H3TileData | null>

// ---- one tile ----

/** a cell's properties: `{ h3, v }` for a one-value tile; `{ h3, <column>: value, ... }` for a multi-column one, a
 * NaN (missing) value left out, so `['has', 'es']` is the cells with an ES(50) */
function cellProperties(t: H3TileData, i: number): Record<string, string | number> {
  if ('v' in t) return { h3: t.h3[i], v: t.v[i] }
  const p: Record<string, string | number> = { h3: t.h3[i] }
  for (const k in t.columns) {
    const v = t.columns[k][i]
    if (v === v) p[k] = v
  }
  return p
}

/** the tile's cells as polygons with properties { h3, v } (or { h3, ...columns }) */
export function tileToGeoJSON(t: H3TileData): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = new Array(t.h3.length)
  for (let i = 0; i < t.h3.length; i++) {
    features[i] = { type: 'Feature', properties: cellProperties(t, i), geometry: { type: 'Polygon', coordinates: [cellRing(t.h3[i])] } }
  }
  return { type: 'FeatureCollection', features }
}

/** the geojson-vt options every tile is cut with: wrap (the copies across ±180), clip, and tolerance 0 (condition 2) */
export const TILE_OPTIONS = { extent: EXTENT, buffer: BUFFER, wrap: true, clip: true, tolerance: 0 } as const

/** one tile cut directly (geoJSONToTile, not a whole geojson-vt index per tile); no features when no cell lands in it */
export function tileFeatures(t: H3TileData, z: number, x: number, y: number) {
  return geoJSONToTile(tileToGeoJSON(t), z, x, y, TILE_OPTIONS)
}

/** one MVT tile (layer `layer`) from the cells that touch tile z/x/y; an empty buffer when none land in it */
export function tileToMvt(t: H3TileData, z: number, x: number, y: number, layer = H3_LAYER): ArrayBuffer {
  const vt = tileFeatures(t, z, x, y)
  if (!vt || !vt.features.length) return new ArrayBuffer(0)
  const pbf = fromGeojsonVt({ [layer]: vt }, { version: 2, extent: EXTENT })
  return pbf.buffer.slice(pbf.byteOffset, pbf.byteOffset + pbf.byteLength) as ArrayBuffer
}

// ---- the protocol ----

const ZXY = /\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/

/** the protocol action over one provider */
export function h3jAction(provider: TileProvider, layer = H3_LAYER): AddProtocolAction {
  return async (params, abort) => {
    const m = ZXY.exec(params.url.split('?')[0])
    if (!m) throw new Error(`h3j: no {z}/{x}/{y} in ${params.url}`)
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const t = await provider(z, x, y, abort.signal)
    return { data: t && t.h3.length ? tileToMvt(t, z, x, y, layer) : new ArrayBuffer(0) }
  }
}

/** register `<scheme>://` with `addProtocol` (the app's maplibre-gl, or `self.addProtocol` in a worker; passed in so this
 * module never imports maplibre-gl) and return the vector source that reads it; one scheme per provider (MapLibre's
 * protocol registry is global, h3j-h3t 0.9.7's lesson) */
export function h3jSource(
  addProtocol: (scheme: string, action: AddProtocolAction) => void,
  scheme: string,
  provider: TileProvider,
  opts: { name?: string; layer?: string; maxzoom?: number } = {},
): VectorSourceSpecification {
  addProtocol(scheme, h3jAction(provider, opts.layer))
  return { type: 'vector', tiles: [`${scheme}://${opts.name ?? 'cells'}/{z}/{x}/{y}`], minzoom: 0, maxzoom: opts.maxzoom ?? 6 }
}

/** a provider over a PMTiles archive of h3j tiles (range requests; the archive's tile compression is undone by pmtiles) */
export function pmtilesProvider(archive: PMTiles): TileProvider {
  return async (z, x, y, signal) => {
    const r = await archive.getZxy(z, x, y, signal)
    return r ? decodeH3jTile(r.data) : null
  }
}

/** a provider over an in-memory cell table: the cells rolled up to each zoom's resolution, indexed once per resolution */
export function cellsProvider(cells: H3jTile, opts: { aggregate?: Aggregate } = {}): TileProvider {
  const res = cells.h3.length ? getResolution(cells.h3[0]) : 0
  const byRes = new Map<number, CellIndex>()
  return async (z, x, y) => {
    const r = resForZoom(z, res)
    let idx = byRes.get(r)
    if (!idx) byRes.set(r, (idx = new CellIndex(rollUp(cells, r, opts.aggregate))))
    return idx.tile(z, x, y)
  }
}
