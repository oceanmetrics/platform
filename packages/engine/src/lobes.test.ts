// the lobe split (erddap-places gazetteer.test.ts's lobe cases, on the GeoJSON fixtures instead of the gazetteer's
// places.parquet) and the place -> lobes -> mask budget of maskPerf.test.ts (its Svelte-proxy half stays in the app:
// the package has no reactive state).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { placeLobes, type LobePlace } from './lobes.js'
import { countVertices, gridMask, polygonParts } from './mask.js'
import type { FeatureCollection } from 'geojson'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const fixture = (n: string) => JSON.parse(fs.readFileSync(path.join(DIR, '..', 'fixtures', `${n}.geojson`), 'utf8')) as FeatureCollection
/** a fixture as a place, its parts as one MultiPolygon (as maskPerf.test.ts asPlace() and make_expected.mjs do) */
const asPlace = (name: string): LobePlace => ({
  place_id: `NMS:${name}`,
  geometry: { type: 'MultiPolygon', coordinates: polygonParts(fixture(name)).map((p) => p.rings) },
})

const BUDGET = 1000                        // ms for lobes + mask with weights
const RES = 0.05, ORIGIN = -179.975        // the CRW 5 km lattice the app requests
/** the CRW axis vectors ERDDAP returns for a bbox, padded a cell (latitude descending). */
function crwAxes(b: [number, number, number, number]) {
  const k   = (v: number) => Math.round((v - ORIGIN) / RES)
  const seq = (a: number, z: number) => { const o: number[] = []; for (let i = a; i <= z; i++) o.push(Number((ORIGIN + i * RES).toFixed(3))); return o }
  return { lon: seq(k(b[0]) - 1, k(b[2]) + 1), lat: seq(k(b[1]) - 1, k(b[3]) + 1).reverse() }
}

describe('placeLobes', () => {
  it('splits PMNM at the antimeridian into two lobes, each inside [-180, 180]', () => {
    const lobes = placeLobes(asPlace('PMNM'))
    expect(lobes.map((l) => l.id)).toEqual(['NMS:PMNM:W', 'NMS:PMNM:E'])
    expect(lobes[0].bbox[0]).toBeGreaterThanOrEqual(-180)
    expect(lobes[0].bbox[2]).toBeLessThanOrEqual(0)     // western lobe, negative longitudes
    expect(lobes[1].bbox[0]).toBeGreaterThanOrEqual(0)  // eastern lobe, positive longitudes
    expect(lobes[1].bbox[2]).toBeLessThanOrEqual(180)
  })

  it('keeps a place that does not cross the antimeridian in one request, with every part', () => {
    const fk = placeLobes(asPlace('FKNMS'))
    expect(fk).toHaveLength(1)
    expect(fk[0].id).toBe('NMS:FKNMS')
    expect(fk[0].nParts).toBe(13)
    expect(fk[0].bbox[2]).toBeLessThan(-80)
    expect(fk[0].geojson.features).toHaveLength(13)
  })

  it('a geometry without polygons has no lobes', () => {
    expect(placeLobes({ place_id: 'X', geometry: { type: 'Point', coordinates: [0, 0] } })).toEqual([])
  })
})

describe('FKNMS mask stays under a second (maskPerf.test.ts)', () => {
  it('the fixture is the full-resolution Florida Keys geometry (13 parts, 39,645 vertices)', () => {
    const ps = polygonParts(fixture('FKNMS'))
    expect(ps.length).toBe(13)
    expect(countVertices(ps)).toBe(39_645)
  })

  it('lobes + weighted mask well inside the budget', () => {
    const t0 = performance.now()
    const lobes = placeLobes(asPlace('FKNMS'))
    const out = lobes.map((l) => gridMask(l.geojson, crwAxes(l.bbox).lon, crwAxes(l.bbox).lat))
    const ms = performance.now() - t0
    expect(out[0].nInside).toBe(352)
    expect(out[0].cells.length).toBe(462)           // the boundary cells with their partial weights (test_mask_parity.py)
    expect(ms).toBeLessThan(BUDGET)
  })
})
