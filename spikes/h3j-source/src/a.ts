// variant A: deck.gl 9.4 H3HexagonLayer in a MapboxOverlay over MapLibre 6, as obis-hex (hexLayer.ts, map.ts)
import { MapboxOverlay } from "@deck.gl/mapbox";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { type Harness, createMap, expose, loadCells, OPACITY, rampColor } from "./common.ts";

const map = createMap(document.getElementById("map")!);
let layerLoaded = false;
let notify: (() => void) | null = null;
const overlay = new MapboxOverlay({
  interleaved: false,
  layers: [],
  onAfterRender: () => {
    const layers = (overlay as unknown as { _deck?: { props: { layers: { isLoaded: boolean }[] } } })._deck?.props.layers ?? [];
    layerLoaded = layers.length > 0 && layers.every((l) => l.isLoaded);
    if (layerLoaded && notify) { const n = notify; notify = null; n(); }
  },
});
map.addControl(overlay);
const drawn = () => new Promise<void>((r) => { if (layerLoaded) r(); else notify = r; });

const harness: Harness = {
  ready: Promise.resolve(0),
  cells: 0,
  settled: async () => { await harness.ready; await drawn(); },
  pending: () => !layerLoaded,
};
harness.ready = (async () => {
  const [cells] = await Promise.all([loadCells(), new Promise((r) => map.once("load", r))]);
  const n = cells.h3.length;
  const colors = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = rampColor(cells.v[i], cells.domain);
    colors.set([c[0], c[1], c[2], 255], i * 4);
  }
  harness.cells = n;
  overlay.setProps({
    layers: [
      new H3HexagonLayer({
        id: "hexes",
        data: { length: n },
        getHexagon: (_: unknown, { index }: { index: number }) => cells.h3[index],
        getFillColor: (_: unknown, { index }: { index: number }) => [colors[index * 4], colors[index * 4 + 1], colors[index * 4 + 2], colors[index * 4 + 3]],
        filled: true, stroked: false, extruded: false,
        pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 110],
        highPrecision: "auto", opacity: OPACITY,
      }),
    ],
  });
  await drawn();
  await new Promise(requestAnimationFrame);
  return performance.now();
})();
expose(map, harness);
