// the lobe split of a place: one griddap request per lobe. moved from erddap-places `app/src/lib/gazetteer.ts`
// (`placeLobes`, `Lobe`, `partBbox`); the logic is unchanged (the Python twin `om_extract.geom.place_lobes` and the
// parity fixtures in extract/tests/fixtures/mask were generated from it). `LobePlace` is the slice of the gazetteer's
// `Place` the split reads.
import { polygonCoordinates } from './wkb.js'
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson'

/** what placeLobes() reads of a place: its id and its (Multi)Polygon, already split at ±180 */
export interface LobePlace { place_id: string; geometry: Geometry }
// the name the moved function text uses (kept, so its text stays byte-identical to the original)
type Place = LobePlace

/** one griddap request's worth of a place: its own bbox and the polygons inside it. */
export interface Lobe {
  id      : string
  bbox    : [number, number, number, number]
  geojson : FeatureCollection
  nParts  : number
}

const partBbox = (rings: number[][][]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of rings[0]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

/**
 * Split a place into the lobes that each get one griddap request.
 *
 * Parts are grouped by side of the antimeridian, and only when the place actually spans it (a
 * lon extent wider than 180°, as for PMNM): a place wholly on one side stays a single request
 * covering all its parts. The polygon parts themselves are never modified — the gazetteer has
 * already split them at ±180.
 */
export function placeLobes(place: Place): Lobe[] {
  const parts = polygonCoordinates(place.geometry)
  if (!parts.length) return []
  const boxes = parts.map(partBbox)
  const x0 = Math.min(...boxes.map((b) => b[0])), x1 = Math.max(...boxes.map((b) => b[2]))
  const split = x1 - x0 > 180

  const groups = new Map<string, number[]>()
  boxes.forEach((b, i) => {
    const g = !split ? 'all' : (b[0] + b[2]) / 2 < 0 ? 'W' : 'E'
    ;(groups.get(g) ?? groups.set(g, []).get(g)!).push(i)
  })

  const lobes: Lobe[] = []
  for (const [g, idx] of groups) {
    const feats: Feature<Polygon>[] = idx.map((i) => ({
      type: 'Feature', properties: { place_id: place.place_id },
      geometry: { type: 'Polygon', coordinates: parts[i] },
    }))
    lobes.push({
      id     : `${place.place_id}${g === 'all' ? '' : `:${g}`}`,
      bbox   : [Math.min(...idx.map((i) => boxes[i][0])), Math.min(...idx.map((i) => boxes[i][1])),
                Math.max(...idx.map((i) => boxes[i][2])), Math.max(...idx.map((i) => boxes[i][3]))],
      geojson: { type: 'FeatureCollection', features: feats },
      nParts : idx.length,
    })
  }
  return lobes.sort((a, b) => a.bbox[0] - b.bbox[0])
}
