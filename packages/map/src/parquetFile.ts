// a Parquet file over HTTP range requests for hyparquet, as the release provider (worker) and the legend reader (main
// thread, lazily) read the obis-h3 release: the first request asks for the file's tail with a suffix range
// (`bytes=-65536`), which gives the length (Content-Range, exposed by the bucket's CORS) and the footer in one round
// trip, with no HEAD; a file smaller than the tail comes whole. later slices inside the tail are served from it. a 403 or
// 404 is a missing file (S3 answers 403 for a key that is not there), not an error. every request and byte is counted,
// so a test can say what a tile read. ZSTD (the release's compression) through fzstd; snappy is hyparquet's own.
import { decompress } from 'fzstd'
import type { AsyncBuffer, Compressors } from 'hyparquet'

/** the decompressors the release needs beyond hyparquet's own snappy: ZSTD */
export const COMPRESSORS: Compressors = {
  ZSTD: (input: Uint8Array, outputLength: number) => decompress(input, new Uint8Array(outputLength)),
}

/** what the reads cost: requests (a miss counts), bytes of response bodies, files found missing */
export interface ReadStats {
  requests: number
  bytes: number
  missing: number
}
export const newReadStats = (): ReadStats => ({ requests: 0, bytes: 0, missing: 0 })

export interface RangeFile extends AsyncBuffer {
  url: string
  /** the bytes of the tail read first (the footer is in them) */
  tailBytes: number
}

export interface RangeFileOptions {
  fetch?: typeof fetch
  /** the suffix read first; default 64 KiB (a cell-sorted res-5 layer's footer, 68 row groups, is about 20 kB) */
  tail?: number
  stats?: ReadStats
}

export const DEFAULT_TAIL = 65_536

const isMissing = (status: number) => status === 403 || status === 404

/** open `url` for hyparquet; null when the file is not there */
export async function openRangeFile(url: string, opts: RangeFileOptions = {}): Promise<RangeFile | null> {
  const get = opts.fetch ?? globalThis.fetch
  const stats = opts.stats
  const tail = opts.tail ?? DEFAULT_TAIL
  const res = await get(url, { headers: { Range: `bytes=-${tail}` } })
  if (stats) stats.requests++
  if (isMissing(res.status)) {
    if (stats) stats.missing++
    return null
  }
  if (res.status !== 200 && res.status !== 206) throw new Error(`${url}: HTTP ${res.status}`)
  const body = await res.arrayBuffer()
  if (stats) stats.bytes += body.byteLength
  let byteLength = body.byteLength
  let tailStart = 0
  if (res.status === 206) {
    const m = /\/(\d+)\s*$/.exec(res.headers.get('Content-Range') ?? '')
    if (!m) throw new Error(`${url}: a 206 without a readable Content-Range (the bucket's CORS must expose it)`)
    byteLength = Number(m[1])
    tailStart = byteLength - body.byteLength
  }
  return {
    url,
    byteLength,
    tailBytes: body.byteLength,
    async slice(start: number, end: number = byteLength): Promise<ArrayBuffer> {
      if (start >= tailStart && end <= byteLength) return body.slice(start - tailStart, end - tailStart)
      const r = await get(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
      if (stats) stats.requests++
      if (r.status !== 200 && r.status !== 206) throw new Error(`${url} bytes ${start}-${end - 1}: HTTP ${r.status}`)
      const b = await r.arrayBuffer()
      if (stats) stats.bytes += b.byteLength
      // a server that ignores Range answers 200 with the whole file
      return r.status === 200 && b.byteLength === byteLength ? b.slice(start, end) : b
    },
  }
}
