// the hexagon fill layer of variants B and C: one data-driven fill over the h3j source's `h3` layer
import type { Map as MapLibreMap } from "maplibre-gl";
export function addHexLayer(map: MapLibreMap, color: unknown[], opacity: number) {
  map.addLayer({
    id: "hexes",
    type: "fill",
    source: "h3",
    "source-layer": "h3",
    paint: { "fill-color": color as never, "fill-opacity": opacity, "fill-antialias": false },
  });
}
