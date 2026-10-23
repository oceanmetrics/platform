import { describe, expect, it } from 'vitest'
import { axisSpacing, cellSquares, classLegend, GRID_LAYER, GRID_OUTLINE, gridFillColor, gridLegend, gridOutline, gridSlot, normalizeLon } from './grid.js'
import type { SliceCell } from './grid.js'

// a 2x2 lattice on a 0.25 degree grid, one cell without data on this step
const LATTICE: SliceCell[] = [
  { lat: 10.125, lon: -120.125, value: 1, weight: 1 },
  { lat: 10.125, lon: -119.875, value: 3, weight: 0.5 },
  { lat: 10.375, lon: -120.125, value: null, weight: 1 },
  { lat: 10.375, lon: -119.875, value: 2, weight: 0.25 },
]

describe('cellSquares', () => {
  it('draws one square per cell from the axis step, with exact corners', () => {
    const sq = cellSquares(LATTICE)
    expect([sq.lonSpacing, sq.latSpacing, sq.center]).toEqual([0.25, 0.25, 0])
    expect(sq.geojson.features[0].geometry.coordinates).toEqual([[[-120.25, 10], [-120, 10], [-120, 10.25], [-120.25, 10.25], [-120.25, 10]]])
    expect(sq.geojson.features[3].geometry.coordinates).toEqual([[[-120, 10.25], [-119.75, 10.25], [-119.75, 10.5], [-120, 10.5], [-120, 10.25]]])
    expect(sq.bbox).toEqual([-120.25, 10, -119.75, 10.5])
  })
  it('keeps a cell without data as a hole (value null) and ranges over the rest', () => {
    const sq = cellSquares(LATTICE)
    expect(sq.geojson.features.map((f) => f.properties.value)).toEqual([1, 3, null, 2])
    expect(sq.geojson.features[1].properties).toEqual({ lon: -119.875, lat: 10.125, weight: 0.5, value: 3 })
    expect(sq.range).toEqual([1, 3])
  })
  it('puts cells across the antimeridian in [0, 360) so a square runs past 180 instead of wrapping', () => {
    const sq = cellSquares([{ lat: 20, lon: 179.95, value: 1, weight: 1 }, { lat: 20, lon: -179.95, value: 2, weight: 1 }], { latSpacing: 0.1 })
    expect(sq.center).toBe(180)
    expect(sq.geojson.features[1].properties.lon).toBeCloseTo(180.05, 9)
    expect(sq.bbox[0]).toBeCloseTo(179.9, 9)
    expect(sq.bbox[2]).toBeCloseTo(180.1, 9)
  })
  it('the axis step is the median gap, so cells missing from the mask cannot inflate it', () => {
    expect(axisSpacing([0, 0.25, 0.5, 1.25, 1.5])).toBe(0.25)
    expect(axisSpacing([5])).toBe(0)
    expect(normalizeLon(-180)).toBe(180)
    expect(normalizeLon(-170, 180)).toBe(190)
  })
})

describe('the fill colour', () => {
  it('a continuous grid interpolates the ramp over the range, null transparent', () => {
    expect(gridFillColor({ range: [0, 30], stops: 4 })).toEqual(['case', ['==', ['get', 'value'], null], 'rgba(0,0,0,0)',
      ['interpolate', ['linear'], ['get', 'value'], 0, '#440154', 10, '#31688d', 20, '#38b777', 30, '#fde725']])
  })
  it('a categorical grid matches the value\'s string, an unknown class grey', () => {
    const classes = classLegend([{ value: 1, label: 'tropical' }, { value: 2, label: 'subtropical' }, { value: 3, label: 'temperate' }])
    expect(gridFillColor({ range: [1, 3], classes })).toEqual(['match', ['to-string', ['get', 'value']],
      '1', '#5e4fa2', '2', '#ffffbf', '3', '#9e0142', '#cccccc'])
  })
})

describe('the legend', () => {
  it('a categorical legend lists the classes in order with their colours', () => {
    const classes = classLegend([{ value: 7, label: 'upwelling' }, { value: 11, label: 'oligotrophic' }])
    expect(gridLegend({ title: 'seascapes', t: '2024-07-01', via: 'grid slice', problem: null, range: [7, 11], classes })).toEqual({
      title: 'seascapes', t: '2024-07-01', via: 'grid slice', problem: null, units: null, ramp: null,
      classes: [{ value: 7, label: 'upwelling', color: '#5e4fa2' }, { value: 11, label: 'oligotrophic', color: '#9e0142' }],
    })
  })
  it('a continuous legend states the range; none before the first slice', () => {
    const l = gridLegend({ title: 'SST', t: null, via: 'grid slice', problem: null, units: '°C', range: [12.5, 18], ramp: 'thermal' })
    expect(l.ramp).toMatchObject({ min: 12.5, max: 18 })
    expect(l.ramp!.colors).toHaveLength(7)
    expect(l.ramp!.colors[0]).toBe('#042333')
    expect(gridLegend({ title: 'SST', t: null, via: 'grid slice', problem: null, range: null }).ramp).toBeNull()
  })
})

describe('the outline (map 0.2.2)', () => {
  it('by the axis step: drawn on a grid coarser than 0.05 degrees, none on a finer one', () => {
    expect(gridOutline(0.25)).toBe(GRID_OUTLINE)
    expect(gridOutline(0.1)).toBe(GRID_OUTLINE)
    expect(gridOutline(0.05)).toBeNull()
    expect(gridOutline(0.01)).toBeNull()
  })
  it('the option wins: a colour on any grid, null for none', () => {
    expect(gridOutline(0.01, '#ff0000')).toBe('#ff0000')
    expect(gridOutline(0.25, null)).toBeNull()
  })
  // a map that records what the slot sets on it
  const fakeMap = () => {
    const paint: Record<string, unknown> = {}
    const layers: Array<{ paint: Record<string, unknown> }> = []
    const m = {
      addSource() {}, addLayer(l: { paint: Record<string, unknown> }) { layers.push(l) },
      getSource: () => ({ setData() {} }), getLayer: () => ({}), removeLayer() {}, removeSource() {},
      setPaintProperty: (id: string, k: string, v: unknown) => { if (id === GRID_LAYER) paint[k] = v },
    }
    return { m, paint, layers }
  }
  const cells = (step: number): SliceCell[] => [0, 1].flatMap((i) => [0, 1].map((j) => ({ lat: 10 + i * step, lon: -120 + j * step, value: i + j, weight: 1 })))
  const mounted = async (step: number, outline?: string | null) => {
    const { m, paint, layers } = fakeMap()
    gridSlot({ kind: 'grid', id: 'g', variable: null }, { slice: async () => cells(step) }, { outline }).mount(m as never, null, null)
    await new Promise((r) => setTimeout(r, 0))
    return { paint, layer: layers[0] }
  }
  it('gridSlot sets the 12% black outline on a 0.25 degree grid and none on a 0.01 degree grid', async () => {
    expect((await mounted(0.25)).paint['fill-outline-color']).toBe(GRID_OUTLINE)
    const fine = await mounted(0.01)
    expect('fill-outline-color' in fine.paint).toBe(true)
    expect(fine.paint['fill-outline-color']).toBeUndefined()
    expect(fine.layer.paint['fill-outline-color']).toBeUndefined()
  })
  it('gridSlot passes an explicit outline into the layer and keeps it after a slice', async () => {
    const r = await mounted(0.01, '#00f')
    expect(r.layer.paint['fill-outline-color']).toBe('#00f')
    expect(r.paint['fill-outline-color']).toBe('#00f')
  })
})
