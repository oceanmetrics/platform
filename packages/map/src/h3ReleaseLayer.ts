// which file of an obis-h3 release a tile reads: the h3 profile 1.1 collection (h3:layout, h3:periods, table:columns)
// resolved, on the main thread, into an H3ReleaseLayer (absolute templates with {res} and {parent} left open, the
// resolution ladder, the id column and the indicator columns), which travels whole inside the tile url
// `h3r://<encoded json>/{z}/{x}/{y}` to MapLibre's worker (h3Worker.ts), so the worker needs no message channel and a
// tile url names its file exactly. the rules:
//   - the period picks its set (h3:periods, one set or a list of sets: decades and years), the set's template (or
//     h3:layout.template) and the set's resolutions; no period is the all-time layer at h3:resolutions.
//   - the resolution is pinned, or auto: the finest of the ladder at or under resForZoom(z), else the ladder's coarsest.
//     never a roll-up: each resolution is its own file, and the diversity metrics do not add across cells.
//   - at a resolution in h3:layout.parent_res the layer is split by parent cell (parent_template); the worker reads the
//     parents under the tile, and the whole file once if none of them is there.
//   - placeholder values (the `keys`: layer, eov, rank, taxon ...) go into the path as given: pass them url-path-ready,
//     as the release's taxon_groups.parquet `url_path` holds them (DuckDB percent-encodes partition values on disk).
// no h3-js, no hyparquet, no maplibre-gl: both threads load it.
import { zoomToRes } from './h3Zoom.js'

// ---- the collection, structurally (the catalog's H3Fields; this package does not depend on @oceanmetrics/catalog) ----

export interface H3PeriodSetLike {
  grain: string
  values: string[]
  placeholder: string
  resolutions?: number[]
  template?: string
}

export interface H3CollectionLike {
  id: string
  links?: { rel: string; href: string }[]
  assets?: Record<string, { href: string; roles?: string[] }>
  'h3:resolutions': number[]
  'h3:cell_column': string
  'h3:cell_type': 'string' | 'uint64'
  'h3:layout': { template: string; parent_template?: string; parent_res?: Record<string, number>; keys?: string[]; row_group_rows?: number }
  'h3:periods'?: H3PeriodSetLike | H3PeriodSetLike[]
  'table:columns': { name: string; type: string }[]
}

/** a period: null (all time), a value of one set (`'1990s'`, `'2015'`), `'<grain>:<value>'`, or `{ grain, value }` */
export type H3Period = string | { grain: string; value: string } | null
/** the resolution rule: auto by zoom, or one resolution of the ladder */
export type H3ResRule = 'auto' | number

/** what the worker reads for one slot, carried in the tile url */
export interface H3ReleaseLayer {
  /** the layer file at one resolution, absolute, with {res} */
  template: string
  /** the resolutions published for this layer and period, ascending */
  ladder: number[]
  /** a pinned resolution, or null for auto */
  pin: number | null
  /** the split by parent cell, absolute, with {res} and {parent}, and the parent resolution per split resolution */
  parentTemplate?: string
  parentRes?: Record<string, number>
  /** the column the reader prunes and keys the cells by: an int64 id (cell_id) or the hex string (h3) */
  id: string
  idType: 'int64' | 'string'
  /** the indicator columns every tile carries */
  columns: string[]
}

// ---- periods ----

/** h3:periods as a list of sets (one set, profile 1.0, is a list of one; none is empty) */
export function periodSets(c: H3CollectionLike): H3PeriodSetLike[] {
  const p = c['h3:periods']
  return !p ? [] : Array.isArray(p) ? p : [p]
}

/** the set and value a period names; null for all time. throws for a value no set has, or one two sets share (pass
 * `<grain>:<value>` then) */
export function resolvePeriod(c: H3CollectionLike, period: H3Period | undefined): { set: H3PeriodSetLike; value: string } | null {
  if (period == null || period === '') return null
  const sets = periodSets(c)
  let grain: string | null = null, value: string
  if (typeof period === 'object') ({ grain, value } = period)
  else {
    const m = /^([a-z]+):(.+)$/.exec(period)
    if (m && sets.some((s) => s.grain === m[1])) [grain, value] = [m[1], m[2]]
    else value = period
  }
  const hits = sets.filter((s) => (grain == null || s.grain === grain) && s.values.includes(value))
  if (!hits.length) throw new RangeError(`${c.id}: no period ${grain ? `${grain}:` : ''}${value} in h3:periods (${sets.map((s) => `${s.grain}: ${s.values.join(', ')}`).join('; ') || 'none'})`)
  if (hits.length > 1) throw new RangeError(`${c.id}: period ${value} is in ${hits.map((s) => s.grain).join(' and ')}; pass "${hits[0].grain}:${value}"`)
  return { set: hits[0], value }
}

// ---- templates ----

const OPEN = new Set(['res', 'parent'])

/** a template with every placeholder but {res} and {parent} filled; throws naming a placeholder with no value */
export function fillTemplate(template: string, values: Record<string, string>): string {
  const missing: string[] = []
  const out = template.replace(/\{([A-Za-z_][\w]*)\}/g, (all, k: string) => {
    if (OPEN.has(k)) return all
    if (values[k] == null) { missing.push(k); return all }
    return values[k]
  })
  if (missing.length) throw new Error(`template ${template}: no value for {${missing.join('}, {')}}`)
  return out
}

/** a path made absolute against `base`, its {res} and {parent} kept (new URL percent-encodes the braces) */
export function absoluteTemplate(path: string, base: string | undefined): string {
  if (!base) return path
  return new URL(path, base).href.replace(/%7B(res|parent)%7D/gi, '{$1}')
}

/** the collection's base: its `self` link, else the page */
export const collectionBase = (c: H3CollectionLike, base?: string): string | undefined =>
  base ?? c.links?.find((l) => l.rel === 'self')?.href ?? globalThis.location?.href

// ---- the columns ----

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|INT\d+|UINT\d+|FLOAT|REAL|DOUBLE|DECIMAL.*|NUMERIC.*)$/i
const INTEGER = /^(BIGINT|UBIGINT|INT64|UINT64|HUGEINT)$/i

/** the id column: an integer `cell_id` when the table has one (smaller to read, and its statistics prune), else
 * h3:cell_column as h3:cell_type says */
export function idColumn(c: H3CollectionLike): { id: string; idType: 'int64' | 'string' } {
  const cols = c['table:columns']
  const int = cols.find((k) => k.name === 'cell_id' && INTEGER.test(k.type))
  if (int) return { id: int.name, idType: 'int64' }
  return { id: c['h3:cell_column'], idType: c['h3:cell_type'] === 'uint64' ? 'int64' : 'string' }
}

/** the indicator columns: the numeric table:columns that are not the cell id */
export function indicatorColumns(c: H3CollectionLike): string[] {
  const skip = new Set(['h3', 'cell_id', c['h3:cell_column'], ...(c['h3:layout'].keys ?? [])])
  return c['table:columns'].filter((k) => !skip.has(k.name) && NUMERIC.test(k.type)).map((k) => k.name)
}

// ---- the layer ----

export interface ReleaseLayerOptions {
  /** the url the collection's hrefs resolve against; default its self link, else the page */
  base?: string
  /** the template placeholders other than {res}, {parent} and the period's: `{ layer: 'all' }`, `{ layer: 'eov/eov=birds' }` */
  keys?: Record<string, string>
  period?: H3Period
  res?: H3ResRule
}

/** what a slot's tiles read: the collection, the keys, the period and the resolution rule resolved */
export function releaseLayer(c: H3CollectionLike, opts: ReleaseLayerOptions = {}): H3ReleaseLayer {
  const layout = c['h3:layout']
  const p = resolvePeriod(c, opts.period)
  const values = { ...(opts.keys ?? {}), ...(p ? { [p.set.placeholder]: p.value } : {}) }
  const base = collectionBase(c, opts.base)
  const ladder = [...(p?.set.resolutions ?? c['h3:resolutions'])].sort((a, b) => a - b)
  const res = opts.res ?? 'auto'
  if (res !== 'auto' && !ladder.includes(res))
    throw new RangeError(`${c.id}: resolution ${res} is not published${p ? ` for ${p.set.grain} ${p.value}` : ''} (${ladder.join(', ')})`)
  const out: H3ReleaseLayer = {
    template: absoluteTemplate(fillTemplate(p?.set.template ?? layout.template, values), base),
    ladder, pin: res === 'auto' ? null : res, ...idColumn(c), columns: indicatorColumns(c),
  }
  // the parent split belongs to the layout's own template: a period set with a template of its own has no split
  const split = layout.parent_template && layout.parent_res && !p?.set.template
    ? Object.fromEntries(Object.entries(layout.parent_res).filter(([r]) => ladder.includes(Number(r))))
    : {}
  if (Object.keys(split).length) {
    out.parentTemplate = absoluteTemplate(fillTemplate(layout.parent_template!, values), base)
    out.parentRes = split
  }
  return out
}

// ---- the resolution per tile ----

/** the resolution a tile at zoom z reads: the pin, else the finest of the ladder at or under resForZoom(z), else the
 * ladder's coarsest (finer cells, drawn as they are: never a roll-up) */
export function pickRes(z: number, ladder: readonly number[], pin: number | null = null): number {
  if (pin != null) return pin
  const want = zoomToRes(Math.floor(z))
  let best = -1
  for (const r of ladder) if (r <= want && r > best) best = r
  return best >= 0 ? best : Math.min(...ladder)
}

/** the first tile zoom that draws `res` in the auto rule */
export function zoomForRes(res: number): number {
  for (let z = 0; z <= 22; z++) if (zoomToRes(z) >= res) return z
  return 22
}

/** the source maxzoom: the zoom where the finest resolution starts, at least 6 (an overzoomed z0 tile is too coarse a
 * geometry at street zooms) */
export const releaseMaxzoom = (l: H3ReleaseLayer): number => Math.max(6, zoomForRes(l.pin ?? Math.max(...l.ladder)))

/** the file a tile at zoom z reads: the whole layer at its resolution, or the split by parent cell */
export function releaseFile(l: H3ReleaseLayer, z: number):
  | { res: number; url: string; split?: undefined }
  | { res: number; url: string; split: { parentRes: number; url: (parent: string) => string } } {
  const res = pickRes(z, l.ladder, l.pin)
  const url = l.template.replaceAll('{res}', String(res))
  const parentRes = l.parentRes?.[String(res)]
  if (parentRes == null || !l.parentTemplate) return { res, url }
  const tpl = l.parentTemplate.replaceAll('{res}', String(res))
  return { res, url, split: { parentRes, url: (parent) => tpl.replaceAll('{parent}', parent) } }
}

// ---- the tile url ----

export const H3R_SCHEME = 'h3r'

/** the tile url template of a release layer: `h3r://<encoded json>/{z}/{x}/{y}` */
export const releaseTileUrl = (l: H3ReleaseLayer): string => `${H3R_SCHEME}://${encodeURIComponent(JSON.stringify(l))}/{z}/{x}/{y}`

/** the layer key (the encoded json) of a release tile request; null for another url */
export function releaseKeyOf(url: string): string | null {
  const m = new RegExp(`^${H3R_SCHEME}://([^/]+)/\\d+/\\d+/\\d+`).exec(url)
  return m ? m[1] : null
}

/** the layer of a release tile request; null for another url */
export function parseReleaseTileUrl(url: string): H3ReleaseLayer | null {
  const k = releaseKeyOf(url)
  return k ? (JSON.parse(decodeURIComponent(k)) as H3ReleaseLayer) : null
}
