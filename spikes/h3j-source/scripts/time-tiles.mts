// node timing of tile builds (lookup + hexagons + geojson-vt + vt-pbf) at the world and Fiji views
import { readFileSync } from "node:fs";
import { CellIndex } from "../src/cellIndex.ts";
import { tileToMvt } from "../src/h3jSource.ts";
for (const ds of ["es", "n"]) {
  const d = JSON.parse(readFileSync(`public/cells-${ds}.json`, "utf8"));
  const idx = new CellIndex({ h3: d.h3, v: d.v });
  for (const [z, xs, ys] of [[1, [0, 1], [0, 1]], [2, [0, 1, 2, 3], [1, 2]], [5, [31, 0], [17, 18]], [6, [63, 0], [34, 35, 36]]] as [number, number[], number[]][]) {
    let ms = 0, cells = 0, bytes = 0, n = 0;
    for (const x of xs) for (const y of ys) {
      const a = performance.now(); const t = idx.tile(z, x, y); const b = tileToMvt(t, z, x, y); ms += performance.now() - a; cells += t.h3.length; bytes += b.byteLength; n++;
    }
    console.log(`${ds} z${z}: ${n} tiles, ${(cells / n).toFixed(0)} cells/tile, ${(ms / n).toFixed(1)} ms/tile, ${(bytes / n / 1024).toFixed(0)} KB mvt/tile`);
  }
}
