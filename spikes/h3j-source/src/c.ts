// variant C: the same h3j protocol reading precomputed h3j tiles (z 0..6) from one PMTiles archive by range request
import { PMTiles } from "pmtiles";
import { addProtocol } from "maplibre-gl";
import { type Harness, createMap, DS, expose, OPACITY, rampExpression, sourceSettled } from "./common.ts";
import { h3jSource, stats, type H3jTile } from "./h3jSource.ts";
import { addHexLayer } from "./hexFill.ts";

const map = createMap(document.getElementById("map")!);
const archive = new PMTiles(new URL(`./h3j-${DS}.pmtiles`, location.href).href);
const decoder = new TextDecoder();
const harness: Harness = {
  ready: Promise.resolve(0),
  cells: 0,
  settled: () => sourceSettled(map, "h3"),
  pending: () => !map.areTilesLoaded(),
  extra: () => ({ tilesBuilt: stats.tiles, tileMs: stats.ms }),
};
harness.ready = (async () => {
    const [meta] = await Promise.all([archive.getMetadata() as Promise<{ domain: [number, number]; value: string; cells: number }>, new Promise((r) => map.once("load", r))]);
    harness.cells = meta.cells;
    const provider = async (z: number, x: number, y: number, signal: AbortSignal): Promise<H3jTile | null> => {
      const r = await archive.getZxy(z, x, y, signal);
      return r ? (JSON.parse(decoder.decode(r.data)) as H3jTile) : null;
    };
    map.addSource("h3", h3jSource(addProtocol, "h3jpm", provider, { name: meta.value, maxzoom: 6 }));
    addHexLayer(map, rampExpression(meta.domain), OPACITY);
    await sourceSettled(map, "h3");
    return performance.now();
  })();
expose(map, harness);
