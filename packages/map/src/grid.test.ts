import { describe, expect, it } from 'vitest'
import { axisSpacing, cellLocator, cellSquares, classLegend, GRID_LAYER, GRID_OUTLINE, gridFillColor, gridIds, gridLegend, gridOutline, gridSlot, normalizeLon, sliceCounts } from './grid.js'
import type { GridSlot, SliceCell, SliceSource } from './grid.js'

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

describe('two slots of one layer (map 0.2.3)', () => {
  // a map that keeps sources and layers by id and refuses a duplicate, as MapLibre does
  const strictMap = () => {
    const sources = new Map<string, unknown>()
    const layers = new Map<string, { id: string; source: string; paint: Record<string, unknown> }>()
    const order: string[] = []
    const m = {
      addSource(id: string, s: unknown) { if (sources.has(id)) throw new Error(`There is already a source with ID "${id}".`); sources.set(id, s) },
      addLayer(l: { id: string; source: string; paint: Record<string, unknown> }, before?: string) {
        if (layers.has(l.id)) throw new Error(`Layer "${l.id}" already exists on this map.`)
        layers.set(l.id, { ...l, paint: { ...l.paint } })
        const at = before ? order.indexOf(before) : -1
        if (at >= 0) order.splice(at, 0, l.id); else order.push(l.id)
      },
      getSource: (id: string) => (sources.has(id) ? { setData() {} } : undefined),
      getLayer: (id: string) => layers.get(id),
      removeLayer(id: string) { layers.delete(id); order.splice(order.indexOf(id), 1) },
      removeSource(id: string) { sources.delete(id) },
      setPaintProperty(id: string, k: string, v: unknown) { layers.get(id)!.paint[k] = v },
    }
    return { m, sources, layers, order }
  }
  const at = (v: number): SliceSource => ({ slice: async () => [{ lat: 0, lon: 0, value: v, weight: 1 }, { lat: 0, lon: 0.25, value: v + 2, weight: 1 }] })
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const spec = { kind: 'grid' as const, id: 'g', variable: 'v' }

  it('gridIds: the default ids, and an instance kept apart under slot:', () => {
    expect(gridIds()).toEqual({ source: 'slot:grid', layer: 'slot:grid:fill' })
    expect(gridIds('t2')).toEqual({ source: 'slot:grid@t2', layer: 'slot:grid@t2:fill' })
    expect(() => gridIds('a b')).toThrow(/letters, digits/)
  })
  it('two slots mount side by side when one names an instance, and unmount only their own', async () => {
    const { m, sources, layers, order } = strictMap()
    const a = gridSlot(spec, at(10))
    const b = gridSlot(spec, at(20), { instance: 't2' })
    a.mount(m as never, null, '2024-07-01')
    b.mount(m as never, null, '2016-07-01')
    expect([...sources.keys()]).toEqual(['slot:grid', 'slot:grid@t2'])
    expect(order).toEqual(['slot:grid:fill', 'slot:grid@t2:fill'])
    expect(b.ids).toEqual(gridIds('t2'))
    await tick()
    b.unmount(m as never)
    expect([...layers.keys()]).toEqual(['slot:grid:fill'])
    // without an instance the second one collides, as before
    expect(() => gridSlot(spec, at(30)).mount(m as never, null, null)).toThrow(/already/)
  })
  it('a shared domain: both read the union of their ranges, repaint() redraws the first once the second is in', async () => {
    const { m, layers } = strictMap()
    let a: GridSlot | null = null, b: GridSlot | null = null
    const union = (): [number, number] | null => {
      const r = [a?.cellRange(), b?.cellRange()].filter((x): x is [number, number] => !!x)
      return r.length ? [Math.min(...r.map((x) => x[0])), Math.max(...r.map((x) => x[1]))] : null
    }
    a = gridSlot(spec, at(10), { domain: union })
    b = gridSlot(spec, at(20), { domain: union, instance: 't2' })
    a.mount(m as never, null, null)
    await tick()
    expect(a.cellRange()).toEqual([10, 12])
    expect(a.legend()!.ramp).toMatchObject({ min: 10, max: 12 })
    b.mount(m as never, null, null)
    await tick()
    expect(b.cellRange()).toEqual([20, 22])
    expect(b.legend()!.ramp).toMatchObject({ min: 10, max: 22 })
    a.repaint()
    expect(a.legend()!.ramp).toMatchObject({ min: 10, max: 22 })
    expect(layers.get('slot:grid:fill')!.paint['fill-color']).toEqual(gridFillColor({ range: [10, 22] }))
  })
  it('a fixed domain still wins, and cellRange is the slice own range', async () => {
    const { m } = strictMap()
    const a = gridSlot(spec, at(10), { domain: [0, 100] })
    a.mount(m as never, null, null)
    await tick()
    expect(a.legend()!.ramp).toMatchObject({ min: 0, max: 100 })
    expect(a.cellRange()).toEqual([10, 12])
  })
})

describe('the cell under a point (map 0.3.1)', () => {
  it('cellLocator: the square that holds the point, its centre, weight and value; null off every square', () => {
    const at = cellLocator(cellSquares(LATTICE))
    expect(at(-120.2, 10.2)).toEqual({ lon: -120.125, lat: 10.125, weight: 1, value: 1 })
    expect(at(-119.76, 10.49)).toEqual({ lon: -119.875, lat: 10.375, weight: 0.25, value: 2 })
    // a cell without data answers with a null value: the readout says "no data", not nothing
    expect(at(-120.1, 10.4)).toEqual({ lon: -120.125, lat: 10.375, weight: 1, value: null })
    expect(at(-120.3, 10.2)).toBeNull()
    expect(at(-120.2, 10.6)).toBeNull()
    expect(at(Number.NaN, 10)).toBeNull()
  })
  it('cellLocator: a point in a world copy (lng - 360) finds the same cell', () => {
    expect(cellLocator(cellSquares(LATTICE))(-480.2, 10.2)).toMatchObject({ lon: -120.125, value: 1 })
  })
  it('cellLocator: across the antimeridian, a point at -179.97 finds the square drawn at 180.05 in the 0..360 frame', () => {
    const sq = cellSquares([{ lat: 20, lon: 179.95, value: 1, weight: 1 }, { lat: 20, lon: -179.95, value: 2, weight: 1 }], { latSpacing: 0.1 })
    const at = cellLocator(sq)
    expect(at(-179.97, 20.01)).toMatchObject({ value: 2 })
    expect(at(179.97, 19.99)).toMatchObject({ value: 1 })
    expect(at(180.03, 20)).toMatchObject({ value: 2 })
  })
  it('cellLocator: an empty slice answers null', () => {
    expect(cellLocator(cellSquares([]))(0, 0)).toBeNull()
  })
  it('sliceCounts: the cells, those with a value, those on a boundary (weight below 1)', () => {
    expect(sliceCounts(LATTICE)).toEqual({ cells: 4, withValue: 3, boundary: 2 })
    expect(sliceCounts([{ value: Number.NaN, weight: 1 }])).toEqual({ cells: 1, withValue: 0, boundary: 0 })
  })
})

describe('the slot\'s cell, counts, ramp and retry (map 0.3.1)', () => {
  const recordMap = () => {
    const paint: Record<string, unknown> = {}
    const m = {
      addSource() {}, addLayer() {}, getSource: () => ({ setData() {} }), getLayer: () => ({}), removeLayer() {}, removeSource() {},
      setPaintProperty: (_id: string, k: string, v: unknown) => { paint[k] = v },
    }
    return { m, paint }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const spec = { kind: 'grid' as const, id: 'g', variable: 'sst' }
  it('cellAt and counts read the last slice drawn; nothing before it', async () => {
    const { m } = recordMap()
    const s = gridSlot(spec, { slice: async () => LATTICE })
    expect(s.cellAt(-120.2, 10.2)).toBeNull()
    expect(s.counts()).toBeNull()
    s.mount(m as never, null, '2024-07-01')
    await tick()
    expect(s.cellAt(-120.2, 10.2)).toEqual({ lon: -120.125, lat: 10.125, weight: 1, value: 1 })
    expect(s.counts()).toEqual({ cells: 4, withValue: 3, boundary: 2 })
    s.unmount(m as never)
    expect(s.cellAt(-120.2, 10.2)).toBeNull()
  })
  it('setRamp paints the squares and the legend with another ramp, without a new slice; null goes back', async () => {
    const { m, paint } = recordMap()
    let asked = 0
    const s = gridSlot(spec, { slice: async () => { asked++; return LATTICE } }, { ramp: 'thermal' })
    s.mount(m as never, null, null)
    await tick()
    expect(s.ramp()).toBe('thermal')
    s.setRamp('viridis')
    expect(s.ramp()).toBe('viridis')
    expect(paint['fill-color']).toEqual(gridFillColor({ range: [1, 3], ramp: 'viridis' }))
    expect(s.legend()!.ramp!.colors[0]).toBe('#440154')
    s.setRamp(null)
    expect(s.ramp()).toBe('thermal')
    expect(s.legend()!.ramp!.colors[0]).toBe('#042333')
    expect(asked).toBe(1)
  })
  it('retry asks for the same period again after a failure, and the problem clears once it is in', async () => {
    const { m } = recordMap()
    const asked: (string | null)[] = []
    let fail = true
    const s = gridSlot(spec, { slice: async (t) => { asked.push(t); if (fail) throw new Error('HTTP 404'); return LATTICE } })
    s.mount(m as never, null, '2024-07-01')
    await tick()
    expect(s.legend()!.problem).toBe('no data: HTTP 404')
    expect(s.counts()).toBeNull()
    fail = false
    s.retry()
    expect(s.legend()!.problem).toBeNull()
    await tick()
    expect(asked).toEqual(['2024-07-01', '2024-07-01'])
    expect(s.legend()!.problem).toBeNull()
    expect(s.counts()).toEqual({ cells: 4, withValue: 3, boundary: 2 })
  })
})
