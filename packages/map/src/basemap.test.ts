import { describe, expect, it } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import { basemapLayerIds, composeStyle, CONTOUR_LEVELS, DEFAULT_TILES, OPEN_WATER, seaSurfaceId } from './basemap.js'
import { clearsLayer, isSlotLayer } from './slot.js'

// a CARTO-shaped base (the layer ids and kinds composeStyle keys on), no network
const BASE = {
  version: 8,
  glyphs: 'https://tiles.example.org/fonts/{fontstack}/{range}.pbf',
  sources: { carto: { type: 'vector', url: 'https://tiles.example.org/carto.json' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0e0e0e' } },
    { id: 'landcover', type: 'fill', source: 'carto', 'source-layer': 'landcover', paint: { 'fill-color': '#111' } },
    { id: 'park_national_park', type: 'fill', source: 'carto', 'source-layer': 'park', paint: { 'fill-color': '#121' } },
    { id: 'water', type: 'fill', source: 'carto', 'source-layer': 'water', paint: { 'fill-color': '#2c353c' } },
    { id: 'water_shadow', type: 'fill', source: 'carto', 'source-layer': 'water', paint: { 'fill-color': '#222' } },
    { id: 'road', type: 'line', source: 'carto', 'source-layer': 'transportation', paint: { 'line-color': '#333' } },
    { id: 'boundary_country', type: 'line', source: 'carto', 'source-layer': 'boundary', paint: { 'line-color': '#444' } },
    { id: 'place_city', type: 'symbol', source: 'carto', 'source-layer': 'place', layout: { 'text-field': '{name}', 'text-font': ['Montserrat Medium'], 'text-size': 14 } },
    { id: 'place_town', type: 'symbol', source: 'carto', 'source-layer': 'place', layout: { 'text-field': '{name}', 'text-font': ['Montserrat Medium'], 'text-size': { stops: [[6, 10], [10, 12]] } } },
    { id: 'watername', type: 'symbol', source: 'carto', 'source-layer': 'water_name', layout: { 'text-field': '{name}', 'text-font': ['Montserrat Medium Italic'], 'text-size': 12 } },
  ],
} as unknown as StyleSpecification

const ids = (s: StyleSpecification) => s.layers.map((l) => l.id)
const layer = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id) as Record<string, any>

describe('composeStyle', () => {
  it('stacks the ocean at the bottom, the sea floor, the mask, the names, then CARTO\'s land layers and labels', () => {
    expect(ids(composeStyle(BASE, { theme: 'dark' }))).toEqual([
      'background', 'park_national_park', 'water',
      'gebco-far-relief', 'gebco-far-shade', 'gebco-relief', 'gebco-shade',
      'gebco-contour-3', 'gebco-contour-2', 'gebco-contour-1', 'gebco-contour-0', 'gebco-contour-label',
      'land', 'water-inland',
      'landcover',
      'gebco-names-1', 'gebco-names-2', 'gebco-names-3', 'gebco-names-line',
      'water_shadow', 'road', 'boundary_country', 'place_city', 'place_island', 'place_island_minor', 'place_town', 'watername',
    ])
  })
  it('without the mask the ocean stays where CARTO put it and the sea floor sits right after water', () => {
    const s = composeStyle(BASE, { theme: 'light', land: false, names: false, parts: ['depth'] })
    expect(ids(s)).toEqual(['background', 'landcover', 'park_national_park', 'water', 'gebco-far-relief', 'gebco-relief',
      'water_shadow', 'road', 'boundary_country', 'place_city', 'place_island', 'place_island_minor', 'place_town', 'watername'])
  })
  it('dem: false returns the base untouched (the boot style)', () => {
    expect(composeStyle(BASE, { theme: 'dark', dem: false })).toEqual(BASE)
  })
  it('each isobath level appears from its own zoom, as the tile build gates it', () => {
    const s = composeStyle(BASE, { theme: 'dark' })
    expect(CONTOUR_LEVELS.map((c) => [c.level, layer(s, `gebco-contour-${c.level}`).minzoom])).toEqual([[3, 0], [2, 5], [1, 7], [0, 9]])
    expect(layer(s, 'gebco-contour-2').filter).toEqual(['==', ['get', 'level'], 2])
    expect(layer(s, 'gebco-contour-label').minzoom).toBe(8)
    expect([1, 2, 3].map((r) => layer(s, `gebco-names-${r}`).minzoom)).toEqual([4, 6, 8])
  })
  it('the two terrain tiers are pmtiles raster-dem sources in the custom 1 m encoding, at the configured urls', () => {
    const s = composeStyle(BASE, { theme: 'dark', tiles: { core: 'https://x.test/core.pmtiles' } })
    expect(s.sources['gebco']).toMatchObject({ type: 'raster-dem', url: 'pmtiles://https://x.test/core.pmtiles', encoding: 'custom', baseShift: 10000, tileSize: 512 })
    expect((s.sources['gebco-far'] as { url: string }).url).toBe(`pmtiles://${DEFAULT_TILES.far}`)
    expect((s.sources['osm-land'] as { url: string }).url).toBe(`pmtiles://${DEFAULT_TILES.land}`)
  })
  it('the depth ramp is transparent at exactly 0 m in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      const e = layer(composeStyle(BASE, { theme }), 'gebco-relief').paint['color-relief-color']
      expect(e.slice(-2)).toEqual([0, theme === 'dark' ? 'rgba(43,91,104,0)' : 'rgba(212,218,220,0)'])
    }
  })
  it('a theme switch changes only the sea floor, the isobaths, the names and the labels', () => {
    const dark = composeStyle(BASE, { theme: 'dark' }), light = composeStyle(BASE, { theme: 'light' })
    expect(ids(light)).toEqual(ids(dark))
    const changed = ids(dark).filter((id) => JSON.stringify(layer(dark, id)) !== JSON.stringify(layer(light, id)))
    expect(changed).toEqual([
      'gebco-far-relief', 'gebco-far-shade', 'gebco-relief', 'gebco-shade',
      'gebco-contour-3', 'gebco-contour-2', 'gebco-contour-1', 'gebco-contour-0', 'gebco-contour-label',
      'gebco-names-1', 'gebco-names-2', 'gebco-names-3', 'gebco-names-line',
      'place_city', 'place_island', 'place_island_minor', 'place_town', 'watername',
    ])
    expect(light.sources).toEqual(dark.sources)
  })
  it('CARTO\'s text is toned (Regular, 1 px smaller) or hidden', () => {
    const s = composeStyle(BASE, { theme: 'dark' })
    expect(layer(s, 'place_city').layout['text-font']).toEqual(['Montserrat Regular'])
    expect(layer(s, 'place_city').layout['text-size']).toBe(13)
    expect(layer(s, 'watername').layout['text-font']).toEqual(['Montserrat Regular Italic'])
    expect(layer(s, 'place_town').layout['text-size']).toEqual({ stops: [[6, 9], [10, 11]] })
    const hidden = composeStyle(BASE, { theme: 'dark', baseLabels: false })
    expect(layer(hidden, 'place_city').layout.visibility).toBe('none')
  })
})

describe('seaSurfaceId: where the data goes', () => {
  it('under the land mask when it is on, else over the sea floor, else over CARTO\'s water', () => {
    expect(seaSurfaceId(composeStyle(BASE, { theme: 'dark' }))).toBe('land')
    expect(seaSurfaceId(composeStyle(BASE, { theme: 'dark', land: false, names: false }))).toBe('water_shadow')
    expect(seaSurfaceId(BASE)).toBe('water_shadow')
    expect(seaSurfaceId({ layers: [] })).toBeNull()
  })
})

describe('regression: water-inland on CARTO\'s protomaps tiles (consumer check 2026-10-23)', () => {
  // CARTO's styles since 2026 read the protomaps schema: source `protomaps`, water polygons with `kind`, no `class`
  const PROTOMAPS = structuredClone(BASE) as unknown as { sources: Record<string, unknown>; layers: Record<string, any>[] }
  PROTOMAPS.sources = { protomaps: { type: 'vector', tiles: ['https://tiles.example.org/{z}/{x}/{y}.mvt'] } }
  for (const l of PROTOMAPS.layers) if (l.source) l.source = 'protomaps'
  PROTOMAPS.layers.find((l) => l.id === 'water')!.filter = ['==', ['geometry-type'], 'Polygon']
  // the filter's own logic, for the two property shapes (the expression is exactly this, asserted below)
  const inland = (p: { kind?: string; class?: string }) => !(OPEN_WATER as readonly string[]).includes(p.kind ?? p.class ?? '')
  it('leaves out the open sea by kind (protomaps) or class (OpenMapTiles), so the mask never repaints the ocean over the data', () => {
    const s = composeStyle(PROTOMAPS as unknown as StyleSpecification, { theme: 'light' })
    const w = layer(s, 'water-inland')
    expect(w.source).toBe('protomaps')
    expect(w.filter).toEqual(['all', ['==', ['geometry-type'], 'Polygon'],
      ['!', ['in', ['coalesce', ['get', 'kind'], ['get', 'class'], ''], ['literal', ['ocean', 'sea']]]]])
    expect([{ kind: 'ocean' }, { kind: 'sea' }, { kind: 'lake' }, { class: 'ocean' }, { class: 'lake' }, {}].map(inland))
      .toEqual([false, false, true, false, true, true])
  })
})

describe('basemapLayerIds: the rule an app\'s clear() keys on', () => {
  it('is every layer id of the composed style, the same in both themes', () => {
    const dark = composeStyle(BASE, { theme: 'dark' })
    expect([...basemapLayerIds(dark)]).toEqual(ids(dark))
    expect(basemapLayerIds(composeStyle(BASE, { theme: 'light' }))).toEqual(basemapLayerIds(dark))
  })
  it('clear() removes the slot and the parts and keeps the basemap; a click tests the parts only (indicators\' base-* rule kept nothing)', () => {
    const style = composeStyle(BASE, { theme: 'dark' })
    const basemap = basemapLayerIds(style)
    const onMap = [...ids(style).slice(0, 12), 'slot:grid:fill', ...ids(style).slice(12), 'p0:fill', 'p0:line']
    expect(onMap.filter((id) => !basemap.has(id))).toEqual(['slot:grid:fill', 'p0:fill', 'p0:line'])
    expect(onMap.filter((id) => !isSlotLayer(id) && !basemap.has(id))).toEqual(['p0:fill', 'p0:line'])
    // the gap: the base-* rule would clear CARTO's whole style (no CARTO id starts with base-)
    expect(onMap.filter(clearsLayer)).toEqual(onMap)
  })
})
