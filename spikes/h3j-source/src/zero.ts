// the baseline for the bundle delta: the same map and harness, no hexagons
import { createMap, expose } from "./common.ts";
const map = createMap(document.getElementById("map")!);
expose(map, { ready: new Promise<number>((r) => map.once("load", () => r(performance.now()))), settled: async () => {}, pending: () => false });
