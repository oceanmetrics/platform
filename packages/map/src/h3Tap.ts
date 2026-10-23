// what a release tile cost, from MapLibre's worker to the page. the worker's reader (h3Parquet.ts) keeps request and byte
// counts, but MapLibre's protocol action has no way to report them to the page, and the tile url (the only thing the page
// hands the worker) is one way. the package registers no other channel (setupMapLibre only importScriptInWorkers the
// worker module), so the worker posts one message per built tile on `BroadcastChannel('om-h3')` and the slot
// (h3Release.ts) listens. every call is guarded by `typeof BroadcastChannel !== 'undefined'`: where there is none, the
// layer draws as before and `stats()` stays at zero. a slot puts a random `tap` in its layer (so in its tile url), the
// worker copies it into each message, and the slot counts only messages of its own tap: another tab, another slot or
// another map of the same origin on the same channel is not counted. no h3-js, no hyparquet: both threads load it.

/** the channel the worker posts on and the page listens to */
export const H3_CHANNEL = 'om-h3'

/** one built tile's cost, as the worker posts it (structured-clone safe) */
export interface H3TileStats {
  /** the tile asked for */
  tile: { z: number; x: number; y: number }
  /** the layer file at the tile's resolution (at a split resolution the files of the parents under the tile are read
   * under this name) */
  file: string
  /** the slot that asked (the `tap` of its layer); absent for a layer a page built by hand */
  tap?: string
  /** range requests this tile made (a footer, row groups; a missing file's miss counts) */
  requests: number
  /** response body bytes of those requests */
  bytes: number
  /** row groups this tile decoded (read from the file, not from the worker's cache) */
  rowGroupsRead: number
  /** row groups its cell_id statistics ruled out */
  rowGroupsSkipped: number
  /** milliseconds from the tile request to its rows (the read; the geometry is built after) */
  ms: number
  /** no request: the footer and the row groups came from the worker's cache (or from another tile's read in flight) */
  cached: boolean
}

/** a random id for a slot's tap; undefined where there is no channel to listen on */
export const newTap = (): string | undefined =>
  typeof BroadcastChannel === 'undefined' ? undefined : Math.random().toString(36).slice(2, 10)

let poster: BroadcastChannel | null | undefined

/** post one tile's cost (the worker); a no-op without BroadcastChannel */
export function postTileStats(m: H3TileStats): void {
  if (typeof BroadcastChannel === 'undefined') return
  try { (poster ??= new BroadcastChannel(H3_CHANNEL)).postMessage(m) } catch { /* a closed or refused channel: no stats, no failure */ }
}

/** listen for tile costs (the page); returns the function that stops. `tap` keeps only that slot's messages */
export function listenTileStats(cb: (m: H3TileStats) => void, tap?: string): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const ch = new BroadcastChannel(H3_CHANNEL)
  ch.onmessage = (e: MessageEvent) => {
    const m = e.data as H3TileStats | null
    if (m && typeof m === 'object' && m.tile && (tap == null || m.tap === tap)) cb(m)
  }
  return () => ch.close()
}

// ---- the totals ----

/** the counts of one file, or of all of them */
export interface H3Counts {
  tiles: number
  /** tiles that made no request */
  cachedTiles: number
  requests: number
  bytes: number
  rowGroupsRead: number
  rowGroupsSkipped: number
  /** the sum of the tiles' ms: tiles read in parallel add up to more than the wall time */
  ms: number
}

export interface H3FileStats extends H3Counts {
  file: string
  /** the period and resolution the file is of, when it is a file of this slot's views */
  period: { grain: string; value: string } | null
  res: number | null
  /** the file the slot's view reads now (any resolution of its ladder): a period or resolution change marks the new
   * file current and keeps the old one's counts */
  current: boolean
}

export interface H3ReleaseStats extends H3Counts {
  /** the file of the latest tile counted, or null before any */
  file: string | null
  /** per file, in the order each was first read */
  files: H3FileStats[]
}

const zero = (): H3Counts => ({ tiles: 0, cachedTiles: 0, requests: 0, bytes: 0, rowGroupsRead: 0, rowGroupsSkipped: 0, ms: 0 })
const add = (c: H3Counts, m: H3TileStats): void => {
  c.tiles++
  if (m.cached) c.cachedTiles++
  c.requests += m.requests; c.bytes += m.bytes
  c.rowGroupsRead += m.rowGroupsRead; c.rowGroupsSkipped += m.rowGroupsSkipped; c.ms += m.ms
}

export interface FileInfo {
  period: { grain: string; value: string } | null
  res: number
}

/** the totals of one slot since it was mounted, and per file */
export class TileTotals {
  private total = zero()
  private byFile = new Map<string, H3Counts>()
  private latest: string | null = null

  constructor(
    /** what the slot knows of a file (its period and resolution) */
    private readonly info: (file: string) => FileInfo | undefined,
    /** whether the slot's view reads the file now */
    private readonly isCurrent: (file: string) => boolean,
  ) {}

  reset(): void { this.total = zero(); this.byFile = new Map(); this.latest = null }

  add(m: H3TileStats): void {
    add(this.total, m)
    let f = this.byFile.get(m.file)
    if (!f) this.byFile.set(m.file, (f = zero()))
    add(f, m)
    this.latest = m.file
  }

  /** a snapshot: later tiles do not change it */
  snapshot(): H3ReleaseStats {
    return {
      ...this.total, file: this.latest,
      files: [...this.byFile].map(([file, c]) => {
        const i = this.info(file)
        return { file, ...c, period: i?.period ?? null, res: i?.res ?? null, current: this.isCurrent(file) }
      }),
    }
  }
}
