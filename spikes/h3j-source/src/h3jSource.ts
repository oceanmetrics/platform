// the h3j source: a typed port of h3j-h3t's tile path (INSPIDE/h3j-h3t src/index.js, MIT, (c) 2020 INSPIDE;
// the bbest fork 0.9.7 for the MapLibre >= 4 promise protocol) with the antimeridian fix of walkerke/mapgl
// PR 211 (bbest). A tile request `h3j://<name>/{z}/{x}/{y}` asks a provider for the h3 ids and values in the
// tile (h3j: hex id + values, no geometry), builds each cell's hexagon with h3-js, cuts one tile with
// geojson-vt and encodes it as MVT with vt-pbf, so MapLibre draws the cells as a plain vector source.
// What changed from the original: TypeScript; a provider function instead of a fetch per tile (the
// in-memory cells or a PMTiles archive); columnar tiles ({ h3, v }, as obis-hex's partitions) instead of
// h3j's `cells` row objects; one tile cut directly (`geoJSONToTile`, wrap + clip) instead of a whole
// geojson-vt index per tile; the maintained typed forks @maplibre/geojson-vt and @maplibre/vt-pbf (the
// ones maplibre-gl 6 itself depends on); no h3j GeoJSON source or setData (obis-hex does not need them).
import type { AddProtocolAction, VectorSourceSpecification } from "maplibre-gl";
import { cellToBoundary } from "h3-js";
import { geoJSONToTile } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { BUFFER, EXTENT } from "./tiling.ts";

/** one tile of h3j, columnar: h3 ids and one value per id */
export interface H3jTile {
  h3: string[];
  v: ArrayLike<number>;
}

/** the cells of tile z/x/y, or null for none */
export type TileProvider = (z: number, x: number, y: number, signal: AbortSignal) => Promise<H3jTile | null>;

export { BUFFER, EXTENT };

/** the hexagon of one cell as a GeoJSON ring ([lng, lat], closed). A cell across the antimeridian comes
 * back from h3-js with its vertices split between +179 and -179 (a ring spanning ~358 degrees); it is
 * unwrapped (negative longitudes + 360) so it is continuous east of +180, and geojson-vt's wrap then
 * draws it on both sides of the seam (mapgl PR 211). */
export function cellRing(h3: string): [number, number][] {
  const ring = cellToBoundary(h3, true) as [number, number][];
  let min = 180;
  let max = -180;
  for (const p of ring) {
    if (p[0] < min) min = p[0];
    if (p[0] > max) max = p[0];
  }
  return max - min > 180 ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring;
}

/** the tile's cells as polygons with properties { h3, v } */
export function tileToGeoJSON(t: H3jTile): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = new Array(t.h3.length);
  for (let i = 0; i < t.h3.length; i++) {
    features[i] = {
      type: "Feature",
      properties: { h3: t.h3[i], v: t.v[i] },
      geometry: { type: "Polygon", coordinates: [cellRing(t.h3[i])] },
    };
  }
  return { type: "FeatureCollection", features };
}

/** one MVT tile (layer `layer`) from the cells that touch tile z/x/y; an empty buffer when none land in it.
 * `tolerance: 0`: geojson-vt's default simplification (3 units) folds a hexagon smaller than about a pixel
 * (res 5 below zoom 3) into a ring of no area, which draws nothing, so the world view lost most cells. */
export function tileToMvt(t: H3jTile, z: number, x: number, y: number, layer = "h3"): ArrayBuffer {
  const vt = geoJSONToTile(tileToGeoJSON(t), z, x, y, { extent: EXTENT, buffer: BUFFER, wrap: true, clip: true, tolerance: 0 });
  if (!vt || !vt.features.length) return new ArrayBuffer(0);
  const pbf = fromGeojsonVt({ [layer]: vt }, { version: 2, extent: EXTENT });
  return pbf.buffer.slice(pbf.byteOffset, pbf.byteOffset + pbf.byteLength) as ArrayBuffer;
}

const ZXY = /\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/;

/** time spent building tiles on the main thread, for the spike's harness */
export const stats = { tiles: 0, cells: 0, ms: 0 };

/** the protocol action for one provider */
export function h3jAction(provider: TileProvider, layer = "h3"): AddProtocolAction {
  return async (params, abort) => {
    const m = ZXY.exec(params.url.split("?")[0]);
    if (!m) throw new Error(`h3j: no {z}/{x}/{y} in ${params.url}`);
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = await provider(z, x, y, abort.signal);
    if (!t || !t.h3.length) return { data: new ArrayBuffer(0) };
    const t0 = performance.now();
    const data = tileToMvt(t, z, x, y, layer);
    stats.tiles++;
    stats.cells += t.h3.length;
    stats.ms += performance.now() - t0;
    return { data };
  };
}

/** register `<scheme>://` with `addProtocol` (maplibre-gl's on the main thread, or `self.addProtocol` in its
 * workers; passed in so this module never imports maplibre-gl) and return the vector source that reads it;
 * one scheme per provider (MapLibre's protocol registry is global, the fork's lesson in 0.9.7) */
export function h3jSource(
  addProtocol: (scheme: string, action: AddProtocolAction) => void,
  scheme: string,
  provider: TileProvider,
  opts: { name?: string; layer?: string; maxzoom?: number } = {},
): VectorSourceSpecification {
  addProtocol(scheme, h3jAction(provider, opts.layer));
  return {
    type: "vector",
    tiles: [`${scheme}://${opts.name ?? "cells"}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: opts.maxzoom ?? 6,
  };
}
