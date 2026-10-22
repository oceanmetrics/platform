// the cog provider: a Cloud-Optimized GeoTIFF drawn in the browser by @geomatico/maplibre-cog-protocol (`cog://<href>#...`),
// with no tile server. the rules are platform spike 3's conditions (2026-10-22):
//   1. the legend's numbers come from STAC (`statistics`, `histogram` on `bands` or `raster:bands`, written at publish
//      from the full-resolution 4326 source), never from an overview: an overview's mean was +35% off on the EOV file.
//      the smallest overview may give the histogram's shape only (`overviewHistogram`).
//   2. point values read the 4326 original with geotiff.js (`pointValue`), not the 3857 copy: the warp's nearest
//      resampling moved 54 of 900 pixels by up to 0.37 px.
//   3. the protocol draws only an asset whose `proj:code` is EPSG:3857: a 4326 file does not fail, it draws silently in
//      the wrong place. `cogSlot` refuses anything else with a `CogProjectionError` naming the asset.
// the colour comes from the asset's `atlas:colormap` (a ramps.ts id) and `atlas:rescale` (or the band statistics); the
// nodata of the band (STAC, else the file's own GDAL_NODATA, and NaN) is transparent.
import { fromUrl } from 'geotiff'
import type { BlockedSourceOptions, GeoTIFF, GeoTIFFImage, RemoteSourceOptions } from 'geotiff'
import { loadCogProtocol } from './maplibre.js'
import { colorAt, DEFAULT_RAMP, interpolateColors, rampColors, rampHex } from './ramps.js'
import { formatLayerKey, SLOT_PREFIX } from './slot.js'
import type { LayerSlot, LayerSpec, LegendSpec, LegendStats } from './slot.js'

// ---- the STAC shapes read here (structurally the catalog's `cog` profile: CogDataAsset, CogBand) ----

export type StacNodata = number | 'nan' | 'inf' | '-inf' | null
export interface CogBandLike {
  name?: string
  description?: string
  unit?: string
  nodata?: StacNodata
  statistics?: LegendStats & Record<string, unknown>
  histogram?: { count: number; min: number; max: number; buckets: number[] }
  [key: string]: unknown
}
export interface CogAsset {
  href: string
  type?: string
  title?: string
  roles?: string[]
  'proj:code'?: string | null
  bands?: CogBandLike[]
  'raster:bands'?: CogBandLike[]
  'atlas:bidx'?: number
  'atlas:rescale'?: [number, number] | 'auto'
  'atlas:colormap'?: string
  [key: string]: unknown
}
export interface CogItemLike {
  id?: string
  properties?: { 'proj:code'?: string | null; [key: string]: unknown }
  assets: Record<string, CogAsset>
}

export const WEB_MERCATOR = 'EPSG:3857'

/** a COG the protocol must not draw: its `proj:code` is not EPSG:3857 */
export class CogProjectionError extends Error {
  constructor(readonly asset: string, readonly projCode: string | null) {
    super(`cog asset "${asset}" is ${projCode ?? 'without proj:code'}, not ${WEB_MERCATOR}: the cog protocol would draw it in the wrong place; draw its ${WEB_MERCATOR} copy`)
    this.name = 'CogProjectionError'
  }
}

/** spike 3 condition 3: throws unless the asset (or, failing that, its item) says EPSG:3857 */
export function assertWebMercator(asset: CogAsset, name: string = asset.title ?? asset.href, itemProjCode?: string | null): void {
  const code = asset['proj:code'] ?? itemProjCode ?? null
  if (code !== WEB_MERCATOR) throw new CogProjectionError(name, code)
}

const isData = (a: CogAsset) => !a.roles || a.roles.includes('data')
const projOf = (a: CogAsset, item: CogItemLike) => a['proj:code'] ?? item.properties?.['proj:code'] ?? null

/** an item's two data assets: the 3857 copy the protocol draws, and the original the numbers are read from */
export function pickCogAssets(item: CogItemLike): { draw: { key: string; asset: CogAsset } | null; values: { key: string; asset: CogAsset } | null } {
  const data = Object.entries(item.assets).filter(([, a]) => isData(a))
  const draw = data.find(([, a]) => projOf(a, item) === WEB_MERCATOR)
  const values = data.find(([, a]) => projOf(a, item) !== WEB_MERCATOR) ?? draw
  return { draw: draw ? { key: draw[0], asset: draw[1] } : null, values: values ? { key: values[0], asset: values[1] } : null }
}

/** the asset's bands (STAC 1.1 `bands`, else raster 1.1 `raster:bands`) */
export const cogBands = (a: CogAsset): CogBandLike[] => a.bands ?? a['raster:bands'] ?? []
/** the 1-based band drawn (`atlas:bidx`, default 1) and its STAC entry */
export function cogBand(a: CogAsset): { index: number; band: CogBandLike | null } {
  const index = a['atlas:bidx'] ?? 1
  return { index, band: cogBands(a)[index - 1] ?? null }
}

/** STAC nodata as a number (null = none) */
export function nodataValue(v: StacNodata | undefined): number | null {
  if (v === undefined || v === null) return null
  if (v === 'nan') return NaN
  if (v === 'inf') return Infinity
  if (v === '-inf') return -Infinity
  return v
}

/** the colour domain: `atlas:rescale` when it is a pair, else the band's STAC statistics; null when neither says */
export function cogRange(a: CogAsset): [number, number] | null {
  const r = a['atlas:rescale']
  if (Array.isArray(r)) return [r[0], r[1]]
  const s = cogBand(a).band?.statistics
  return s && Number.isFinite(s.minimum) && Number.isFinite(s.maximum) ? [s.minimum, s.maximum] : null
}

/** the protocol url: `cog://<href>#color:["#..",..],<min>,<max>,c` (the protocol's custom-colours grammar, continuous);
 * the hash also keys MapLibre's tile cache, so a new ramp or range draws new tiles */
export function cogUrl(a: CogAsset, range: [number, number] | null = cogRange(a)): string {
  const [lo, hi] = range ?? [0, 1]
  return `cog://${a.href}#color:${JSON.stringify(rampHex(a['atlas:colormap'] ?? DEFAULT_RAMP))},${lo},${hi},c`
}

/** the protocol's colour function for one band: the ramp over [min, max], nodata, the file's noData and NaN transparent.
 * pixel is every band of one pixel; color is the RGBA to fill */
export function cogColorFunction(o: { band?: number; min: number; max: number; ramp?: string; nodata?: number | null; alpha?: number }) {
  const stops = rampColors(o.ramp ?? DEFAULT_RAMP)
  const span = o.max > o.min ? o.max - o.min : 1
  const nd = o.nodata ?? null
  const ndf = nd === null || !Number.isFinite(nd) ? nd : Math.fround(nd)
  const alpha = o.alpha ?? 255
  const k = (o.band ?? 1) - 1
  return (pixel: ArrayLike<number>, color: Uint8ClampedArray, metadata: { noData?: number } = {}) => {
    const v = pixel[k]
    if (v !== v || v === nd || v === ndf || v === metadata.noData || !Number.isFinite(v)) { color[3] = 0; return }
    const [r, g, b] = colorAt(stops, (v - o.min) / span)
    color[0] = r; color[1] = g; color[2] = b; color[3] = alpha
  }
}

/** spike 3 condition 1: the legend from STAC alone (statistics and histogram), never from an overview */
export function legendFromStac(a: CogAsset, o: { title?: string; t?: string | null; via?: string; problem?: string | null } = {}): LegendSpec {
  const { band } = cogBand(a)
  const range = cogRange(a)
  const s = band?.statistics
  const stats: LegendStats | null = s ? {
    minimum: s.minimum, maximum: s.maximum,
    ...(s.mean !== undefined ? { mean: s.mean } : {}),
    ...(s.stddev !== undefined ? { stddev: s.stddev } : {}),
    ...(s.valid_percent !== undefined ? { valid_percent: s.valid_percent } : {}),
  } : null
  const h = band?.histogram
  return {
    title: o.title ?? band?.description ?? a.title ?? a.href,
    t: o.t ?? null,
    via: o.via ?? `COG, ${WEB_MERCATOR} copy`,
    problem: o.problem ?? (range ? null : 'no statistics in the STAC asset'),
    units: band?.unit ?? null,
    ramp: range ? { min: range[0], max: range[1], colors: interpolateColors(7, a['atlas:colormap'] ?? DEFAULT_RAMP) } : null,
    classes: null,
    histogram: h ? { min: h.min, max: h.max, buckets: [...h.buckets] } : null,
    stats,
  }
}

// ---- reads with geotiff.js ----

const tiffs = new Map<string, Promise<GeoTIFF>>()
/** a COG opened once per url (16 kB blocks: the header plus a tile or two per read), or a GeoTIFF given as is */
export function openCog(source: string | GeoTIFF): Promise<GeoTIFF> {
  if (typeof source !== 'string') return Promise.resolve(source)
  let t = tiffs.get(source)
  if (!t) {
    // geotiff.js passes blockSize on to its blocked source (spike 3 measured 16 kB); maxRanges 0 = no multipart ranges
    t = fromUrl(source, { blockSize: 16384, maxRanges: 0 } as RemoteSourceOptions & BlockedSourceOptions)
    tiffs.set(source, t)
    t.catch(() => tiffs.delete(source))
  }
  return t
}

const isMask = (img: GeoTIFFImage) => {
  try { return ((img.fileDirectory.getValue('NewSubfileType') as number | undefined ?? 0) & 4) !== 0 } catch { return false }
}

/** equal-width buckets of the valid values of one array (nodata and NaN left out); a value outside [lo, hi] is clamped */
export function bucketCounts(v: ArrayLike<number>, nodata: number | null, lo: number, hi: number, n = 32): number[] {
  const b = new Array<number>(n).fill(0)
  const span = hi > lo ? hi - lo : 1
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (x !== x || x === nodata) continue
    let k = Math.floor(((x - lo) / span) * n)
    k = k < 0 ? 0 : k > n - 1 ? n - 1 : k
    b[k]++
  }
  return b
}

export interface OverviewHistogram { image: number; width: number; height: number; min: number; max: number; buckets: number[]; valid: number; pixels: number }

/** the shape of a band's distribution from the smallest overview (one small read); bucketed over `range` (the STAC
 * statistics, so the shape lines up with the legend's numbers) or the overview's own min and max */
export async function overviewHistogram(source: string | GeoTIFF, o: { band?: number; buckets?: number; range?: [number, number]; nodata?: number | null } = {}): Promise<OverviewHistogram> {
  const tiff = await openCog(source)
  const n = await tiff.getImageCount()
  let img = await tiff.getImage(n - 1), i = n - 1
  while (i > 0 && isMask(img)) img = await tiff.getImage(--i)
  const nodata = o.nodata !== undefined ? o.nodata : img.getGDALNoData()
  const [v] = (await img.readRasters({ samples: [(o.band ?? 1) - 1] })) as unknown as ArrayLike<number>[]
  let lo = Infinity, hi = -Infinity, valid = 0
  for (let k = 0; k < v.length; k++) {
    const x = v[k]
    if (x !== x || x === nodata) continue
    valid++
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  const [min, max] = o.range ?? (valid ? [lo, hi] : [0, 0])
  return { image: i, width: img.getWidth(), height: img.getHeight(), min, max, buckets: bucketCounts(v, nodata, min, max, o.buckets ?? 32), valid, pixels: v.length }
}

const R = 6378137
const merc = (lon: number, lat: number): [number, number] =>
  [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 360))]

/** spike 3 condition 2: every band of the full-resolution pixel under [lon, lat], in one window read, from the 4326
 * original (the 3857 copy is converted to, but its values may sit a pixel edge off); nodata as NaN; null outside */
export async function pointValue(source: string | GeoTIFF, [lon, lat]: [number, number]): Promise<number[] | null> {
  const tiff = await openCog(source)
  const img = await tiff.getImage(0)
  const keys = (img.getGeoKeys() ?? {}) as Record<string, number | undefined>
  const crs = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? 4326
  const [x, y] = crs === 3857 ? merc(lon, lat) : [lon, lat]
  const [w, , , n] = img.getBoundingBox()
  const [rx, ry] = img.getResolution()
  const col = Math.floor((x - w) / rx), row = Math.floor((n - y) / Math.abs(ry))
  if (col < 0 || row < 0 || col >= img.getWidth() || row >= img.getHeight()) return null
  const nodata = img.getGDALNoData()
  const r = (await img.readRasters({ window: [col, row, col + 1, row + 1] })) as unknown as ArrayLike<number>[]
  return r.map((v) => (v[0] === nodata ? NaN : v[0]))
}

// ---- the slot ----

export interface CogSlotOptions {
  title?: string
  credit?: string
  /** the asset's key in its item, for the error and the legend */
  name?: string
  /** the item's proj:code, when the asset does not carry its own */
  itemProjCode?: string | null
  opacity?: number
  onchange?: () => void
}

export const COG_SOURCE = `${SLOT_PREFIX}cog`
export const COG_LAYER = `${SLOT_PREFIX}cog:raster`

/** the cog slot: one raster source through cog://, coloured from the asset's hints, under `beforeId`. throws a
 * CogProjectionError at once for an asset that is not EPSG:3857. a COG is one period: update(t) only records t */
export function cogSlot(spec: LayerSpec, asset: CogAsset, opts: CogSlotOptions = {}): LayerSlot {
  const name = opts.name ?? asset.title ?? asset.href
  assertWebMercator(asset, name, opts.itemProjCode)
  const range = cogRange(asset)
  const { index, band } = cogBand(asset)
  const title = opts.title ?? band?.description ?? asset.title ?? spec.id
  let t: string | null = null
  let problem: string | null = null
  const onError = (e: { sourceId?: string; error?: { message?: string } }) => {
    if (e.sourceId !== COG_SOURCE || problem) return
    problem = `no tiles from ${hostOf(asset.href)}`
    opts.onchange?.()
  }
  return {
    id: formatLayerKey(spec),
    kind: 'cog',
    title,
    credit: opts.credit,
    mount(m, beforeId, t0) {
      t = t0
      const [lo, hi] = range ?? [0, 1]
      // the colour function covers what the url's hash cannot: a band other than 1, STAC nodata the file may not declare
      void loadCogProtocol().then((p) => p.setColorFunction(asset.href, cogColorFunction({ band: index, min: lo, max: hi, ramp: asset['atlas:colormap'], nodata: nodataValue(band?.nodata) })))
      m.addSource(COG_SOURCE, { type: 'raster', url: cogUrl(asset, range), tileSize: 256 })
      m.addLayer({ id: COG_LAYER, type: 'raster', source: COG_SOURCE, paint: { 'raster-opacity': opts.opacity ?? 0.85, 'raster-resampling': 'nearest' } }, beforeId ?? undefined)
      m.on('error', onError)
    },
    update(t1) { t = t1 },
    unmount(m) {
      m.off('error', onError)
      if (m.getLayer(COG_LAYER)) m.removeLayer(COG_LAYER)
      if (m.getSource(COG_SOURCE)) m.removeSource(COG_SOURCE)
      void loadCogProtocol().then((p) => p.setColorFunction(asset.href, undefined))
    },
    legend() {
      return legendFromStac(asset, { title, t, problem })
    },
  }
}

const hostOf = (href: string) => { try { return new URL(href).host } catch { return href } }
