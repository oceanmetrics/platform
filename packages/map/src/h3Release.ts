// the h3 slot over a release: `h3ReleaseSlot({ collection, indicator, period, res })` draws a layer of the obis-h3
// release (a collection of the h3 profile 1.1) with tiles the worker builds from the release's own Parquet
// (h3Parquet.ts, loaded by setupMapLibre({ h3WorkerUrl })). the main thread resolves the file templates
// (h3ReleaseLayer.ts), mounts one vector source `h3r://<layer>/{z}/{x}/{y}` and one fill layer, and paints it:
//   - the tiles carry every indicator column, so `update({ indicator })` is a paint and filter change (`['get', 'es']`,
//     `['has', 'es']`: a cell without a value is not drawn) and fetches nothing;
//   - `update({ period })` and `update({ res })` change the tile url only when the file changes (setTiles), the worker's
//     row-group cache keeps what it read, so going back to a period reads nothing again;
//   - the colour domain is p02 to p98 of the release's stats.parquet for the layer, period, resolution and indicator
//     (h3Stats.ts, imported lazily); with res auto the fill steps with the zoom, each resolution on its own domain;
//   - `stats()` and `onStats(cb)` say what the tiles cost (requests, bytes, row groups, ms), from the messages the
//     worker posts per built tile (h3Tap.ts, BroadcastChannel 'om-h3'): totals since mount and per file. an indicator
//     change fetches nothing, so it adds nothing; a period or resolution change keeps the totals and marks the new file.
// a second slot of the same layer (another period beside it) takes `instance`, as gridSlot does. never imports
// maplibre-gl at run time.
import type { ExpressionSpecification, FilterSpecification, Map as MlMap, VectorSourceSpecification, VectorTileSource } from 'maplibre-gl'
import { H3_LAYER } from './h3.js'
import { collectionBase, periodSets, pickRes, releaseLayer, releaseMaxzoom, releaseTileUrl, resolvePeriod } from './h3ReleaseLayer.js'
import type { H3CollectionLike, H3Period, H3ReleaseLayer, H3ResRule } from './h3ReleaseLayer.js'
import type { StatsMatch, StatsRow } from './h3Stats.js'
import { listenTileStats, newTap, TileTotals } from './h3Tap.js'
import type { FileInfo, H3ReleaseStats, H3TileStats } from './h3Tap.js'
import { DEFAULT_RAMP, interpolateColors, rampStops } from './ramps.js'
import { formatLayerKey, SLOT_PREFIX } from './slot.js'
import type { LayerSlot, LayerSpec, LegendSpec } from './slot.js'

/** what a release slot shows: the indicator column, the period and the resolution rule */
export interface H3ReleaseView {
  indicator: string
  period: H3Period
  res: H3ResRule
}

/** the item the slot draws, for its legend row in stats.parquet: `{ layer: 'all' }`, `{ layer: 'eov', key: 'birds' }`,
 * `{ layer: 'taxon', key: 'Aves', rank: 'class' }` */
export interface H3ReleaseItem {
  layer: string
  key?: string
  rank?: string
}

export interface H3ReleaseSlotOptions {
  collection: H3CollectionLike
  indicator: string
  period?: H3Period
  res?: H3ResRule
  /** the url the collection's hrefs resolve against; default its self link, else the page */
  base?: string
  /** the template placeholders (default `{ layer: <item path> }` from `item`: `all`, `eov/eov=<key>`, `taxon/rank=<rank>/taxon=<key>`) */
  keys?: Record<string, string>
  /** the item (default `{ layer: 'all' }`): its path when `keys` is not given, and its legend row */
  item?: H3ReleaseItem
  /** stats.parquet; default the collection's `stats` asset, else `stats.parquet` beside it; null reads no legend */
  statsHref?: string | null
  /** a fixed colour domain for every resolution, instead of stats.parquet */
  domain?: [number, number]
  spec?: LayerSpec
  /** a second slot of one layer: its ids become `slot:h3@<instance>` and `slot:h3@<instance>:fill` */
  instance?: string
  title?: string
  credit?: string
  units?: string | null
  ramp?: string
  opacity?: number
  /** count what the tiles cost for `stats()` (default true; needs BroadcastChannel, else the counts stay at zero) */
  stats?: boolean
  /** the fetch the legend read uses (tests) */
  fetch?: typeof fetch
  onchange?: () => void
}

export interface H3ReleaseSlot extends LayerSlot {
  /** a period (the LayerSlot contract's `t`), or any of indicator, period and resolution */
  update(next: string | null | Partial<H3ReleaseView>): void
  view(): H3ReleaseView
  /** what the worker reads now */
  layer(): H3ReleaseLayer
  tileUrl(): string
  readonly ids: { source: string; fill: string }
  /** the legend at the resolution the map's zoom draws (never null: a missing stats row is its `problem`) */
  legend(): LegendSpec
  /** the legend rows read (every resolution and variable of the layer and period), or null before they arrive */
  statsRows(): StatsRow[] | null
  /** what the worker's tiles cost since the slot was mounted, in total and per file (a snapshot); zeros before the
   * first tile, and without BroadcastChannel */
  stats(): H3ReleaseStats
  /** call `cb(stats, tile)` after each built tile is counted; returns the function that stops */
  onStats(cb: (stats: H3ReleaseStats, tile: H3TileStats) => void): () => void
}

/** the ids of a release slot's source and fill */
export const h3ReleaseIds = (instance?: string) => {
  const source = instance ? `${SLOT_PREFIX}h3@${instance}` : `${SLOT_PREFIX}h3`
  return { source, fill: `${source}:fill` }
}

/** the path of a release item, the `{layer}` of the obis-h3 templates */
export function itemPath(item: H3ReleaseItem): string {
  if (item.layer === 'eov') return `eov/eov=${item.key}`
  if (item.layer === 'taxon') return `taxon/rank=${item.rank}/taxon=${item.key}`
  return item.key ? `${item.layer}/${item.layer}=${item.key}` : item.layer
}

/** the stats.parquet url of a collection */
export function statsUrl(c: H3CollectionLike, base?: string, href?: string): string {
  const h = href ?? c.assets?.stats?.href ?? 'stats.parquet'
  const b = collectionBase(c, base)
  return b ? new URL(h, b).href : h
}

/** the period a stats row is matched by: the period's set grain and value, or null */
export function periodOf(c: H3CollectionLike, p: H3Period | undefined): { grain: string; value: string } | null {
  const r = resolvePeriod(c, p)
  return r ? { grain: r.set.grain, value: r.value } : null
}

// ---- the paint ----

/** the colour domain of one indicator at each resolution from the stats rows: [p02, p98] (or [min, max] when the two
 * quantiles meet); a resolution where no cell has a value has none */
export function releaseDomains(rows: readonly StatsRow[], indicator: string): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>()
  for (const r of rows) {
    if (r.variable !== indicator || !(r.n_cells > 0)) continue
    out.set(r.res, r.p98 > r.p02 ? [r.p02, r.p98] : [r.min, r.max])
  }
  return out
}

/** the ramp over one domain on one indicator column */
const rampOn = (indicator: string, d: [number, number], ramp: string): ExpressionSpecification =>
  ['interpolate', ['linear'], ['get', indicator], ...rampStops(d[0], d[1] > d[0] ? d[1] : d[0] + 1e-9, ramp, 9)] as ExpressionSpecification

/**
 * the fill colour of a release layer: the ramp on `['get', indicator]` over the domain of the resolution a tile
 * draws. pinned (or one resolution in reach), one ramp; auto, a step on the zoom at each zoom where the resolution
 * changes (tile zoom = floor(zoom) for MapLibre's 512 px vector tiles; past maxzoom the last resolution). a
 * resolution without a domain takes the nearest one that has one; none at all gives [0, 1].
 */
export function releaseFillColor(l: H3ReleaseLayer, indicator: string, domains: Map<number, [number, number]> | [number, number], ramp = DEFAULT_RAMP): ExpressionSpecification {
  const domainOf = (res: number): [number, number] => {
    if (Array.isArray(domains)) return domains
    if (domains.has(res)) return domains.get(res)!
    const near = [...domains.keys()].sort((a, b) => Math.abs(a - res) - Math.abs(b - res) || a - b)[0]
    return near != null ? domains.get(near)! : [0, 1]
  }
  const maxzoom = releaseMaxzoom(l)
  const steps: [number, number][] = []
  for (let z = 0; z <= maxzoom; z++) {
    const r = pickRes(z, l.ladder, l.pin)
    if (!steps.length || steps[steps.length - 1][1] !== r) steps.push([z, r])
  }
  if (steps.length === 1 || Array.isArray(domains)) return rampOn(indicator, domainOf(steps[0][1]), ramp)
  const out: unknown[] = ['step', ['zoom'], rampOn(indicator, domainOf(steps[0][1]), ramp)]
  for (const [z, r] of steps.slice(1)) out.push(z, rampOn(indicator, domainOf(r), ramp))
  return out as ExpressionSpecification
}

/** a cell is drawn when it has a value of the indicator (ES(50) is missing under 50 records) */
export const releaseFilter = (indicator: string): FilterSpecification => ['has', indicator] as FilterSpecification

/** the vector source of a release layer; `promoteId: 'h3'` for hover and selection by feature state */
export const releaseSource = (l: H3ReleaseLayer): VectorSourceSpecification =>
  ({ type: 'vector', tiles: [releaseTileUrl(l)], minzoom: 0, maxzoom: releaseMaxzoom(l), promoteId: 'h3' })

// ---- the slot ----

const statsCache = new Map<string, Promise<StatsRow[]>>()

/** the h3 slot over a release (the worker form only: setupMapLibre({ h3WorkerUrl }) first) */
export function h3ReleaseSlot(opts: H3ReleaseSlotOptions): H3ReleaseSlot {
  const c = opts.collection
  const item = opts.item ?? { layer: 'all' }
  const keys = opts.keys ?? { layer: itemPath(item) }
  let view: H3ReleaseView = { indicator: opts.indicator, period: opts.period ?? null, res: opts.res ?? 'auto' }
  const tap = opts.stats === false ? undefined : newTap()
  const make = (v: H3ReleaseView) => ({ ...releaseLayer(c, { base: opts.base, keys, period: v.period, res: v.res }), ...(tap ? { tap } : {}) })
  // the period and resolution of every file a view of this slot has read (never forgotten: a tile of the old period
  // can still arrive after the move), and the files the view reads now
  const files = new Map<string, FileInfo>()
  const note = (l: H3ReleaseLayer, v: H3ReleaseView) => {
    const p = periodOf(c, v.period)
    for (const r of l.ladder) files.set(l.template.replaceAll('{res}', String(r)), { period: p, res: r })
  }
  let layer = make(view)
  note(layer, view)
  const totals = new TileTotals((f) => files.get(f), (f) => layer.ladder.some((r) => layer.template.replaceAll('{res}', String(r)) === f))
  const listeners = new Set<(s: H3ReleaseStats, t: H3TileStats) => void>()
  let stopListening: (() => void) | null = null
  const ids = h3ReleaseIds(opts.instance)
  const spec = opts.spec ?? { kind: 'h3' as const, id: c.id, variable: opts.indicator }
  const ramp = opts.ramp ?? DEFAULT_RAMP
  let map: MlMap | null = null
  let rows: StatsRow[] | null = null
  let rowsKey = ''
  let problem: string | null = null
  let shownRes: number | null = null
  const statsHref = opts.statsHref === null ? null : statsUrl(c, opts.base, opts.statsHref)

  const domains = (): Map<number, [number, number]> | [number, number] => opts.domain ?? releaseDomains(rows ?? [], view.indicator)
  const paint = () => {
    if (!map?.getLayer(ids.fill)) return
    map.setPaintProperty(ids.fill, 'fill-color', releaseFillColor(layer, view.indicator, domains(), ramp))
    map.setFilter(ids.fill, releaseFilter(view.indicator))
  }
  const matchOf = (v: H3ReleaseView): StatsMatch | null => {
    if (!statsHref) return null
    const p = periodOf(c, v.period)
    return { layer: p ? `${p.grain}_${item.layer}` : item.layer, key: item.key ?? '', rank: item.rank ?? '', period: p ? { column: p.grain, value: parseInt(p.value, 10) } : null }
  }
  const loadStats = () => {
    const m = matchOf(view)
    if (!m || opts.domain) return
    const key = `${statsHref}|${JSON.stringify(m)}`
    if (key === rowsKey) return
    rowsKey = key
    let p = statsCache.get(key)
    if (!p) {
      p = import('./h3Stats.js').then((s) => s.readReleaseStats(statsHref!, m, { fetch: opts.fetch }))
      p.catch(() => statsCache.delete(key))
      statsCache.set(key, p)
    }
    p.then((r) => {
      if (key !== rowsKey) return
      rows = r
      problem = r.length ? null : `no legend: stats.parquet has no rows for ${m.layer}${m.key ? ` ${m.key}` : ''}`
      paint()
      opts.onchange?.()
    }, (err: Error) => {
      if (key !== rowsKey) return
      problem = `no legend: ${err.message}`
      opts.onchange?.()
    })
  }
  const onZoom = () => {
    if (!map) return
    const r = pickRes(Math.min(map.getZoom(), releaseMaxzoom(layer)), layer.ladder, layer.pin)
    if (r !== shownRes) { shownRes = r; opts.onchange?.() }
  }

  const slot: H3ReleaseSlot = {
    id: formatLayerKey(spec),
    kind: 'h3',
    title: opts.title ?? spec.variable ?? opts.indicator,
    credit: opts.credit,
    ids,
    mount(m, beforeId, t) {
      map = m
      // the contract's t: a period of this collection moves the slot there; anything else (another app's date) is ignored
      if (typeof t === 'string' && t !== view.period) {
        try { const v = { ...view, period: t }, l = make(v); view = v; layer = l; note(l, v) } catch { /* not a period here */ }
      }
      totals.reset()
      stopListening?.()
      if (tap) stopListening = listenTileStats((m) => {
        totals.add(m)
        const s = totals.snapshot()
        for (const cb of [...listeners]) cb(s, m)
      }, tap)
      m.addSource(ids.source, releaseSource(layer))
      m.addLayer({
        id: ids.fill, type: 'fill', source: ids.source, 'source-layer': H3_LAYER, filter: releaseFilter(view.indicator),
        paint: { 'fill-color': releaseFillColor(layer, view.indicator, domains(), ramp), 'fill-opacity': opts.opacity ?? 0.85 },
      }, beforeId ?? undefined)
      m.on?.('zoomend', onZoom)
      onZoom()
      loadStats()
    },
    update(next) {
      const was = view
      view = typeof next === 'string' || next === null ? { ...view, period: next } : { ...view, ...next }
      const nextLayer = make(view)
      const urlWas = releaseTileUrl(layer), urlNow = releaseTileUrl(nextLayer)
      const maxzoomChanged = releaseMaxzoom(layer) !== releaseMaxzoom(nextLayer)
      layer = nextLayer
      note(layer, view)
      if (map && urlNow !== urlWas) {
        const src = map.getSource(ids.source) as VectorTileSource | undefined
        if (src && typeof src.setTiles === 'function' && !maxzoomChanged) src.setTiles([urlNow])
        else if (map.getLayer(ids.fill)) {
          // a new maxzoom needs a new source: the fill goes with it and comes back where it was
          const before = map.getStyle?.()?.layers?.map((x) => x.id)
          const at = before ? before.indexOf(ids.fill) : -1
          const beforeId = at >= 0 && before ? before[at + 1] : undefined
          map.removeLayer(ids.fill); map.removeSource(ids.source)
          map.addSource(ids.source, releaseSource(layer))
          map.addLayer({ id: ids.fill, type: 'fill', source: ids.source, 'source-layer': H3_LAYER, filter: releaseFilter(view.indicator),
            paint: { 'fill-color': releaseFillColor(layer, view.indicator, domains(), ramp), 'fill-opacity': opts.opacity ?? 0.85 } }, beforeId)
        }
      }
      if (was.indicator !== view.indicator || urlNow !== urlWas) paint()
      if (was.period !== view.period) loadStats()
      onZoom()
      opts.onchange?.()
    },
    unmount(m) {
      m.off?.('zoomend', onZoom)
      stopListening?.(); stopListening = null
      if (m.getLayer(ids.fill)) m.removeLayer(ids.fill)
      if (m.getSource(ids.source)) m.removeSource(ids.source)
      map = null
    },
    legend(): LegendSpec {
      const res = shownRes ?? pickRes(0, layer.ladder, layer.pin)
      const d = domains()
      const dom = Array.isArray(d) ? d : d.get(res) ?? null
      const row = rows?.find((r) => r.res === res && r.variable === view.indicator) ?? null
      const p = periodOf(c, view.period)
      return {
        title: slot.title, t: p ? p.value : null, via: `h3 hexagons, res ${res}, from the release's Parquet (worker)`, problem,
        units: opts.units ?? null, classes: null,
        ramp: dom ? { min: dom[0], max: dom[1], colors: interpolateColors(7, ramp) } : null,
        stats: row ? { minimum: row.min, maximum: row.max } : null,
      }
    },
    view: () => view,
    layer: () => layer,
    tileUrl: () => releaseTileUrl(layer),
    statsRows: () => rows,
    stats: () => totals.snapshot(),
    onStats(cb) {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
  return slot
}

/** the periods of a collection a period strip lists, grain by grain */
export const releasePeriods = (c: H3CollectionLike) => periodSets(c).map((s) => ({ grain: s.grain, values: [...s.values], resolutions: s.resolutions ?? c['h3:resolutions'] }))
