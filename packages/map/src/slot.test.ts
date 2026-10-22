import { describe, expect, it } from 'vitest'
import { carryLayers, carrySlots, clearsLayer, formatLayerKey, hitsLayer, isSlotLayer, parseLayerKey, registerSlotKind, slotBeforeId, slotFor } from './slot.js'
import type { LayerSlot, LayerSpec } from './slot.js'
import type { StyleSpecification } from 'maplibre-gl'

describe('the layer key (layer=<kind>:<id>[:<variable>])', () => {
  it('round-trips with and without a variable', () => {
    for (const k of ['grid:dhw_5km:CRW_SST', 'grid:jplMURSST41mday:sst', 'grid:jplMURSST41mday', 'cog:sst-2024.07', 'h3:obis_species']) {
      expect(formatLayerKey(parseLayerKey(k) as LayerSpec)).toBe(k)
    }
    expect(parseLayerKey('grid:dhw_5km:CRW_SST')).toEqual({ kind: 'grid', id: 'dhw_5km', variable: 'CRW_SST' })
    expect(parseLayerKey('grid:dhw_5km')).toEqual({ kind: 'grid', id: 'dhw_5km', variable: null })
  })
  it('reads erddap: (indicators Day 6 links) as a deprecated alias of grid:, and writes it back as grid:', () => {
    expect(parseLayerKey('erddap:dhw_5km:CRW_SST')).toEqual({ kind: 'grid', id: 'dhw_5km', variable: 'CRW_SST' })
    expect(formatLayerKey(parseLayerKey('erddap:jplMURSST41mday') as LayerSpec)).toBe('grid:jplMURSST41mday')
  })
  it('refuses an unknown kind, a missing id, too many parts and odd characters', () => {
    for (const k of ['', 'grid', 'grid:', 'wms:dhw_5km', 'grid:a:b:c', 'grid:a b', 'grid:a/b:c', 'grid::x', 'erddap:', 'toString:x', 'constructor:x']) {
      expect(parseLayerKey(k)).toBeNull()
    }
    expect(parseLayerKey(null)).toBeNull()
  })
})

describe('the registry', () => {
  const fake = (kind: LayerSlot['kind']) => async (spec: LayerSpec): Promise<LayerSlot> => ({
    id: formatLayerKey(spec), kind, title: `a ${kind} slot`, mount() {}, update() {}, unmount() {}, legend: () => null,
  })
  it('slotFor dispatches by kind', async () => {
    registerSlotKind('grid', fake('grid'))
    registerSlotKind('h3', fake('h3'))
    expect((await slotFor({ kind: 'grid', id: 'dhw_5km', variable: 'CRW_SST' })).title).toBe('a grid slot')
    expect((await slotFor({ kind: 'h3', id: 'obis', variable: null })).id).toBe('h3:obis')
  })
  it('throws at once on a kind nothing has registered', () => {
    expect(() => slotFor({ kind: 'cog', id: 'x', variable: null })).toThrow('no layer slot kind "cog" is registered')
    expect(() => slotFor({ kind: 'wms' as never, id: 'x', variable: null })).toThrow(/wms/)
  })
})

describe('where the slot goes (slotBeforeId over the drawn layer ids)', () => {
  it('under the first vector part\'s fill', () => {
    expect(slotBeforeId(['p0:fill', 'p0:line', 'w1'])).toBe('p0:fill')
    expect(slotBeforeId(['w0', 'p1:fill', 'p1:line'])).toBe('p1:fill')
  })
  it('under the first drawn layer (a WMS part) when no vector part draws', () => {
    expect(slotBeforeId(['w0', 'w1'])).toBe('w0')
    expect(slotBeforeId(['w1'])).toBe('w1')
  })
  it('on top of the basemap when nothing draws, or under the basemap\'s sea surface when given', () => {
    expect(slotBeforeId([])).toBeNull()
    expect(slotBeforeId([], { fallback: 'land' })).toBe('land')
  })
  it('never under a slot\'s own layer, and with a caller\'s rule', () => {
    expect(slotBeforeId(['slot:grid:fill', 'w0'])).toBe('w0')
    expect(slotBeforeId(['places:nms:fill', 'places:nms:line'], { under: (id) => id.endsWith(':line') })).toBe('places:nms:line')
  })
})

describe('the slot\'s layer ids', () => {
  it('start slot:, so clear() removes them with the parts and keeps the basemap', () => {
    for (const id of ['slot:grid', 'slot:grid:fill', 'p0:fill', 'w1', 'pick-ring']) expect(clearsLayer(id)).toBe(true)
    for (const id of ['base-bg', 'base-light', 'base-dark']) expect(clearsLayer(id)).toBe(false)
  })
  it('are never hit by a click or the pointer; a part\'s are', () => {
    expect(isSlotLayer('slot:cog:raster')).toBe(true)
    expect(hitsLayer('slot:cog:raster')).toBe(false)
    expect(hitsLayer('p0:fill')).toBe(true)
    expect(hitsLayer('p2:dots')).toBe(true)
    expect(hitsLayer('base-light')).toBe(false)
  })
})

describe('regression: carryLayers keeps the slot across setStyle(..., { diff: true }) (consumer check 2026-10-23)', () => {
  const style = (fill: string, extra: Record<string, unknown>[] = [], sources: Record<string, unknown> = {}) => ({
    version: 8,
    sources: { carto: { type: 'vector', url: 'https://x.test/c.json' }, ...sources },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': fill } },
      { id: 'water', type: 'fill', source: 'carto', 'source-layer': 'water' },
      { id: 'land', type: 'fill', source: 'carto', 'source-layer': 'land' },
      { id: 'place_city', type: 'symbol', source: 'carto', 'source-layer': 'place' },
      ...extra,
    ],
  }) as unknown as StyleSpecification
  const slotLayer = { id: 'slot:grid:fill', type: 'fill', source: 'slot:grid' }
  const slotSource = { 'slot:grid': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }
  const part = [{ id: 'p0:fill', type: 'fill', source: 'p0' }, { id: 'p0:line', type: 'line', source: 'p0' }]
  // the previous style as getStyle() serializes it: the slot under `land`, the part on top
  const prev = style('#000', [], { ...slotSource, p0: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } })
  prev.layers.splice(2, 0, slotLayer as never)
  prev.layers.push(...(part as never[]))
  const ids = (s: StyleSpecification) => s.layers.map((l) => l.id)

  it('puts the slot back under the layer it sat under, with its source, and leaves the rest of the next style alone', () => {
    const next = style('#fff')
    const out = carrySlots(prev, next)
    expect(ids(out)).toEqual(['background', 'water', 'slot:grid:fill', 'land', 'place_city'])
    expect(Object.keys(out.sources)).toEqual(['carto', 'slot:grid'])
    expect((out.layers[0] as unknown as { paint: Record<string, string> }).paint['background-color']).toBe('#fff')
  })
  it('an app carrying its parts too keys on the basemap ids', () => {
    const next = style('#fff')
    const basemap = new Set(ids(next))
    expect(ids(carryLayers((id) => !basemap.has(id))(prev, next))).toEqual(['background', 'water', 'slot:grid:fill', 'land', 'place_city', 'p0:fill', 'p0:line'])
  })
  it('passes the next style through when there is no previous style or nothing to carry', () => {
    const next = style('#fff')
    expect(carrySlots(undefined, next)).toBe(next)
    expect(carrySlots(style('#000'), next)).toBe(next)
  })
})
