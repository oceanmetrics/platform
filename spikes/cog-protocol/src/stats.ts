// legend histogram, view statistics and point reads with geotiff.js: what the protocol does not
// give. Reads go through a counting client (as erddap-places' thenNow/cog.ts) so each operation
// reports its own bytes and requests.
import { BaseClient, BaseResponse, fromCustomClient, Pool, type GeoTIFF, type GeoTIFFImage } from 'geotiff'

export const N_BUCKETS = 32
const R = 6378137

export class Meter {
  bytes = 0; requests = 0
  reset() { this.bytes = 0; this.requests = 0 }
  snap() { return { bytes: this.bytes, requests: this.requests } }
}

class CountingClient extends BaseClient {
  constructor(url: string, private meter: Meter) { super(url) }
  async request(init: RequestInit = {}): Promise<BaseResponse> {
    const res = await fetch(this.url, { headers: init.headers, signal: init.signal })
    const buf = await res.arrayBuffer()
    this.meter.bytes += buf.byteLength; this.meter.requests += 1
    const out = new BaseResponse()
    Object.defineProperty(out, 'ok', { get: () => res.ok })
    Object.defineProperty(out, 'status', { get: () => res.status })
    ;(out as any).getHeader = (h: string) => res.headers.get(h) ?? undefined
    ;(out as any).getData = async () => buf
    return out
  }
}

export const meter = new Meter()
const tiffs = new Map<string, Promise<GeoTIFF>>()

let blockSize = 16384
/** the block size of files opened from now on (geotiff merges consecutive blocks into one request). */
export function setBlockSize(n: number) { blockSize = n }

/** open a COG once; 16 kB blocks by default (header plus a tile or two per read). */
export function open(url: string): Promise<GeoTIFF> {
  let t = tiffs.get(url)
  if (!t) {
    t = fromCustomClient(new CountingClient(url, meter) as any, { blockSize, maxRanges: 0 } as any)
    tiffs.set(url, t)
  }
  return t
}

export interface BandStats {
  band: number; minimum: number; maximum: number; mean: number; stddev: number; valid_percent: number
  valid: number; pixels: number
  histogram: { count: number; min: number; max: number; buckets: number[] }
  histogram_ref_edges?: { count: number; min: number; max: number; buckets: number[] }
}

function hist(v: ArrayLike<number>, nodata: number | null, lo: number, hi: number): number[] {
  const b = new Array(N_BUCKETS).fill(0), span = hi > lo ? hi - lo : 1
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (x === nodata || x !== x) continue
    let k = Math.floor((x - lo) / span * N_BUCKETS)
    k = k < 0 ? 0 : k > N_BUCKETS - 1 ? N_BUCKETS - 1 : k
    b[k]++
  }
  return b
}

/** min, max, mean, population stddev, valid_percent and a 32-bucket histogram of one band. */
export function bandStats(v: ArrayLike<number>, nodata: number | null, band: number, refEdges?: [number, number]): BandStats {
  let n = 0, lo = Infinity, hi = -Infinity, sum = 0, sum2 = 0
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (x === nodata || x !== x) continue
    n++; sum += x; sum2 += x * x
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  const mean = n ? sum / n : NaN
  const out: BandStats = {
    band, minimum: lo, maximum: hi, mean, stddev: n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : NaN,
    valid_percent: 100 * n / v.length, valid: n, pixels: v.length,
    histogram: { count: N_BUCKETS, min: lo, max: hi, buckets: hist(v, nodata, lo, hi) },
  }
  if (refEdges) out.histogram_ref_edges = { count: N_BUCKETS, min: refEdges[0], max: refEdges[1], buckets: hist(v, nodata, refEdges[0], refEdges[1]) }
  return out
}

interface Lattice { crs: number; bbox: [number, number, number, number]; images: { w: number; h: number; res: number }[]; bands: number; nodata: number | null }

/** the image pyramid: full resolution first, then the overviews, with their resolutions. */
export async function lattice(url: string): Promise<Lattice> {
  const tiff = await open(url)
  const img0 = await tiff.getImage(0)
  const n = await tiff.getImageCount()
  const bbox = img0.getBoundingBox() as [number, number, number, number]
  const keys: any = img0.getGeoKeys() ?? {}
  const crs = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? 0
  const images = []
  for (let i = 0; i < n; i++) {
    const im = i === 0 ? img0 : await tiff.getImage(i)
    images.push({ w: im.getWidth(), h: im.getHeight(), res: (bbox[2] - bbox[0]) / im.getWidth() })
  }
  return { crs, bbox, images, bands: img0.getSamplesPerPixel(), nodata: img0.getGDALNoData() }
}

/** whole-image statistics of the smallest overview (image n-1), every band. */
export async function overviewStats(url: string, refEdges?: [number, number][]) {
  meter.reset()
  const t0 = performance.now()
  const tiff = await open(url)
  const L = await lattice(url)
  const i = L.images.length - 1
  const img: GeoTIFFImage = await tiff.getImage(i)
  const t1 = performance.now()
  const r: any = await img.readRasters()
  const t2 = performance.now()
  const bands = (r as any[]).map((v, b) => bandStats(v, L.nodata, b + 1, refEdges?.[b]))
  const t3 = performance.now()
  return { url, image: i, width: L.images[i].w, height: L.images[i].h, crs: L.crs,
    ms: { open: t1 - t0, read: t2 - t1, compute: t3 - t2, total: t3 - t0 }, ...meter.snap(), bands }
}

const merc = (lon: number, lat: number): [number, number] =>
  [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 360))]

/** bounds [w, s, e, n] in lon/lat to the file's CRS (4326 or 3857). */
function toCrs(crs: number, b: [number, number, number, number]): [number, number, number, number] {
  if (crs !== 3857) return b
  const [x0, y0] = merc(b[0], b[1]), [x1, y1] = merc(b[2], b[3])
  return [x0, y0, x1, y1]
}

/** statistics of the current view: the window of the image whose resolution is closest (in log
 * ratio) to the screen's, every band. */
let pool: Pool | undefined
export async function viewStats(url: string, bounds: [number, number, number, number], screenPx: number,
  opts: { band?: number; pool?: boolean } = {}) {
  meter.reset()
  const t0 = performance.now()
  const tiff = await open(url)
  const L = await lattice(url)
  const vb = toCrs(L.crs, bounds)
  const target = (vb[2] - vb[0]) / screenPx
  let i = 0, best = Infinity
  L.images.forEach((im, k) => { const d = Math.abs(Math.log(im.res / target)); if (d < best) { best = d; i = k } })
  const im = L.images[i], [W, S, E, N] = L.bbox
  const rx = (E - W) / im.w, ry = (N - S) / im.h
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  const win = [clamp(Math.floor((vb[0] - W) / rx), im.w), clamp(Math.floor((N - vb[3]) / ry), im.h),
               clamp(Math.ceil((vb[2] - W) / rx), im.w), clamp(Math.ceil((N - vb[1]) / ry), im.h)]
  const img = await tiff.getImage(i)
  const t1 = performance.now()
  if (opts.pool && !pool) pool = new Pool()
  const ro: any = { window: win, ...(opts.band ? { samples: [opts.band - 1] } : {}), ...(opts.pool ? { pool } : {}) }
  const r: any = win[2] > win[0] && win[3] > win[1] ? await img.readRasters(ro) : []
  const t2 = performance.now()
  const bands = (r as any[]).map((v, b) => bandStats(v, L.nodata, opts.band ?? b + 1))
  const t3 = performance.now()
  return { url, opts, image: i, imageSize: [im.w, im.h], window: win, targetRes: target, imageRes: im.res,
    ms: { open: t1 - t0, read: t2 - t1, compute: t3 - t2, total: t3 - t0 }, ...meter.snap(), bands }
}

/** every band of the full-resolution pixel under lon/lat, in one window read (the flower hook). */
export async function pointValues(url: string, lon: number, lat: number) {
  meter.reset()
  const t0 = performance.now()
  const tiff = await open(url)
  const L = await lattice(url)
  const [x, y] = L.crs === 3857 ? merc(lon, lat) : [lon, lat]
  const [W, , , N] = L.bbox, res = L.images[0].res
  const col = Math.floor((x - W) / res), row = Math.floor((N - y) / res)
  const img = await tiff.getImage(0)
  const t1 = performance.now()
  const r: any = await img.readRasters({ window: [col, row, col + 1, row + 1] })
  const t2 = performance.now()
  const values = (r as any[]).map(v => (v[0] === L.nodata ? NaN : v[0]))
  return { url, col, row, values, ms: { open: t1 - t0, read: t2 - t1, total: t2 - t0 }, ...meter.snap() }
}
