// the layer slot: one raster, grid or hexagon layer drawn under an app's places, at the period `t` the app's hash shares
// with every view. a slot is a small object (mount, update, unmount, legend) made by the factory of its kind. moved in
// from indicators `viewer/src/lib/map/layerSlot.ts` (Day 6) for build week 2; the kinds are this package's providers:
// `grid` (a slab's step as squares, grid.ts), `cog` (a Cloud-Optimized GeoTIFF through the cog:// protocol, cog.ts) and
// `h3` (hexagons from h3j tiles, h3.ts). the hash key is `layer=<kind>:<id>[:<variable>]` (`layer=grid:dhw_5km:CRW_SST`);
// `erddap` (Day 6's ERDDAP WMS kind) still parses, as a deprecated alias of `grid`. plain rules, no MapLibre at run time.
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl'

export type SlotKind = 'grid' | 'cog' | 'h3'
export const SLOT_KINDS: readonly SlotKind[] = ['grid', 'cog', 'h3']
/** kinds the parser still accepts, and the kind each stands for: indicators' Day 6 links say `erddap:` */
export const SLOT_KIND_ALIASES: Readonly<Record<string, SlotKind>> = { erddap: 'grid' }

/** what the hash's `layer` names: a kind, the dataset (or asset) id, and the variable when the dataset has several */
export interface LayerSpec {
  kind: SlotKind
  id: string
  variable: string | null
}

/** one class of a categorical layer, as the legend lists it */
export interface LegendClass {
  value: string | number
  label: string
  color: string
}

/** the numbers the legend states (from STAC `statistics` for a COG, from the slice for a grid) */
export interface LegendStats {
  minimum: number
  maximum: number
  mean?: number
  stddev?: number
  valid_percent?: number
}

/** what the legend says of the layer: its title, the time it asked for, how it is drawn, why nothing shows, and its scale */
export interface LegendSpec {
  title: string
  /** the period start the layer draws ("2024-07-01"); null = the dataset's latest */
  t: string | null
  /** how it is drawn ("grid slice, DuckDB-WASM", "COG, EPSG:3857 copy") */
  via: string
  /** set when nothing came back ("no tiles from coastwatch.pfeg.noaa.gov") */
  problem: string | null
  units?: string | null
  /** a continuous scale: the colours low to high over [min, max] */
  ramp?: { min: number; max: number; colors: string[] } | null
  /** a categorical scale, in legend order */
  classes?: LegendClass[] | null
  /** the distribution of the values, equal-width buckets from min to max (its shape; the numbers are `stats`) */
  histogram?: { min: number; max: number; buckets: number[] } | null
  stats?: LegendStats | null
}

export interface LayerSlot {
  id: string
  kind: SlotKind
  title: string
  credit?: string
  /** add the slot's sources and layers (every id prefixed `slot:`) under `beforeId`, at `t` (a period start; null = the latest) */
  mount(map: MlMap, beforeId: string | null, t: string | null): void
  /** draw another period. a kind may take more: the h3 release slot (h3Release.ts) also takes
   * `{ indicator?, period?, res? }`, a string or null still being the period */
  update(t: string | null): void
  /** remove what mount added */
  unmount(map: MlMap): void
  legend(): LegendSpec | null
}

export interface SlotOptions {
  fetch?: typeof fetch
  /** called when the legend changes (a tile error, a new period, the data arriving) */
  onchange?: () => void
}

export type SlotFactory = (spec: LayerSpec, opts: SlotOptions) => Promise<LayerSlot>

// ---- the key codec ----

const PART = /^[A-Za-z0-9_.-]+$/

/** the kind a key's first part names, its alias resolved; null for anything else */
function kindOf(s: string): SlotKind | null {
  if ((SLOT_KINDS as readonly string[]).includes(s)) return s as SlotKind
  return Object.hasOwn(SLOT_KIND_ALIASES, s) ? SLOT_KIND_ALIASES[s] : null
}

/** `grid:dhw_5km:CRW_SST` -> { kind, id, variable }; `erddap:` reads as `grid:`; null for anything else (an unknown kind, an empty or odd part) */
export function parseLayerKey(s: string | null | undefined): LayerSpec | null {
  if (!s) return null
  const bits = s.split(':')
  if (bits.length < 2 || bits.length > 3) return null
  const [k, id, variable] = bits
  const kind = kindOf(k)
  if (!kind || !PART.test(id) || (variable != null && !PART.test(variable))) return null
  return { kind, id, variable: variable ?? null }
}

/** the key of a spec, always under its kind's own name (an `erddap:` link comes back as `grid:`) */
export function formatLayerKey(spec: LayerSpec): string {
  return `${spec.kind}:${spec.id}${spec.variable ? `:${spec.variable}` : ''}`
}

// ---- the registry ----

const factories = new Map<SlotKind, SlotFactory>()

export function registerSlotKind(kind: SlotKind, factory: SlotFactory): void {
  factories.set(kind, factory)
}

/** the slot of a spec, made by its kind's factory; throws (at once, not in the promise) on a kind nothing has registered */
export function slotFor(spec: LayerSpec, opts: SlotOptions = {}): Promise<LayerSlot> {
  const make = factories.get(spec.kind)
  if (!make) throw new Error(`no layer slot kind "${spec.kind}" is registered`)
  return make(spec, opts)
}

// ---- where the slot sits among the map's layers ----

/** every layer and source a slot adds starts with this, so clear() removes it and a click never hits it */
export const SLOT_PREFIX = 'slot:'
export const isSlotLayer = (id: string) => id.startsWith(SLOT_PREFIX)
/** what clear() removes in indicators: everything but its basemap (`base-*`), the slot's layers among it. no id of a
 * composeStyle basemap starts with `base-`, so on it this clears everything: key on basemap.ts `basemapLayerIds` */
export const clearsLayer = (id: string) => !id.startsWith('base-')
/** the layers a click or the pointer tests: a part's, never the slot's */
export const hitsLayer = (id: string) => !isSlotLayer(id) && clearsLayer(id)

/** indicators' rule: a vector part's fill (`p<i>:fill`) is what the slot goes under first */
export const isPartFill = (id: string) => /^p\d+:fill$/.test(id)

/**
 * the layer the slot goes under, from the ids of the app's layers that draw, in drawing order (no basemap, no slot):
 * the first one `under` accepts (default: indicators' vector part fills, `p<i>:fill`), else the first drawn layer (a
 * WMS part `w<i>`), else null (on top of the basemap; pass the basemap's sea-surface id, basemap.ts `seaSurfaceId`, as
 * `fallback` to stay under the land mask and the labels).
 */
export function slotBeforeId(
  drawnLayerIds: readonly string[],
  opts: { under?: (id: string) => boolean; fallback?: string | null } = {},
): string | null {
  const ids = drawnLayerIds.filter((id) => !isSlotLayer(id))
  const under = opts.under ?? isPartFill
  return ids.find(under) ?? ids[0] ?? opts.fallback ?? null
}

// ---- across a style change ----

/**
 * a `transformStyle` for `map.setStyle(next, { diff: true, transformStyle })` that carries the layers `keep` accepts
 * (default the slot's, `slot:*`) and their sources from the previous style into the next, each under the layer it sat
 * under. without it a theme flip drops them: setStyle's diff removes every layer the next style does not name, and
 * composeStyle names only the basemap's (consumer check 2026-10-23). an app keeping its own parts too passes
 * `carryLayers((id) => !basemap.has(id))` with basemap.ts `basemapLayerIds` of the style it set.
 */
export function carryLayers(keep: (id: string) => boolean = isSlotLayer) {
  return (prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification => {
    if (!prev) return next
    const named = new Set(next.layers.map((l) => l.id))
    const carried = prev.layers.filter((l) => keep(l.id) && !named.has(l.id))
    if (!carried.length) return next
    const layers = [...next.layers]
    const sources = { ...next.sources }
    for (const l of carried) {
      const src = (l as { source?: unknown }).source
      if (typeof src === 'string' && !(src in sources) && prev.sources[src]) sources[src] = prev.sources[src]
    }
    // each carried layer goes before the first later layer of the previous style that the new one still has
    prev.layers.forEach((l, i) => {
      if (!carried.includes(l)) return
      let at = layers.length
      for (let j = i + 1; j < prev.layers.length; j++) {
        const k = layers.findIndex((x) => x.id === prev.layers[j].id)
        if (k >= 0) { at = k; break }
      }
      layers.splice(at, 0, l)
    })
    return { ...next, sources, layers }
  }
}

/** carryLayers for the slot alone: `map.setStyle(composeStyle(base, { theme }), { diff: true, transformStyle: carrySlots })` */
export const carrySlots = carryLayers()
