// the writer of a PMTiles archive of h3j tiles, run by producers (obis-h3, the atlas pipeline) once per layer: a port of
// platform spike 1's `scripts/build-pmtiles.mts`. each tile holds the h3 ids and values that touch it (the CellIndex
// lookup, with the strip across ±180) as columnar JSON, at the resolution its zoom draws (h3Index.ts RES_FOR_ZOOM: the
// pyramid carries coarser cells at low zooms, spike 1 condition 3). the archive is the minimal PMTiles v3 layout: a
// 127-byte header, a gzipped root directory (one level of leaf directories when it would not fit the first 16 KiB),
// JSON metadata, the tiles in tile-id order (clustered), tile type 0 (unknown: a custom type, `"format": "h3j"` in the
// metadata) and tile compression gzip. portable: DataView, not Buffer; gzip is CompressionStream unless the producer
// passes its own (Node: `(b) => zlib.gzipSync(b, { level: 9 })`, as the spike's 6.42 MB ES(50) archive).
import { zxyToTileId } from 'pmtiles'
import { cellToLatLng, getResolution } from 'h3-js'
import { CellIndex, cellTouchesTile, lonLatToTile, resForZoom } from './h3Index.js'
import type { H3jTile } from './h3Index.js'
import { encodeH3jTile } from './h3.js'

export type Gzip = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>

/** gzip with the platform's CompressionStream (browsers, Node >= 18) */
export async function gzipStream(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

export interface H3jArchiveOptions {
  /** the cell tables, one per resolution (a tile at zoom z takes the finest table at or under resForZoom(z), else the
   * coarsest); one table is enough when rollUp() makes the rest */
  levels: H3jTile[]
  minzoom?: number
  maxzoom?: number
  /** merged into the archive metadata (the colour `domain`, `value`, `source` ...) */
  metadata?: Record<string, unknown>
  gzip?: Gzip
}

export interface H3jArchive {
  bytes: Uint8Array
  /** tiles per zoom, and the resolution each zoom carries */
  zooms: { z: number; res: number; tiles: number }[]
  tiles: number
}

const tableRes = (t: H3jTile) => (t.h3.length ? getResolution(t.h3[0]) : -1)

/** the table a zoom draws: the finest at or under the zoom's resolution, else the coarsest */
function levelFor(levels: { res: number; idx: CellIndex }[], z: number) {
  const want = resForZoom(z)
  const under = levels.filter((l) => l.res <= want)
  return under.length ? under[under.length - 1] : levels[0]
}

/** the tiles a table can touch at zoom z: each cell's centroid tile and its eight neighbours (x wraps at ±180) */
function candidateTiles(t: H3jTile, z: number): [number, number][] {
  const n = 2 ** z, seen = new Set<number>(), out: [number, number][] = []
  for (const h of t.h3) {
    const [lat, lon] = cellToLatLng(h)
    const [cx, cy] = lonLatToTile(lon, lat, z)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = (((cx + dx) % n) + n) % n, y = cy + dy
      if (y < 0 || y >= n) continue
      const k = y * n + x
      if (!seen.has(k)) { seen.add(k); out.push([x, y]) }
    }
  }
  return out
}

/** build the archive: every tile from minzoom to maxzoom that some cell's hexagon reaches, holding only those cells */
export async function buildH3jArchive(opts: H3jArchiveOptions): Promise<H3jArchive> {
  const minzoom = opts.minzoom ?? 0, maxzoom = opts.maxzoom ?? 6
  const gzip = opts.gzip ?? gzipStream
  const levels = opts.levels.filter((l) => l.h3.length).map((t) => ({ res: tableRes(t), idx: new CellIndex(t) })).sort((a, b) => a.res - b.res)
  if (!levels.length) throw new Error('buildH3jArchive: no cells')
  const enc = new TextEncoder()
  const tiles: { tileId: number; data: Uint8Array }[] = []
  const zooms: H3jArchive['zooms'] = []
  for (let z = minzoom; z <= maxzoom; z++) {
    const { res, idx } = levelFor(levels, z)
    let nz = 0
    for (const [x, y] of candidateTiles(idx.cells, z)) {
      const loose = idx.tile(z, x, y)
      const keep = loose.h3.map((h, i) => (cellTouchesTile(h, z, x, y) ? i : -1)).filter((i) => i >= 0)
      if (!keep.length) continue
      const t = { h3: keep.map((i) => loose.h3[i]), v: keep.map((i) => loose.v[i]) }
      tiles.push({ tileId: zxyToTileId(z, x, y), data: await gzip(enc.encode(encodeH3jTile(t))) })
      nz++
    }
    zooms.push({ z, res, tiles: nz })
  }
  tiles.sort((a, b) => a.tileId - b.tileId)
  const meta = {
    format: 'h3j', encoding: 'columnar json {h3: string[], v: number[]}',
    res_for_zoom: Object.fromEntries(zooms.map((q) => [q.z, q.res])), resolutions: levels.map((l) => l.res),
    zoom_to_res: 'obis-hex zoomToRes', ...opts.metadata,
  }
  const bytes = await writePmtiles(tiles, { minzoom, maxzoom, metadata: meta, gzip })
  return { bytes, zooms, tiles: tiles.length }
}

// ---- PMTiles v3 ----

interface Entry { tileId: number; offset: number; length: number; runLength: number }

function varint(out: number[], n: number) {
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80) }
  out.push(n)
}

async function directory(entries: Entry[], gzip: Gzip): Promise<Uint8Array> {
  const o: number[] = []
  varint(o, entries.length)
  let last = 0
  for (const e of entries) { varint(o, e.tileId - last); last = e.tileId }
  for (const e of entries) varint(o, e.runLength)
  for (const e of entries) varint(o, e.length)
  entries.forEach((e, i) => varint(o, i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1))
  return gzip(new Uint8Array(o))
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

const HEADER = 127
const FIRST = 16384

/** a clustered PMTiles v3 archive of already-compressed tiles (sorted by tile id), tile type 0, gzip throughout */
export async function writePmtiles(tiles: { tileId: number; data: Uint8Array }[], o: { minzoom: number; maxzoom: number; metadata: unknown; gzip: Gzip }): Promise<Uint8Array> {
  const entries: Entry[] = []
  let offset = 0
  for (const t of tiles) { entries.push({ tileId: t.tileId, offset, length: t.data.length, runLength: 1 }); offset += t.data.length }
  let root = await directory(entries, o.gzip)
  let leaves: Uint8Array = new Uint8Array(0)
  if (HEADER + root.length > FIRST) {
    for (let size = 512; ; size *= 2) {
      const bufs: Uint8Array[] = [], rootEntries: Entry[] = []
      let lo = 0
      for (let i = 0; i < entries.length; i += size) {
        const b = await directory(entries.slice(i, i + size), o.gzip)
        rootEntries.push({ tileId: entries[i].tileId, offset: lo, length: b.length, runLength: 0 })
        bufs.push(b)
        lo += b.length
      }
      root = await directory(rootEntries, o.gzip)
      leaves = concat(bufs)
      if (HEADER + root.length <= FIRST) break
    }
  }
  const meta = await o.gzip(new TextEncoder().encode(JSON.stringify(o.metadata)))
  const data = concat(tiles.map((t) => t.data))
  const h = new DataView(new ArrayBuffer(HEADER))
  'PMTiles'.split('').forEach((c, i) => h.setUint8(i, c.charCodeAt(0)))
  h.setUint8(7, 3)
  const u64 = (pos: number, n: number) => h.setBigUint64(pos, BigInt(n), true)
  const rootOff = HEADER, metaOff = rootOff + root.length, leafOff = metaOff + meta.length, dataOff = leafOff + leaves.length
  u64(8, rootOff); u64(16, root.length); u64(24, metaOff); u64(32, meta.length)
  u64(40, leafOff); u64(48, leaves.length); u64(56, dataOff); u64(64, data.length)
  u64(72, tiles.length); u64(80, tiles.length); u64(88, tiles.length)
  h.setUint8(96, 1) // clustered
  h.setUint8(97, 2) // internal compression gzip
  h.setUint8(98, 2) // tile compression gzip
  h.setUint8(99, 0) // tile type unknown (h3j)
  h.setUint8(100, o.minzoom); h.setUint8(101, o.maxzoom)
  h.setInt32(102, -180e7, true); h.setInt32(106, -85.0511e7, true); h.setInt32(110, 180e7, true); h.setInt32(114, 85.0511e7, true)
  h.setUint8(118, o.minzoom); h.setInt32(119, 0, true); h.setInt32(123, 0, true)
  return concat([new Uint8Array(h.buffer), root, meta, leaves, data])
}
