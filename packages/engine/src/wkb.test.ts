// WKB decode contract. the little-endian fixtures are DuckDB's own ST_AsWKB() output; the
// big-endian one is the same square written by hand, so both byte orders are covered.
import { describe, expect, it } from 'vitest'
import { polygonCoordinates, wkbToGeoJSON } from './wkb.js'
import type { MultiPolygon, Polygon } from 'geojson'

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)))

// POLYGON((0 0,3 0,3 2,0 2,0 0),(1 .5,2 .5,2 1.5,1 1.5,1 .5)) — outer ring + hole
const POLY_LE =
  '01030000000200000005000000000000000000000000000000000000000000000000000840000000000000000000000000000008400000' +
  '000000000040000000000000000000000000000000400000000000000000000000000000000005000000000000000000F03F0000000000' +
  '00E03F0000000000000040000000000000E03F0000000000000040000000000000F83F000000000000F03F000000000000F83F00000000' +
  '0000F03F000000000000E03F'
// MULTIPOLYGON(((-179 20,...)),((179 20,...))) — the two antimeridian lobes
const MULTI_LE =
  '0106000000020000000103000000010000000500000000000000006066C0000000000000344000000000004066C0000000000000344000' +
  '000000004066C0000000000000354000000000006066C0000000000000354000000000006066C000000000000034400103000000010000' +
  '00050000000000000000606640000000000000344000000000008066400000000000003440000000000080664000000000000035400000' +
  '000000606640000000000000354000000000006066400000000000003440'
// big-endian POLYGON((0 0,1 0,1 1,0 1,0 0))
const POLY_BE =
  '0000000003' + '00000001' + '00000005' +
  '00000000000000000000000000000000' +
  '3FF00000000000000000000000000000' +
  '3FF00000000000003FF0000000000000' +
  '00000000000000003FF0000000000000' +
  '00000000000000000000000000000000'

describe('wkbToGeoJSON', () => {
  it('decodes a little-endian polygon with a hole', () => {
    const g = wkbToGeoJSON(bytes(POLY_LE)) as Polygon
    expect(g.type).toBe('Polygon')
    expect(g.coordinates).toHaveLength(2)
    expect(g.coordinates[0]).toEqual([[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]])
    expect(g.coordinates[1][0]).toEqual([1, 0.5])
  })

  it('decodes a multipolygon into one ring set per lobe', () => {
    const g = wkbToGeoJSON(bytes(MULTI_LE)) as MultiPolygon
    expect(g.type).toBe('MultiPolygon')
    expect(g.coordinates).toHaveLength(2)
    expect(g.coordinates[0][0][0]).toEqual([-179, 20])
    expect(g.coordinates[1][0][1]).toEqual([180, 20])
    expect(polygonCoordinates(g)).toHaveLength(2)
  })

  it('decodes a big-endian polygon', () => {
    const g = wkbToGeoJSON(bytes(POLY_BE)) as Polygon
    expect(g.coordinates[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])
  })

  it('reads the geometry from a non-zero byte offset in a shared buffer', () => {
    const src  = bytes(POLY_LE)
    const pad  = new Uint8Array(src.length + 8)
    pad.set(src, 8)
    const view = pad.subarray(8)
    expect((wkbToGeoJSON(view) as Polygon).coordinates[0][2]).toEqual([3, 2])
  })

  it('rejects an unknown geometry type', () => {
    expect(() => wkbToGeoJSON(bytes('0163000000'))).toThrow(/unsupported geometry type/)
  })

  it('polygonCoordinates of a non-areal geometry is empty', () => {
    expect(polygonCoordinates({ type: 'Point', coordinates: [0, 0] })).toEqual([])
  })
})
