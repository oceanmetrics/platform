import { describe, expect, it } from 'vitest'
import { axisSpacing, cellSquares, normalizeLon, pickCenter, placeMapBounds } from './cells.js'

const ring = (f: any) => f.geometry.coordinates[0] as number[][]
const lonsOf = (f: any) => ring(f).map((p) => p[0])
const latsOf = (f: any) => ring(f).map((p) => p[1])

describe('axisSpacing', () => {
  it('is the step of a regular axis', () => {
    expect(axisSpacing([21.375, 21.425, 21.475])).toBeCloseTo(0.05, 12)
  })
  it('ignores the big gaps left by cells outside the mask', () => {
    // 0.05 grid with two cells missing in the middle: the 0.15 gap must not become the step
    expect(axisSpacing([0, 0.05, 0.1, 0.25, 0.3])).toBeCloseTo(0.05, 12)
  })
  it('ignores duplicates and order', () => {
    expect(axisSpacing([2, 1, 2, 3, 1])).toBe(1)
  })
  it('is 0 when there is nothing to measure', () => {
    expect(axisSpacing([])).toBe(0)
    expect(axisSpacing([5])).toBe(0)
  })
})

describe('normalizeLon / pickCenter', () => {
  it('wraps into the frame it is given', () => {
    expect(normalizeLon(-179.975, 180)).toBeCloseTo(180.025, 9)
    expect(normalizeLon(200.5, 0)).toBeCloseTo(-159.5, 9)
    expect(normalizeLon(-180, 180)).toBe(180)
    expect(normalizeLon(0, 180)).toBe(0)
    expect(normalizeLon(179.9, 0)).toBeCloseTo(179.9, 9)
  })
  it('centres on 180 only when the cells span more than half the globe', () => {
    expect(pickCenter([-160, -155, -150])).toBe(0)
    expect(pickCenter([179.9, -179.9])).toBe(180)   // PMNM-style, either side of the line
  })
})

describe('cellSquares', () => {
  it('draws each cell as a square of the axis spacing, centred on the cell', () => {
    const cells = [
      { lon: -160.0, lat: 21.375, weight: 1,   value: 26.1 },
      { lon: -159.95, lat: 21.375, weight: 0.5, value: 26.3 },
      { lon: -160.0, lat: 21.425, weight: 1,   value: 26.2 },
    ]
    const out = cellSquares(cells)
    expect(out.center).toBe(0)
    expect(out.lonSpacing).toBeCloseTo(0.05, 12)
    expect(out.latSpacing).toBeCloseTo(0.05, 12)
    expect(out.geojson.features).toHaveLength(3)

    const f = out.geojson.features[0]
    expect(ring(f)).toHaveLength(5)                       // closed ring
    expect(ring(f)[0]).toEqual(ring(f)[4])
    expect(Math.min(...lonsOf(f))).toBeCloseTo(-160.025, 9)
    expect(Math.max(...lonsOf(f))).toBeCloseTo(-159.975, 9)
    expect(Math.min(...latsOf(f))).toBeCloseTo(21.35, 9)
    expect(Math.max(...latsOf(f))).toBeCloseTo(21.40, 9)
    expect(f.properties).toEqual({ lon: -160, lat: 21.375, weight: 1, value: 26.1 })

    expect(out.range[0]).toBeCloseTo(26.1, 9)
    expect(out.range[1]).toBeCloseTo(26.3, 9)
    expect(out.bbox[0]).toBeCloseTo(-160.025, 9)
    expect(out.bbox[2]).toBeCloseTo(-159.925, 9)
  })

  it('honours an explicit spacing (the dataset axis, not what the mask happened to keep)', () => {
    const out = cellSquares([{ lon: 10, lat: 10, weight: 1, value: 1 }], { lonSpacing: 0.25, latSpacing: 0.25 })
    expect(Math.min(...lonsOf(out.geojson.features[0]))).toBeCloseTo(9.875, 9)
    expect(Math.max(...latsOf(out.geojson.features[0]))).toBeCloseTo(10.125, 9)
  })

  it('keeps antimeridian cells contiguous instead of wrapping the globe', () => {
    // four 0.05 cells straddling +-180, as PMNM's mask delivers them
    const cells = [
      { lon: 179.925, lat: 28, weight: 1, value: 1 },
      { lon: 179.975, lat: 28, weight: 1, value: 2 },
      { lon: -179.975, lat: 28, weight: 1, value: 3 },
      { lon: -179.925, lat: 28, weight: 1, value: 4 },
    ]
    const out = cellSquares(cells)
    expect(out.center).toBe(180)
    expect(out.lonSpacing).toBeCloseTo(0.05, 12)
    // no square is wider than one cell (a wrapped square would be ~360 degrees wide)
    for (const f of out.geojson.features)
      expect(Math.max(...lonsOf(f)) - Math.min(...lonsOf(f))).toBeCloseTo(0.05, 9)
    // and the four of them tile one continuous 0.2-degree strip across the line
    expect(out.bbox[0]).toBeCloseTo(179.9, 9)
    expect(out.bbox[2]).toBeCloseTo(180.1, 9)
    expect(out.geojson.features.map((f) => f.properties.lon))
      .toEqual([179.925, 179.975, 180.025, 180.075].map((x) => expect.closeTo(x, 9)))
  })

  it('keeps cells with no value, and clamps the poles', () => {
    const out = cellSquares([{ lon: 0, lat: 89.99, weight: 1, value: null }], { lonSpacing: 0.05, latSpacing: 0.05 })
    expect(out.geojson.features[0].properties.value).toBeNull()
    expect(Math.max(...latsOf(out.geojson.features[0]))).toBe(90)
    expect(out.range).toEqual([0, 0])
  })
})

describe('placeMapBounds', () => {
  it('returns the stored bbox untouched for an ordinary place (no geometry walk)', () => {
    const p = { bbox: [-83.1, 24.4, -80.2, 25.8] as [number, number, number, number] }
    expect(placeMapBounds(p)).toEqual([-83.1, 24.4, -80.2, 25.8])
  })
  it('rebuilds a PMNM-style bbox in the 0..360 frame', () => {
    const p = {
      bbox    : [-180, 19, 180, 32] as [number, number, number, number],
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[177.8, 22], [180, 22], [180, 23], [177.8, 23], [177.8, 22]]],   // west of the line
          [[[-180, 25], [-150, 25], [-150, 31.8], [-180, 31.8], [-180, 25]]], // east of it
        ],
      },
    }
    const b = placeMapBounds(p)
    expect(b[0]).toBeCloseTo(177.8, 9)
    expect(b[2]).toBeCloseTo(210, 9)      // -150 -> 210, so the fit crosses the seam
    expect(b[1]).toBeCloseTo(22, 9)
    expect(b[3]).toBeCloseTo(31.8, 9)
  })
})
