import { describe, expect, it } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import { BASEMAP_URL, BASEMAP_VERSION, basemapLayerIds, composeStyle, CONTOUR_LEVELS, CORE_MINZOOM, DEFAULT_TILES, OPEN_WATER, REGIONAL_MINZOOM, regionalSourceId, seaSurfaceId, tilesAt } from './basemap.js'
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
      'gebco-far-relief', 'gebco-far-shade', 'gebco-relief', 'gebco-shade', 'gebco-regional-relief', 'gebco-regional-shade',
      'gebco-contour-3', 'gebco-contour-2', 'gebco-contour-1', 'gebco-contour-0', 'gebco-contour-label',
      'land', 'water-inland',
      'landcover',
      'gebco-names-1', 'gebco-names-2', 'gebco-names-3', 'gebco-names-line',
      'water_shadow', 'road', 'boundary_country', 'place_city', 'place_island', 'place_island_minor', 'place_town', 'watername',
    ])
  })
  it('without the mask the ocean stays where CARTO put it and the sea floor sits right after water', () => {
    const s = composeStyle(BASE, { theme: 'light', land: false, names: false, parts: ['depth'] })
    expect(ids(s)).toEqual(['background', 'landcover', 'park_national_park', 'water', 'gebco-far-relief', 'gebco-relief', 'gebco-regional-relief',
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
  it('each regional tier is a pmtiles raster-dem source of its own with relief and shade layers from z9, over core', () => {
    const s = composeStyle(BASE, { theme: 'dark', tiles: { regional: ['https://x.test/a.pmtiles', 'https://x.test/b.pmtiles'] } })
    expect(regionalSourceId(0)).toBe('gebco-regional')
    expect(regionalSourceId(1)).toBe('gebco-regional-2')
    expect(s.sources['gebco-regional']).toMatchObject({ type: 'raster-dem', url: 'pmtiles://https://x.test/a.pmtiles', encoding: 'custom', baseShift: 10000, tileSize: 512 })
    expect(s.sources['gebco-regional-2']).toMatchObject({ type: 'raster-dem', url: 'pmtiles://https://x.test/b.pmtiles', encoding: 'custom' })
    const sea = ids(s).filter((id) => id.startsWith('gebco-') && /-(relief|shade)$/.test(id))
    expect(sea).toEqual(['gebco-far-relief', 'gebco-far-shade', 'gebco-relief', 'gebco-shade',
      'gebco-regional-relief', 'gebco-regional-shade', 'gebco-regional-2-relief', 'gebco-regional-2-shade'])
    expect(REGIONAL_MINZOOM).toBe(9)
    for (const id of sea.filter((i) => i.includes('regional'))) expect(layer(s, id).minzoom).toBe(9)
    expect(layer(s, 'gebco-far-relief').minzoom).toBeUndefined()
    expect(layer(s, 'gebco-regional-relief').source).toBe('gebco-regional')
    expect(layer(s, 'gebco-regional-2-shade').source).toBe('gebco-regional-2')
  })
  it('the default regional tier is the sanctuaries at z9-10, and an empty list leaves core overzoomed', () => {
    expect(DEFAULT_TILES.regional).toEqual([`https://storage.oceanmetrics.io/basemap/gebco/v${BASEMAP_VERSION}/core-sanctuaries.pmtiles`])
    const none = composeStyle(BASE, { theme: 'dark', tiles: { regional: [] } })
    expect(Object.keys(none.sources).filter((k) => k.startsWith('gebco-regional'))).toEqual([])
    expect(ids(none).filter((id) => id.includes('regional'))).toEqual([])
    expect(Object.keys(composeStyle(BASE, { theme: 'dark' }).sources).filter((k) => k.startsWith('gebco-regional'))).toEqual(['gebco-regional'])
  })
  it('seaSurfaceId puts the data above the regional layers too', () => {
    const s = composeStyle(BASE, { theme: 'dark', land: false, names: false, parts: ['depth', 'relief'] })
    expect(seaSurfaceId(s)).toBe('water_shadow') // the first layer after gebco-regional-shade
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
      'gebco-far-relief', 'gebco-far-shade', 'gebco-relief', 'gebco-shade', 'gebco-regional-relief', 'gebco-regional-shade',
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

// the relief tiers by zoom, from the composed style: a layer draws at zoom z when minzoom <= z < maxzoom (MapLibre: minzoom
// inclusive, maxzoom exclusive), so the tier of a source is the set of zooms any of its relief or shade layers draws at
describe('the relief tiers do not overlap (0.3.4)', () => {
  const SEA = /^gebco(-far|-regional(-\d+)?)?-(relief|shade)$/
  const draws = (l: Record<string, any>, z: number) => (l.minzoom ?? 0) <= z && z < (l.maxzoom ?? 24)
  const ZOOMS = Array.from({ length: 41 }, (_, i) => i / 4) // 0 to 10 in quarter steps, so the seams at 6 and 9 are hit exactly and from both sides
  const tiersAt = (s: StyleSpecification, z: number) => [...new Set(s.layers.filter((l) => SEA.test(l.id) && draws(l, z)).map((l) => (l as Record<string, any>).source as string))]
  const range = (s: StyleSpecification, src: string) => {
    const ls = s.layers.filter((l) => (l as Record<string, any>).source === src && SEA.test(l.id)) as Record<string, any>[]
    expect(new Set(ls.map((l) => `${l.minzoom}-${l.maxzoom}`)).size).toBe(1) // relief and shade of a tier share one range
    return [ls[0].minzoom ?? 0, ls[0].maxzoom ?? null]
  }
  it('with the default regional tier: far z0-5, core z6-8, the regional tier from z9', () => {
    const s = composeStyle(BASE, { theme: 'dark' })
    expect(CORE_MINZOOM).toBe(6)
    expect(range(s, 'gebco-far')).toEqual([0, 6])
    expect(range(s, 'gebco')).toEqual([6, 9])
    expect(range(s, 'gebco-regional')).toEqual([9, null])
  })
  it('every zoom 0 to 10 is drawn by exactly one relief tier, seams included', () => {
    const s = composeStyle(BASE, { theme: 'dark', tiles: { regional: ['https://x.test/a.pmtiles', 'https://x.test/b.pmtiles'] } })
    const at = ZOOMS.map((z) => tiersAt(s, z))
    // two regional tiers share z9+ (they cover different boxes): exactly one *kind* of tier below z9, the regionals alone from 9
    for (const [i, z] of ZOOMS.entries()) {
      if (z < 6) expect(at[i], `z${z}`).toEqual(['gebco-far'])
      else if (z < 9) expect(at[i], `z${z}`).toEqual(['gebco'])
      else expect(at[i], `z${z}`).toEqual(['gebco-regional', 'gebco-regional-2'])
    }
  })
  it('exactly one tier at every zoom 0 to 10 with one regional tier', () => {
    const s = composeStyle(BASE, { theme: 'light' })
    for (const z of ZOOMS) expect(tiersAt(s, z), `z${z}`).toHaveLength(1)
    expect(ZOOMS.map((z) => tiersAt(s, z)[0])).toEqual(ZOOMS.map((z) => z < 6 ? 'gebco-far' : z < 9 ? 'gebco' : 'gebco-regional'))
  })
  it('without a regional tier core is the last tier, overzoomed past z8 (no maxzoom), and still no overlap', () => {
    const s = composeStyle(BASE, { theme: 'dark', tiles: { regional: [] } })
    expect(range(s, 'gebco')).toEqual([6, null])
    for (const z of [...ZOOMS, 12, 16, 22]) expect(tiersAt(s, z), `z${z}`).toEqual([z < 6 ? 'gebco-far' : 'gebco'])
  })
  it('a part that is switched off drops its layers and keeps the ranges of the others', () => {
    for (const parts of [['depth'], ['relief']] as const) {
      const s = composeStyle(BASE, { theme: 'dark', parts })
      for (const z of ZOOMS) expect(tiersAt(s, z), `${parts} z${z}`).toHaveLength(1)
    }
  })
  it('the land mask, the isobaths and the names keep their own zoom gates', () => {
    const s = composeStyle(BASE, { theme: 'dark' })
    for (const id of ['land', 'water-inland', 'gebco-contour-3', 'gebco-contour-2', 'gebco-contour-1', 'gebco-contour-0', 'gebco-contour-label', 'gebco-names-line'])
      expect(layer(s, id).maxzoom, id).toBeUndefined()
    expect(['land', 'water-inland', 'gebco-names-1', 'gebco-names-line'].map((id) => layer(s, id).minzoom)).toEqual([undefined, undefined, 4, 4])
  })
  it('the composed style is otherwise unchanged: the layer ids and their order (snapshot of 0.3.3)', () => {
    const dark = composeStyle(BASE, { theme: 'dark' })
    expect(ids(dark)).toMatchInlineSnapshot(`
      [
        "background",
        "park_national_park",
        "water",
        "gebco-far-relief",
        "gebco-far-shade",
        "gebco-relief",
        "gebco-shade",
        "gebco-regional-relief",
        "gebco-regional-shade",
        "gebco-contour-3",
        "gebco-contour-2",
        "gebco-contour-1",
        "gebco-contour-0",
        "gebco-contour-label",
        "land",
        "water-inland",
        "landcover",
        "gebco-names-1",
        "gebco-names-2",
        "gebco-names-3",
        "gebco-names-line",
        "water_shadow",
        "road",
        "boundary_country",
        "place_city",
        "place_island",
        "place_island_minor",
        "place_town",
        "watername",
      ]
    `)
    // the sources are the same, and only the far and core layers carry a maxzoom
    expect(Object.keys(dark.sources)).toEqual(['carto', 'gebco-far', 'gebco', 'gebco-regional', 'gebco-contours', 'osm-land', 'gebco-names'])
    expect(ids(dark).filter((id) => layer(dark, id).maxzoom !== undefined)).toEqual(['gebco-far-relief', 'gebco-far-shade', 'gebco-relief', 'gebco-shade'])
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

describe('the versioned archives (0.3.5)', () => {
  // the storage Worker's isImmutable (places worker/src/paths.ts) caches basemap/<set>/**/v<digits>/** data files for a year
  const IMMUTABLE_KEY = /^basemap\/[a-z0-9-]+\/v\d+\/[a-z0-9-]+\.pmtiles$/
  const urls = (t: ReturnType<typeof tilesAt>): string[] => [t.core, t.far, ...(t.regional ?? []), t.contours, t.names, t.land].filter((u): u is string => !!u)

  it('BASEMAP_VERSION is a build date, YYYYMMDD, and the files now in the bucket are of that build', () => {
    expect(BASEMAP_VERSION).toBe('20261023')
    expect(BASEMAP_URL).toBe('https://storage.oceanmetrics.io/basemap/')
  })
  it('tilesAt builds basemap/<set>/v<version>/<file>.pmtiles for the six archives', () => {
    expect(tilesAt('20261023')).toEqual({
      core: 'https://storage.oceanmetrics.io/basemap/gebco/v20261023/core.pmtiles',
      far: 'https://storage.oceanmetrics.io/basemap/gebco/v20261023/far.pmtiles',
      regional: ['https://storage.oceanmetrics.io/basemap/gebco/v20261023/core-sanctuaries.pmtiles'],
      contours: 'https://storage.oceanmetrics.io/basemap/gebco/v20261023/contours.pmtiles',
      names: 'https://storage.oceanmetrics.io/basemap/gebco/v20261023/names.pmtiles',
      land: 'https://storage.oceanmetrics.io/basemap/osm/v20261023/land.pmtiles',
    })
  })
  it('DEFAULT_TILES is tilesAt(BASEMAP_VERSION): every default url is an immutable key (the unversioned keys are not read)', () => {
    expect(DEFAULT_TILES).toEqual(tilesAt(BASEMAP_VERSION))
    const urlsOf = urls(DEFAULT_TILES)
    expect(urlsOf).toHaveLength(6)
    for (const u of urlsOf) {
      expect(u.startsWith(BASEMAP_URL)).toBe(true)
      expect(u.slice('https://storage.oceanmetrics.io/'.length)).toMatch(IMMUTABLE_KEY)
      expect(u).toContain(`/v${BASEMAP_VERSION}/`)
    }
    expect(urlsOf).not.toContain(`${BASEMAP_URL}gebco/core.pmtiles`)
  })
  it('a base url and another version move all six, and the composed style reads them', () => {
    const t = tilesAt('20270101', 'https://x.test/basemap/')
    expect(urls(t).every((u) => /^https:\/\/x\.test\/basemap\/(gebco|osm)\/v20270101\/[a-z-]+\.pmtiles$/.test(u))).toBe(true)
    const s = composeStyle(BASE, { theme: 'dark', tiles: t })
    expect((s.sources['gebco'] as { url: string }).url).toBe('pmtiles://https://x.test/basemap/gebco/v20270101/core.pmtiles')
    expect((s.sources['osm-land'] as { url: string }).url).toBe('pmtiles://https://x.test/basemap/osm/v20270101/land.pmtiles')
    // the default style reads the versioned keys of the current build
    const d = composeStyle(BASE, { theme: 'dark' })
    expect((d.sources['gebco'] as { url: string }).url).toBe(`pmtiles://${BASEMAP_URL}gebco/v${BASEMAP_VERSION}/core.pmtiles`)
    expect((d.sources['gebco-far'] as { url: string }).url).toBe(`pmtiles://${BASEMAP_URL}gebco/v${BASEMAP_VERSION}/far.pmtiles`)
  })
  it('a version that is not eight digits is refused', () => {
    for (const bad of ['', '2026-10-23', '2026102', '202610233', 'v20261023', '20261023/../x']) expect(() => tilesAt(bad)).toThrow(/YYYYMMDD/)
  })
})
