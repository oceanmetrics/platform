// WKB -> GeoJSON, just enough for the gazetteer: (Multi)Point, (Multi)LineString, (Multi)Polygon and
// GeometryCollection. DuckDB-WASM has no spatial extension, so the `geometry` column of
// places.parquet (WKB MULTIPOLYGON, already split at +-180) is decoded here in JS instead.
//
// Both byte orders are handled, plus the two common type-code dialects:
//   ISO WKB : type + 1000 (Z), + 2000 (M), + 3000 (ZM)
//   EWKB    : high bits 0x80000000 (Z), 0x40000000 (M), 0x20000000 (SRID follows the type)
// Z/M ordinates are read and dropped: GeoJSON here is 2-D on purpose (gridMask only wants x, y).
import type { Geometry, GeometryCollection, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from 'geojson'

interface Cursor { view: DataView; off: number; le: boolean }

const u32 = (c: Cursor) => { const v = c.view.getUint32(c.off, c.le); c.off += 4; return v }
const f64 = (c: Cursor) => { const v = c.view.getFloat64(c.off, c.le); c.off += 8; return v }

/** byte order + type code of the geometry at the cursor; leaves the cursor after the header. */
function header(c: Cursor): { type: number; dims: number } {
  const order = c.view.getUint8(c.off); c.off += 1
  if (order !== 0 && order !== 1) throw new Error(`WKB: bad byte order ${order} at ${c.off - 1}`)
  c.le = order === 1
  const raw = u32(c)
  const ewkbZ = (raw & 0x80000000) !== 0
  const ewkbM = (raw & 0x40000000) !== 0
  const srid  = (raw & 0x20000000) !== 0
  const base  = raw & 0x0fffffff
  const iso   = Math.floor(base / 1000)          // 0 = XY, 1 = Z, 2 = M, 3 = ZM
  const type  = base % 1000
  if (srid) u32(c)                                // skip the SRID
  const dims = 2 + (ewkbZ ? 1 : 0) + (ewkbM ? 1 : 0) + (iso === 1 || iso === 2 ? 1 : iso === 3 ? 2 : 0)
  return { type, dims }
}

const point = (c: Cursor, dims: number): number[] => {
  const xy = [f64(c), f64(c)]
  for (let i = 2; i < dims; i++) f64(c)           // drop Z / M
  return xy
}
const ring = (c: Cursor, dims: number): number[][] => {
  const n = u32(c), out: number[][] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = point(c, dims)
  return out
}
const rings = (c: Cursor, dims: number): number[][][] => {
  const n = u32(c), out: number[][][] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = ring(c, dims)
  return out
}

function geometry(c: Cursor): Geometry {
  const { type, dims } = header(c)
  switch (type) {
    case 1: return { type: 'Point',      coordinates: point(c, dims) } as Point
    case 2: return { type: 'LineString', coordinates: ring(c, dims)  } as LineString
    case 3: return { type: 'Polygon',    coordinates: rings(c, dims) } as Polygon
    case 4: case 5: case 6: case 7: {
      const n = u32(c)
      const parts: Geometry[] = new Array(n)
      for (let i = 0; i < n; i++) parts[i] = geometry(c)  // each part carries its own header
      if (type === 7) return { type: 'GeometryCollection', geometries: parts } as GeometryCollection
      if (type === 4) return { type: 'MultiPoint',      coordinates: parts.map((p) => (p as Point).coordinates) } as MultiPoint
      if (type === 5) return { type: 'MultiLineString', coordinates: parts.map((p) => (p as LineString).coordinates) } as MultiLineString
      return { type: 'MultiPolygon', coordinates: parts.map((p) => (p as Polygon).coordinates) } as MultiPolygon
    }
    default: throw new Error(`WKB: unsupported geometry type ${type}`)
  }
}

/** decode one WKB (or EWKB) geometry to GeoJSON, 2-D. */
export function wkbToGeoJSON(bytes: Uint8Array | ArrayBuffer): Geometry {
  const u    = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(u.buffer, u.byteOffset, u.byteLength)
  return geometry({ view, off: 0, le: true })
}

/** every Polygon of a geometry, as a MultiPolygon-style coordinate array. */
export function polygonCoordinates(g: Geometry): number[][][][] {
  if (g.type === 'Polygon')            return [g.coordinates]
  if (g.type === 'MultiPolygon')       return g.coordinates
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonCoordinates)
  return []
}
