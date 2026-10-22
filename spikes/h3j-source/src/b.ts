// variant B: the h3j source over the in-memory cells (CellIndex by res-2 parent), tiles built on the main thread
import { addProtocol } from "maplibre-gl";
import { type Harness, createMap, expose, loadCells, OPACITY, rampExpression, sourceSettled } from "./common.ts";
import { h3jSource, stats } from "./h3jSource.ts";
import { CellIndex } from "./cellIndex.ts";
import { addHexLayer } from "./hexFill.ts";

const map = createMap(document.getElementById("map")!);
const harness: Harness = {
  ready: Promise.resolve(0),
  cells: 0,
  settled: () => sourceSettled(map, "h3"),
  pending: () => !map.areTilesLoaded(),
  extra: () => ({ tilesBuilt: stats.tiles, tileMs: stats.ms }),
};
harness.ready = (async () => {
    const [cells] = await Promise.all([loadCells(), new Promise((r) => map.once("load", r))]);
    const idx = new CellIndex({ h3: cells.h3, v: cells.v });
    harness.cells = cells.h3.length;
    map.addSource("h3", h3jSource(addProtocol, "h3j", async (z, x, y) => idx.tile(z, x, y), { name: cells.col }));
    addHexLayer(map, rampExpression(cells.domain), OPACITY);
    await sourceSettled(map, "h3");
    return performance.now();
  })();
expose(map, harness);
