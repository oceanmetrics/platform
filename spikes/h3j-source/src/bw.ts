// variant BW: the h3j protocol registered in MapLibre's workers (src/h3jWorker.ts) over cells-${DS}.json
import { importScriptInWorkers } from "maplibre-gl";
import workerUrl from "./h3jWorker.ts?worker&url";
import { type Harness, createMap, DS, expose, OPACITY, rampExpression, sourceSettled } from "./common.ts";
import { addHexLayer } from "./hexFill.ts";

const map = createMap(document.getElementById("map")!);
const harness: Harness = {
  ready: Promise.resolve(0),
  cells: 0,
  settled: () => sourceSettled(map, "h3"),
  pending: () => !map.areTilesLoaded(),
};
const loaded = new Promise((r) => map.once("load", r));
harness.ready = (async () => {
  // the ramp domain and the cell count (a few bytes beside the data, written by scripts/extract.mjs)
  const meta = (await (await fetch(`./domain-${DS}.json`)).json()) as { domain: [number, number]; cells: number };
  harness.cells = meta.cells;
  await Promise.all([importScriptInWorkers(new URL(workerUrl, location.href).href), loaded]);
  map.addSource("h3", { type: "vector", tiles: [`h3jw://cells-${DS}.json/{z}/{x}/{y}`], minzoom: 0, maxzoom: 6 });
  addHexLayer(map, rampExpression(meta.domain), OPACITY);
  await sourceSettled(map, "h3");
  return performance.now();
})();
expose(map, harness);
