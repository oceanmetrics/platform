// the bathymetric basemap: a typed port of CalCOFI explore `src/basemap.ts` `composeStyle()` (plan 2026-08-31 D21, D22,
// D26, D27; reference layers 2026-09-09 D47 to D54). CARTO's style plus the GEBCO sea floor as ONE style object, applied
// with `setStyle(style, { diff: true })`, so a theme flip is a paint diff and no layer is dropped the way addLayer-after-
// load ones are. The sea floor is two terrain-RGB tiers (`gebco-far` under `gebco`: MapLibre never fetches a parent tile
// as a fallback, so one sparse archive leaves the far field blank), drawn as colour relief and igor hillshade, with
// isobaths gated by level and zoom, the GEBCO gazetteer's undersea feature names, and the OpenStreetMap land mask over
// the sea floor and the data, so the coast is CARTO's own at every zoom.
//
// Left out of the port: explore's boundary registry (composeBoundaries; the places package draws boundaries) and the
// `import.meta.env` urls (the tiers are a `BasemapTiles` config here). The tiers at the default urls are built in build
// week 2 by `scripts/basemap/build_gebco.sh` (a global far tier z0-5, regional core tiers z0-8 over the 18 sanctuaries,
// the contours); until they are uploaded the default urls 404 and an app passes its own `tiles`.
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'

export type Theme = 'dark' | 'light'
export type BathyPart = 'relief' | 'depth' | 'contours'
export const BATHY_PARTS: readonly BathyPart[] = ['relief', 'depth', 'contours']

// ---- the tiers ----

/** where the archives live; each is a PMTiles url, null leaves that part out */
export interface BasemapTiles {
  /** terrain-RGB, z0-8 over the regional boxes (custom 1 m encoding) */
  core: string
  /** terrain-RGB, z0-5 over the globe */
  far: string
  /** isobath lines (`ele`, `level`), source layer `contours` */
  contours: string | null
  /** undersea feature names (`label`, `rank` 1-3), source layer `names` */
  names: string | null
  /** OSM land polygons, source layer `land` */
  land: string | null
}
export const BASEMAP_URL = 'https://storage.oceanmetrics.io/basemap/'
export const DEFAULT_TILES: Readonly<BasemapTiles> = {
  core: `${BASEMAP_URL}gebco/core.pmtiles`,
  far: `${BASEMAP_URL}gebco/far.pmtiles`,
  contours: `${BASEMAP_URL}gebco/contours.pmtiles`,
  names: `${BASEMAP_URL}gebco/names.pmtiles`,
  land: `${BASEMAP_URL}osm/land.pmtiles`,
}
export const SOURCE_LAYERS = { contours: 'contours', names: 'names', land: 'land' } as const
/** the custom 1 m terrain-RGB encoding of the tiers: elevation = R·65536 + G·256 + B − 10000 (explore D21) */
export const DEM_ENCODING = { encoding: 'custom', redFactor: 65536, greenFactor: 256, blueFactor: 1, baseShift: 10000, tileSize: 512 } as const
export const GEBCO_ATTRIBUTION = 'GEBCO Compilation Group (2025) GEBCO 2025 Grid'
export const NAMES_ATTRIBUTION = 'IHO-IOC GEBCO Gazetteer of Undersea Feature Names'
export const LAND_ATTRIBUTION = '© OpenStreetMap contributors'

/** the land mask's MapLibre id: the data's beforeId while the mask is on (the sea surface) */
export const LAND_LAYER = 'land'

// ---- CARTO's base styles ----

export const CARTO_URL: Readonly<Record<Theme, string>> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
}
const cache: Partial<Record<Theme, Promise<StyleSpecification>>> = {}
/** CARTO's style of a theme, fetched once per page */
export function baseStyle(theme: Theme, fetchFn: typeof fetch = fetch): Promise<StyleSpecification> {
  const p = (cache[theme] ??= fetchFn(CARTO_URL[theme]).then((r) => {
    if (!r.ok) throw new Error(`CARTO ${theme} style: HTTP ${r.status}`)
    return r.json() as Promise<StyleSpecification>
  }))
  p.catch(() => delete cache[theme])
  return p
}

// ---- the look, per theme (explore's measured picks, workflows plan § Measured) ----

export const bathyDefaultOpacity = (theme: Theme) => (theme === 'dark' ? 0.7 : 1)
export const baseLabelDefaultOpacity = (theme: Theme) => (theme === 'dark' ? 0.6 : 0.7)

/** depth colour: each ramp fades to transparent at exactly 0 m (land is clamped to 0 in the tiles). On dark the ramp ends
 * on the shallow colour (CARTO's water is darker than the shallows, so ending on it drew a dark rim along every shelf). */
export const BATHY_RAMP: Readonly<Record<Theme, (number | string)[]>> = {
  dark: [-6500, '#03070f', -4500, '#060d19', -3000, '#0b1a2e', -2000, '#11284a', -1000, '#183760',
    -500, '#20466e', -200, '#27536f', -100, '#2a5a6f', -50, '#2b5b68', 0, 'rgba(43,91,104,0)'],
  light: [-6500, '#2a527a', -4500, '#35638f', -3000, '#4a7aa6', -2000, '#6392ba', -1000, '#7ea8c9',
    -500, '#98bad5', -200, '#adc8dc', -100, '#bcd1df', -50, '#c8d6dd', -1, '#d4dadc', 0, 'rgba(212,218,220,0)'],
}
const SHADE = {
  dark: { 'hillshade-shadow-color': 'rgba(0,0,0,0.55)', 'hillshade-highlight-color': 'rgba(170,200,230,0.35)', 'hillshade-accent-color': 'rgba(0,0,0,0.2)' },
  light: { 'hillshade-shadow-color': 'rgba(40,60,80,0.45)', 'hillshade-highlight-color': 'rgba(255,255,255,0.6)', 'hillshade-accent-color': 'rgba(40,60,80,0.15)' },
}
const CONTOUR = {
  dark: { rgb: '150,190,220', alpha: 0.15, text: 'rgba(170,200,230,0.8)', halo: 'rgba(0,0,0,0.6)' },
  light: { rgb: '40,80,120', alpha: 0.3, text: 'rgba(40,80,120,0.85)', halo: 'rgba(255,255,255,0.7)' },
}
/** the isobath levels as the tiles carry them (`level` 0 = 50 m, 1 = 100-750 m, 2 = 500-multiples, 3 = 1000-multiples),
 * the zoom each appears from (the same gate the tile build applies) and its line width */
export const CONTOUR_LEVELS: readonly { level: 0 | 1 | 2 | 3; minzoom: number; width: number }[] = [
  { level: 3, minzoom: 0, width: 1.2 },
  { level: 2, minzoom: 5, width: 0.9 },
  { level: 1, minzoom: 7, width: 0.5 },
  { level: 0, minzoom: 9, width: 0.5 },
]
/** isobath labels: 500- and 1000-multiples from z8 */
export const CONTOUR_LABEL_MINZOOM = 8
const BASE_TEXT = {
  dark: { color: 'rgb(214,220,226)', halo: 'rgba(14,14,14,0.75)' },
  light: { color: 'rgb(74,84,92)', halo: 'rgba(250,250,248,0.75)' },
}
const NAME_TEXT = {
  dark: { text: 'rgb(178,204,230)', halo: 'rgba(10,16,24,0.8)', opacity: 0.65 },
  light: { text: '#4a6577', halo: 'rgba(250,250,248,0.8)', opacity: 0.7 },
}
/** undersea names by rank: rank 1 (ridges, fracture zones) from z4, 2 (basins, banks, seamounts) from z6, 3 from z8 */
export const NAME_RANKS: readonly { rank: 1 | 2 | 3; minzoom: number; size: number }[] = [
  { rank: 1, minzoom: 4, size: 12 },
  { rank: 2, minzoom: 6, size: 10 },
  { rank: 3, minzoom: 8, size: 9 },
]
const FONT = ['Montserrat Regular', 'Open Sans Regular']
const ITALIC = ['Montserrat Medium Italic', 'Open Sans Italic']
// CARTO's park layers hold marine polygons (reserves tagged nature_reserve): above the mask they would tint the ocean
const SINK_UNDER_WATER = ['park_national_park', 'park_nature_reserve']

// ---- composing ----

export interface BasemapOptions {
  theme: Theme
  /** the archives; default DEFAULT_TILES */
  tiles?: Partial<BasemapTiles>
  /** the sea-floor parts drawn; default all three, [] = no sea floor */
  parts?: readonly BathyPart[]
  /** the sea floor's opacity; null = the theme default (one slider scales relief, shading and contours) */
  opacity?: number | null
  /** the OSM land mask; default on when tiles.land is set */
  land?: boolean
  /** the undersea feature names; default on when tiles.names is set */
  names?: boolean
  /** CARTO's own text (place, road and water names), toned down; false hides it */
  baseLabels?: boolean
  baseLabelOpacity?: number | null
  /** false returns CARTO's base untouched: the style a map boots with (first paint must not wait for terrain tiles) */
  dem?: boolean
}

// the style is manipulated as plain JSON inside; typed at the edges
type Layer = Record<string, any> & { id: string; type: string }
type Style = { layers: Layer[]; sources: Record<string, unknown> } & Record<string, unknown>

/** CARTO's base plus the sea floor, the isobaths, the land mask and the undersea names, for one theme */
export function composeStyle(base: StyleSpecification, opts: BasemapOptions): StyleSpecification {
  const style = structuredClone(base) as unknown as Style
  if (opts.dem === false) return style as unknown as StyleSpecification
  const theme = opts.theme
  const tiles: BasemapTiles = { ...DEFAULT_TILES, ...opts.tiles }
  const parts = opts.parts ?? BATHY_PARTS
  const landOn = (opts.land ?? true) && !!tiles.land
  const namesOn = (opts.names ?? true) && !!tiles.names
  if (landOn) sinkOcean(style)
  addIslandLabels(style, theme) // before toning: an island name is a basemap label like any other
  if (opts.baseLabels === false) {
    for (const l of style.layers) if (l.type === 'symbol') l.layout = { ...(l.layout ?? {}), visibility: 'none' }
  } else toneBaseLabels(style, theme, opts.baseLabelOpacity ?? baseLabelDefaultOpacity(theme))

  const seaFloor = parts.length ? seaFloorLayers(style, theme, tiles, parts, opts.opacity ?? null) : []
  const water = style.layers.findIndex((l) => l.id === 'water')
  const at = water + 1 // right after CARTO's water fill (0 when there is none)
  style.layers.splice(at, 0, ...seaFloor)
  const mask = landOn ? landLayers(style, tiles.land!) : []
  style.layers.splice(at + seaFloor.length, 0, ...mask)
  if (namesOn) {
    const names = nameLayers(style, theme, tiles.names!)
    const shadow = landOn ? style.layers.findIndex((l) => l.id === 'water_shadow') : -1
    style.layers.splice(shadow >= 0 ? shadow : at + seaFloor.length + mask.length, 0, ...names)
  }
  return style as unknown as StyleSpecification
}

function seaFloorLayers(style: Style, theme: Theme, tiles: BasemapTiles, parts: readonly BathyPart[], opacity: number | null): Layer[] {
  const o = opacity ?? bathyDefaultOpacity(theme)
  const k = Math.min(1.4, o / bathyDefaultOpacity(theme))
  const dem = (url: string) => ({ type: 'raster-dem', url: `pmtiles://${url}`, ...DEM_ENCODING, attribution: GEBCO_ATTRIBUTION })
  style.sources['gebco-far'] = dem(tiles.far)
  style.sources['gebco'] = dem(tiles.core)
  const out: Layer[] = []
  for (const src of ['gebco-far', 'gebco']) {
    if (parts.includes('depth')) out.push({ id: `${src}-relief`, type: 'color-relief', source: src,
      paint: { 'color-relief-opacity': o, 'color-relief-color': ['interpolate', ['linear'], ['elevation'], ...BATHY_RAMP[theme]] } })
    if (parts.includes('relief')) out.push({ id: `${src}-shade`, type: 'hillshade', source: src,
      paint: { 'hillshade-method': 'igor', 'hillshade-exaggeration': Math.min(1, 0.5 * k), ...SHADE[theme] } })
  }
  if (parts.includes('contours') && tiles.contours) {
    const c = CONTOUR[theme]
    style.sources['gebco-contours'] = { type: 'vector', url: `pmtiles://${tiles.contours}`, attribution: GEBCO_ATTRIBUTION }
    const color = `rgba(${c.rgb},${Math.min(1, c.alpha * k).toFixed(3)})`
    for (const lv of CONTOUR_LEVELS) out.push({ id: `gebco-contour-${lv.level}`, type: 'line', source: 'gebco-contours',
      'source-layer': SOURCE_LAYERS.contours, minzoom: lv.minzoom, filter: ['==', ['get', 'level'], lv.level],
      paint: { 'line-color': color, 'line-width': lv.width } })
    out.push({ id: 'gebco-contour-label', type: 'symbol', source: 'gebco-contours', 'source-layer': SOURCE_LAYERS.contours,
      minzoom: CONTOUR_LABEL_MINZOOM, filter: ['>=', ['get', 'level'], 2],
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'], 'text-size': 10, 'text-font': FONT, 'symbol-spacing': 400 },
      paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1 } })
  }
  return out
}

/** the ocean stack goes to the bottom: `water` right after `background`, the parks under it, so the sea floor, the data
 * and the mask draw over the sea and under every CARTO land layer (explore D47). idempotent on a sunk base. */
function sinkOcean(style: Style) {
  const take = (id: string) => {
    const i = style.layers.findIndex((l) => l.id === id)
    return i < 0 ? null : style.layers.splice(i, 1)[0]
  }
  const water = take('water')
  const parks = SINK_UNDER_WATER.map(take).filter((l): l is Layer => !!l)
  const bg = style.layers.findIndex((l) => l.type === 'background')
  style.layers.splice(bg + 1, 0, ...parks, ...(water ? [water] : []))
}

/** the water kinds the mask's `water-inland` leaves out (it repaints lakes and rivers over the mask, never the sea):
 * CARTO's tiles since 2026 are the protomaps schema (`kind`: ocean, sea, lake ...), before that OpenMapTiles (`class`) */
export const OPEN_WATER = ['ocean', 'sea'] as const

/** the mask: the OSM land polygons in the theme's background colour, then CARTO's water without the open sea (lakes
 * and rivers sit inside the land polygons) */
function landLayers(style: Style, url: string): Layer[] {
  const bg = style.layers.find((l) => l.type === 'background')?.paint?.['background-color'] ?? '#fafaf8'
  style.sources['osm-land'] = { type: 'vector', url: `pmtiles://${url}`, attribution: LAND_ATTRIBUTION }
  const out: Layer[] = [{ id: LAND_LAYER, type: 'fill', source: 'osm-land', 'source-layer': SOURCE_LAYERS.land, paint: { 'fill-color': bg, 'fill-antialias': true } }]
  const water = style.layers.find((l) => l.id === 'water')
  // the open sea by either schema: a filter on OpenMapTiles' `class` alone passed every protomaps polygon (no `class`),
  // so `water-inland` repainted the whole ocean over the data (consumer check 2026-10-23)
  if (water) out.push({ ...structuredClone(water), id: 'water-inland', filter: ['all', ['==', ['geometry-type'], 'Polygon'],
    ['!', ['in', ['coalesce', ['get', 'kind'], ['get', 'class'], ''], ['literal', [...OPEN_WATER]]]]] })
  return out
}

/** the undersea names: italic like CARTO's water names; three point layers by rank, one along lines (explore D50) */
function nameLayers(style: Style, theme: Theme, url: string): Layer[] {
  const c = NAME_TEXT[theme]
  style.sources['gebco-names'] = { type: 'vector', url: `pmtiles://${url}`, attribution: NAMES_ATTRIBUTION }
  const src = { source: 'gebco-names', 'source-layer': SOURCE_LAYERS.names }
  const size = (b: number) => ['interpolate', ['linear'], ['zoom'], 4, b - 2, 8, b, 12, b + 3]
  const paint = { 'text-color': c.text, 'text-opacity': c.opacity, 'text-halo-color': c.halo, 'text-halo-width': 1 }
  const pts: Layer[] = NAME_RANKS.map(({ rank, minzoom, size: s }) => ({ id: `gebco-names-${rank}`, type: 'symbol', ...src, minzoom,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'rank'], rank]],
    layout: { 'text-field': ['get', 'label'], 'text-font': ITALIC, 'text-size': size(s), 'text-max-width': 8, 'text-padding': 6,
      'symbol-sort-key': rank, 'text-letter-spacing': rank === 1 ? 0.1 : 0.03, 'text-transform': rank === 1 ? 'uppercase' : 'none' },
    paint }))
  pts.push({ id: 'gebco-names-line', type: 'symbol', ...src, minzoom: 4, filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': ITALIC, 'text-size': size(10),
      'text-letter-spacing': 0.08, 'symbol-spacing': 700, 'text-max-angle': 30 },
    paint })
  return pts
}

/** CARTO's tiles carry `place` features of class island from z8, but neither style draws them: two symbol layers under
 * `place_town` (towns win a collision), in the toned look (explore, Ben 2026-09-09) */
function addIslandLabels(style: Style, theme: Theme) {
  const town = style.layers.findIndex((l) => l.id === 'place_town')
  const source = (town >= 0 ? style.layers[town].source : null) ?? 'carto'
  const t = BASE_TEXT[theme]
  const mk = (id: string, minzoom: number, filter: unknown[], stops: [number, number][]): Layer => ({ id, type: 'symbol', source, 'source-layer': 'place', minzoom, filter,
    layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': FONT, 'text-size': { stops }, 'text-letter-spacing': 0.06,
      'text-max-width': 7, 'text-padding': 4, 'symbol-sort-key': ['get', 'rank'] },
    paint: { 'text-color': t.color, 'text-halo-color': t.halo, 'text-halo-width': 1 } })
  style.layers.splice(town < 0 ? style.layers.length : town, 0,
    mk('place_island', 8, ['all', ['==', 'class', 'island'], ['<=', 'rank', 3]], [[8, 11], [10, 12], [13, 14]]),
    mk('place_island_minor', 10, ['all', ['==', 'class', 'island'], ['>=', 'rank', 4]], [[10, 10], [13, 12]]))
}

/** CARTO's text toned down (Ben 2026-09-09: "the place labels are too visually dominant"): one grey per theme, Regular
 * weight, a thinner halo, 1 px smaller */
function toneBaseLabels(style: Style, theme: Theme, opacity: number) {
  const t = BASE_TEXT[theme]
  const smaller = (s: any): any => typeof s === 'number' ? Math.max(9, s - 1)
    : s && Array.isArray(s.stops) ? { ...s, stops: s.stops.map(([z, v]: [number, number]) => [z, Math.max(9, v - 1)]) } : s
  for (const l of style.layers) {
    if (l.type !== 'symbol') continue
    l.paint = { ...(l.paint ?? {}), 'text-color': t.color, 'text-opacity': opacity, 'icon-opacity': opacity, 'text-halo-color': t.halo, 'text-halo-width': 0.9 }
    l.layout = { ...(l.layout ?? {}) }
    if (Array.isArray(l.layout['text-font'])) l.layout['text-font'] = l.layout['text-font'].map((f: string) => String(f).replace(/ (Medium|SemiBold|Bold)( Italic)?$/, ' Regular$2'))
    if (l.layout['text-size'] != null) l.layout['text-size'] = smaller(l.layout['text-size'])
  }
}

// ---- what is the basemap's ----

/** the layer ids of a composed style (CARTO's and the sea floor's): what an app's clear() keeps and a click never
 * tests; take it from the style given to setStyle (both themes have the same ids) */
export const basemapLayerIds = (style: Pick<StyleSpecification, 'layers'>): Set<string> => new Set(style.layers.map((l: LayerSpecification) => l.id))

// ---- where the data goes ----

const SEA_FLOOR = /^gebco(-far)?-(relief|shade)$|^gebco-contour/

/** the id the data layers go under (the sea surface): the land mask when it is on, else the first layer above the sea
 * floor (or above CARTO's water); null when the style has neither */
export function seaSurfaceId(style: Pick<StyleSpecification, 'layers'>): string | null {
  const ids = style.layers.map((l: LayerSpecification) => l.id)
  if (ids.includes(LAND_LAYER)) return LAND_LAYER
  let last = -1
  ids.forEach((id, i) => { if (SEA_FLOOR.test(id)) last = i })
  if (last < 0) last = ids.indexOf('water')
  return last >= 0 && last + 1 < ids.length ? ids[last + 1] : null
}
