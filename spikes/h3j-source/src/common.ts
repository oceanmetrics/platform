// the page shell every variant shares: one MapLibre 6 map wired as obis-hex wires it (named imports, the
// worker via `?worker&url` + setWorkerUrl, preserveDrawingBuffer), the viridis ramp of obis-hex ramp.ts, the
// two camera scripts, and the harness hooks Playwright calls (`window.__spike`).
import { Map as MapLibreMap, setWorkerCount, setWorkerUrl } from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

export const params = new URLSearchParams(location.search);
export const DS = params.get("ds") ?? "es";
export const VIEW = (params.get("view") ?? "fiji") as keyof typeof VIEWS;
export const OPACITY = 0.85;

/** viridis, 9 stops (obis-hex ramp.ts) */
export const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141],
  [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37],
];
export type Domain = [number, number];
export function rampColor(v: number, [lo, hi]: Domain): [number, number, number] {
  const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5;
  const x = t * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}
/** the same ramp as a MapLibre expression (MapLibre interpolates colours in RGB, as rampColor does) */
export function rampExpression([lo, hi]: Domain): unknown[] {
  const stops = VIRIDIS.flatMap((c, i) => [lo + ((hi - lo) * i) / (VIRIDIS.length - 1), `rgb(${c.join(",")})`]);
  return ["interpolate", ["linear"], ["get", "v"], ...stops];
}

export interface Cells { col: string; domain: Domain; h3: string[]; v: number[] }
export const loadCells = async (): Promise<Cells> => (await fetch(`./cells-${DS}.json`)).json();

/** the start camera and the scripted 5 s pan + zoom of each view (u from 0 to 1) */
export const VIEWS = {
  // across the antimeridian east of Fiji, zooming in and out
  fiji: (u: number) => ({ center: [175 + 15 * u, -17.5 + 2 * Math.sin(2 * Math.PI * u)] as [number, number], zoom: 5 + 1.5 * Math.sin(Math.PI * u) }),
  // a quarter of the world east, zooming in by one and back
  world: (u: number) => ({ center: [90 * u, 15] as [number, number], zoom: 1.5 + Math.sin(Math.PI * u) }),
};

const CARTO_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const blank = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0e1626" } }] });

export function createMap(container: HTMLElement): MapLibreMap {
  setWorkerUrl(maplibreWorkerUrl);
  // MapLibre 6 runs one worker outside Safari; `?workers=N` raises it (before the first map)
  if (params.get("workers")) setWorkerCount(Number(params.get("workers")));
  const map = new MapLibreMap({
    container,
    style: params.get("basemap") === "carto" ? CARTO_DARK : blank(),
    ...VIEWS[VIEW](0),
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    renderWorldCopies: true,
    fadeDuration: 0,
  });
  (window as unknown as { __map: MapLibreMap }).__map = map;
  return map;
}

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));

export interface Harness {
  /** ms from navigation start to the first full draw */
  ready: Promise<number>;
  cells?: number;
  /** waits until the hexagons of the current view are drawn */
  settled(): Promise<void>;
  /** true while some hexagon tiles of the view are still missing */
  pending(): boolean;
  extra?(): Record<string, number>;
}

/** expose the harness: `__spike.run(view)` drives the camera for `ms` and returns the rAF frame times */
export function expose(map: MapLibreMap, h: Harness) {
  const longTasks: { start: number; dur: number }[] = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push({ start: e.startTime, dur: e.duration }); }).observe({ type: "longtask", buffered: true });
  } catch { /* no longtask timing */ }
  const api = {
    ready: h.ready,
    cells: () => h.cells,
    renderer: () => {
      const gl = map.getCanvas().getContext("webgl2") as WebGL2RenderingContext | null;
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
    },
    async jump(view: keyof typeof VIEWS, u = 0) {
      map.jumpTo(VIEWS[view](u));
      await h.settled();
      for (let i = 0; i < 3; i++) await raf();
    },
    async run(view: keyof typeof VIEWS, ms = 5000) {
      await api.jump(view, 0);
      // the display's frame interval, from 30 idle frames (median)
      const idle: number[] = [];
      let last = await raf();
      for (let i = 0; i < 30; i++) { const t = await raf(); idle.push(t - last); last = t; }
      idle.sort((a, b) => a - b);
      const before = h.extra?.() ?? {};
      const frames: number[] = [];
      let pending = 0;
      const start = await raf();
      last = start;
      for (;;) {
        const u = Math.min(1, (last - start) / ms);
        map.jumpTo(VIEWS[view](u));
        const t = await raf();
        frames.push(t - last);
        if (h.pending()) pending++;
        last = t;
        if (u >= 1) break;
      }
      const end = performance.now();
      await h.settled();
      const settle = performance.now() - end;
      const after = h.extra?.() ?? {};
      const lt = longTasks.filter((e) => e.start >= start && e.start <= end);
      const delta = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - (before[k] ?? 0)]));
      return {
        interval: idle[15], frames, pending, settle,
        longTasks: lt.length, longTaskMs: lt.reduce((s, e) => s + e.dur, 0), ...delta,
      };
    },
  };
  (window as unknown as { __spike: typeof api }).__spike = api;
}

/** resolves on the first `idle` with every tile of the source loaded */
export function sourceSettled(map: MapLibreMap, source: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (map.getSource(source) && map.isSourceLoaded(source) && map.areTilesLoaded()) { map.off("idle", check); resolve(); }
    };
    map.on("idle", check);
    map.triggerRepaint();
  });
}
