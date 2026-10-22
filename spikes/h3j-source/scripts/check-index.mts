// sanity: every cell lands in the tile of its own centroid at z 0..6, and the antimeridian tiles get the crossing cells
import { readFileSync } from "node:fs";
import { cellToLatLng } from "h3-js";
import { CellIndex } from "../src/cellIndex.ts";
const d = JSON.parse(readFileSync("public/cells-es.json", "utf8"));
const t0 = performance.now();
const idx = new CellIndex({ h3: d.h3, v: d.v });
console.log(`index: ${idx.byParent.size} parents, ${(performance.now() - t0).toFixed(0)} ms`);
const lonLatToTile = (lon: number, lat: number, z: number) => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};
for (const z of [0, 2, 4, 6]) {
  let miss = 0, checked = 0, ms = 0;
  const cache = new Map<string, Set<string>>();
  for (let i = 0; i < d.h3.length; i += 37) {
    const [lat, lon] = cellToLatLng(d.h3[i]);
    if (Math.abs(lat) > 85) continue;
    const [x, y] = lonLatToTile(lon, lat, z);
    const k = `${x}/${y}`;
    if (!cache.has(k)) { const a = performance.now(); cache.set(k, new Set(idx.tile(z, x, y).h3)); ms += performance.now() - a; }
    checked++;
    if (!cache.get(k)!.has(d.h3[i])) miss++;
  }
  console.log(`z${z}: ${checked} checked, ${miss} missing, ${cache.size} tiles, ${(ms / cache.size).toFixed(1)} ms/tile lookup`);
}
// fiji seam at z6: tile x=0 (west edge) must hold the crossing cell 85...? from either side
const z = 6, [xe, ye] = lonLatToTile(179.99, -17, z), [xw] = lonLatToTile(-179.99, -17, z);
const te = idx.tile(z, xe, ye), tw = idx.tile(z, xw, ye);
console.log(`fiji z6 east tile ${xe}/${ye}: ${te.h3.length} cells, west tile ${xw}/${ye}: ${tw.h3.length} cells, shared ${te.h3.filter((h) => tw.h3.includes(h)).length}`);
