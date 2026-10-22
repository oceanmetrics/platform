// gridMask against the four NOAA sanctuary fixtures on the CRW 5 km lattice. the exact
// centre-inside counts are the regression contract: 124 / 152 / 352 / 54,480 (spikes/gridmask_bench.mjs).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gridMask, polygonParts, axisEdges, reduceRing, reduceRings } from './mask.js'
import bboxClip from '@turf/bbox-clip'
import area from '@turf/area'
import { polygon as tPolygon } from '@turf/helpers'
import type { FeatureCollection } from 'geojson'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RES = 0.05, ORIGIN = -179.975 // CRW 5 km grid: cell centres at ORIGIN + k*RES

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(DIR, '..', 'fixtures', `${name}.geojson`), 'utf8')) as FeatureCollection

function bbox(gj: FeatureCollection): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of polygonParts(gj)) {
    x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1])
    x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3])
  }
  return [x0, y0, x1, y1]
}
/** the CRW axis values ERDDAP would return for a bbox, padded a cell; lat descending as on the server. */
function crwAxes(gj: FeatureCollection) {
  const [x0, y0, x1, y1] = bbox(gj)
  const k = (v: number) => Math.round((v - ORIGIN) / RES)
  const seq = (a: number, b: number) => {
    const out: number[] = []
    for (let i = a; i <= b; i++) out.push(Number((ORIGIN + i * RES).toFixed(3)))
    return out
  }
  const lon = seq(k(x0) - 1, k(x1) + 1)
  const lat = seq(k(y0) - 1, k(y1) + 1).reverse() // ERDDAP latitude is descending
  return { lon, lat }
}

const CASES: Array<[string, number]> = [['HIHWNMS', 124], ['CINMS', 152], ['FKNMS', 352], ['PMNM', 54_480]]

describe('axisEdges', () => {
  it('uses midpoints and extrapolates the ends', () => {
    expect(axisEdges([0, 1, 2])).toEqual([-0.5, 0.5, 1.5, 2.5])
  })
  it('handles a descending axis and irregular spacing', () => {
    expect(axisEdges([10, 6, 4])).toEqual([12, 8, 5, 3])
    expect(axisEdges([0, 1, 3, 7])).toEqual([-0.5, 0.5, 2, 5, 9])
  })
})

describe('gridMask: exact centre-inside counts on the CRW lattice', () => {
  for (const [name, n] of CASES) {
    it(`${name} scan = ${n}`, () => {
      const gj = fixture(name)
      const { lon, lat } = crwAxes(gj)
      const r = gridMask(gj, lon, lat, { method: 'scan', weights: false })
      expect(r.method).toBe('scan')
      expect(r.nInside).toBe(n)
      expect(r.cells.length).toBe(n)
    }, 30_000)

    // PMNM has 101k candidate cells; turf point-in-polygon takes a few seconds there but is still exact.
    it(`${name} turf = ${n}`, () => {
      const gj = fixture(name)
      const { lon, lat } = crwAxes(gj)
      const r = gridMask(gj, lon, lat, { method: 'turf', weights: false })
      expect(r.method).toBe('turf')
      expect(r.nInside).toBe(n)
    }, 60_000)
  }
})

describe('gridMask: weights', () => {
  for (const [name, n] of CASES) {
    it(`${name} weights are fractions bracketed by nInside and nCandidates`, () => {
      const gj = fixture(name)
      const { lon, lat } = crwAxes(gj)
      const r = gridMask(gj, lon, lat, { method: 'scan' }) // weights default true
      expect(r.nInside).toBe(n)
      expect(r.cells.length).toBeGreaterThanOrEqual(n)
      for (const c of r.cells) { expect(c.weight).toBeGreaterThan(0); expect(c.weight).toBeLessThanOrEqual(1) }
      const sum      = r.cells.reduce((s, c) => s + c.weight, 0)
      const boundary = r.cells.filter((c) => c.weight < 0.999).length
      expect(sum).toBeLessThanOrEqual(r.nCandidates)
      expect(sum).toBeGreaterThanOrEqual(n - boundary)
    }, 120_000)
  }
})

describe('gridMask: a polygon smaller than one cell', () => {
  // a 0.1° square inside one 0.25° cell, between the centres (the Gray's Reef case on CMEMS)
  const sq: FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[-80.95, 31.3], [-80.85, 31.3], [-80.85, 31.4], [-80.95, 31.4], [-80.95, 31.3]]] } }] }
  const lon = [-81, -80.75], lat = [31.25, 31.5]
  it('misses every centre, yet keeps the overlapped cells with their area fraction', () => {
    const r = gridMask(sq, lon, lat)
    expect(r.nInside).toBe(0)
    expect(r.cells.length).toBeGreaterThan(0)
    const sum = r.cells.reduce((s, c) => s + c.weight, 0)
    expect(sum).toBeCloseTo(0.16, 2)                       // (0.1 x 0.1) / (0.25 x 0.25)
  })
  it('stays empty without weights (centre-inside only)', () => {
    expect(gridMask(sq, lon, lat, { weights: false }).cells).toHaveLength(0)
  })
})

describe('gridMask: auto method and axis order', () => {
  it('picks turf for a small place and scan for a big one', () => {
    expect(gridMask(fixture('HIHWNMS'), ...Object.values(crwAxes(fixture('HIHWNMS'))) as [number[], number[]], { weights: false }).method).toBe('scan') // HIHWNMS has > 5,000 vertices
    const sq: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }],
    }
    const lon = [0.25, 0.5, 0.75], lat = [0.75, 0.5, 0.25]
    const r = gridMask(sq, lon, lat, { weights: false })
    expect(r.method).toBe('turf')
    expect(r.nInside).toBe(9)
  })
  it('gives the same cells whether latitude ascends or descends', () => {
    const gj = fixture('CINMS')
    const { lon, lat } = crwAxes(gj)
    const a = gridMask(gj, lon, lat, { method: 'scan', weights: false })
    const b = gridMask(gj, lon, [...lat].reverse(), { method: 'scan', weights: false })
    expect(b.nInside).toBe(a.nInside)
    expect(b.cells).toEqual(a.cells)
  })
})

describe('gridMask: a polygon with tens of thousands of vertices (the monuments collection\'s Papahanaumokuakea)', () => {
  // a ring of 60,000 vertices: a circle of radius 1.5 degrees with a 0.01 degree ripple. clipping every
  // boundary cell against the whole ring took 54 s on the real 79,000-vertex monument and froze the tab
  const ring = (n: number, cx = 0.013, cy = 0.007, r = 1.5): number[][] => {
    const pts: number[][] = []
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, rr = r + 0.01 * Math.sin(a * 997)
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
    }
    pts.push(pts[0])
    return pts
  }
  const axis = (a: number, b: number, d: number) => { const v: number[] = []; for (let x = a; x <= b + 1e-9; x += d) v.push(+x.toFixed(4)); return v }

  it('masks and weights a 60,000-vertex ring on a 0.05 degree grid in a couple of seconds', () => {
    const geom = { type: 'Polygon' as const, coordinates: [ring(60_000)] }
    const t = performance.now()
    const m = gridMask(geom, axis(-1.8, 1.8, 0.05), axis(-1.8, 1.8, 0.05))
    const ms = performance.now() - t
    // the disc's area is pi r^2 = 7.07 sq degrees = 2,827 cells of 0.0025; the ripple averages out
    expect(m.nInside).toBeGreaterThan(2780)
    expect(m.nInside).toBeLessThan(2880)
    const w = m.cells.reduce((a, c) => a + c.weight, 0)
    expect(w).toBeGreaterThan(2800)
    expect(w).toBeLessThan(2860)
    expect(ms).toBeLessThan(8000)          // was ~50 s before the rings were reduced per cell
  })

  it('reducing a ring to a rectangle never changes the area clipped to it', () => {
    const rings = [ring(5_000), ring(400, 0.2, 0.1, 0.4).reverse()]            // an outer ring and a hole
    const feat = tPolygon(rings)
    let checked = 0
    for (let k = 0; k < 40; k++) {
      const x0 = -1.8 + (k % 8) * 0.45, y0 = -1.8 + Math.floor(k / 8) * 0.7, r: [number, number, number, number] = [x0, y0, x0 + 0.05, y0 + 0.05]
      const red = reduceRings(rings, r)
      const a0 = area(bboxClip(feat, r) as any)
      const a1 = red ? area(bboxClip(tPolygon(red), r) as any) : 0
      expect(a1).toBeCloseTo(a0, 3)
      if (red) expect(red[0].length).toBeLessThan(rings[0].length)
      checked++
    }
    expect(checked).toBe(40)
  })

  it('keeps a ring whole when it is short, drops one that cannot reach the rectangle, and keeps one that surrounds it', () => {
    const square: number[][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    expect(reduceRing(square, [0.2, 0.2, 0.3, 0.3])).toBe(square)                      // under 8 vertices: untouched
    expect(reduceRing(ring(100, 10, 10, 1), [0, 0, 0.1, 0.1])).toBeNull()               // a ring far away
    const around = reduceRing(ring(100, 0, 0, 1), [-0.1, -0.1, 0.1, 0.1])               // a ring around the rectangle
    expect(around).not.toBeNull()
    const rect = tPolygon([[[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1]]])
    expect(around!.length).toBeLessThan(100)
    expect(area(bboxClip(tPolygon([around!]), [-0.1, -0.1, 0.1, 0.1]) as any) / area(rect)).toBeCloseTo(1, 9)
  })
})
