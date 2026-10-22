// the tile lookup over in-memory cells: the cells are grouped by their res-2 parent (the shape of obis-hex's
// parent partitions), and a tile asks for the res-2 cells that overlap its bbox, grown by a margin, then
// takes their children. A child can poke out of its parent by part of a cell, so the margin is two res-5
// cells (and geojson-vt's tile buffer); geojson-vt clips what lands outside the tile. Tiles next to the
// antimeridian also take the strip on the other side of it, so the wrapped copies (cellRing) reach them.
import { cellToParent, polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS } from "h3-js";
import type { H3jTile } from "./h3jSource.ts";
import { BUFFER, EXTENT } from "./tiling.ts";

export const PARENT_RES = 2;
/** two res-5 cells, in degrees of latitude (res-5 edge about 9.85 km) */
const MARGIN_DEG = 0.18;
const MAX_LAT = 89.5;

/** tile z/x/y as [west, south, east, north] in degrees (web mercator) */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/** a bbox as h3 polygons of at most 60 degrees of longitude, edges densified every 2 degrees (h3's edges
 * are great circles, the bbox's are parallels) */
function bboxPolygons(w: number, s: number, e: number, n: number): number[][][] {
  const out: number[][][] = [];
  for (let a = w; a < e; a += 60) {
    const b = Math.min(e, a + 60);
    const ring: number[][] = [];
    const steps = Math.max(1, Math.ceil((b - a) / 2));
    for (let i = 0; i <= steps; i++) ring.push([a + ((b - a) * i) / steps, s]);
    for (let i = 0; i <= steps; i++) ring.push([b - ((b - a) * i) / steps, n]);
    ring.push([a, s]);
    out.push(ring);
  }
  return out;
}

export class CellIndex {
  readonly byParent = new Map<string, number[]>();
  readonly cells: H3jTile;
  readonly parentRes: number;

  constructor(cells: H3jTile, parentRes = PARENT_RES) {
    this.cells = cells;
    this.parentRes = parentRes;
    for (let i = 0; i < cells.h3.length; i++) {
      const p = cellToParent(cells.h3[i], parentRes);
      const list = this.byParent.get(p);
      if (list) list.push(i);
      else this.byParent.set(p, [i]);
    }
  }

  /** the res-2 parents overlapping tile z/x/y plus its margin, across the antimeridian when it is near */
  parents(z: number, x: number, y: number): Set<string> {
    const [w0, s0, e0, n0] = tileBounds(z, x, y);
    const pad = ((e0 - w0) * BUFFER) / EXTENT;
    const latPad = MARGIN_DEG + ((n0 - s0) * BUFFER) / EXTENT;
    const s = Math.max(-MAX_LAT, s0 - latPad);
    const n = Math.min(MAX_LAT, n0 + latPad);
    const cos = Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180);
    const lonPad = pad + MARGIN_DEG / Math.max(cos, 0.01);
    let w = w0 - lonPad;
    let e = e0 + lonPad;
    const spans: [number, number][] = [];
    if (e - w >= 360) spans.push([-180, 180]);
    else {
      if (w < -180) { spans.push([w + 360, 180]); w = -180; }
      if (e > 180) { spans.push([-180, e - 360]); e = 180; }
      spans.push([w, e]);
    }
    const out = new Set<string>();
    for (const [a, b] of spans)
      for (const poly of bboxPolygons(a, s, b, n))
        for (const c of polygonToCellsExperimental(poly, this.parentRes, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true))
          out.add(c);
    return out;
  }

  /** the cells (ids and values) that may touch tile z/x/y */
  tile(z: number, x: number, y: number): H3jTile {
    const h3: string[] = [];
    const v: number[] = [];
    for (const p of this.parents(z, x, y)) {
      const list = this.byParent.get(p);
      if (!list) continue;
      for (const i of list) {
        h3.push(this.cells.h3[i]);
        v.push(this.cells.v[i]);
      }
    }
    return { h3, v };
  }
}
