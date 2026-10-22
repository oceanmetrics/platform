// the h3j protocol inside MapLibre's workers (loaded with importScriptInWorkers, which import()s a `.mjs`):
// `h3jw://<file>/{z}/{x}/{y}` reads <file> next to the page: a PMTiles archive of h3j tiles (range requests
// from the worker) or a cells JSON (fetched once per worker, indexed by res-2 parent). The tile is built and
// encoded in the worker, so the main thread only draws.
import type { AddProtocolAction } from "maplibre-gl";
import { PMTiles } from "pmtiles";
import { h3jAction, type H3jTile, type TileProvider } from "./h3jSource.ts";
import { CellIndex } from "./cellIndex.ts";

const scope = self as unknown as { addProtocol(scheme: string, action: AddProtocolAction): void };
const decoder = new TextDecoder();
const actions = new Map<string, AddProtocolAction>();

function providerFor(file: string): TileProvider {
  // the page directory: this module sits in its assets/ (string math, so Vite does not glob `new URL(`../${file}`)`)
  const url = import.meta.url.replace(/assets\/[^/]+$/, "") + file;
  if (file.endsWith(".pmtiles")) {
    const archive = new PMTiles(url);
    return async (z, x, y, signal) => {
      const r = await archive.getZxy(z, x, y, signal);
      return r ? (JSON.parse(decoder.decode(r.data)) as H3jTile) : null;
    };
  }
  const index = fetch(url).then((r) => r.json()).then((d: H3jTile) => new CellIndex({ h3: d.h3, v: d.v }));
  return async (z, x, y) => (await index).tile(z, x, y);
}

scope.addProtocol("h3jw", (params, abort) => {
  const file = params.url.split("://")[1].split("/")[0];
  let action = actions.get(file);
  if (!action) actions.set(file, (action = h3jAction(providerFor(file))));
  return action(params, abort);
});
