// day 3 check: range reads against the R2 worker preview and S3 from the browser.
// every check is a window.bench function so run.mjs can drive it and read cdp network logs around it.
// the duckdb boot copies obis-hex / duckdb-h3: 1.32.0, self-hosted eh bundle.
import * as duckdb from "@duckdb/duckdb-wasm";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { PMTiles, FetchSource, Protocol } from "pmtiles";
import { Map as MapLibreMap, addProtocol, removeProtocol, setWorkerUrl, getVersion } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
setWorkerUrl(maplibreWorkerUrl);
import { fromUrl } from "geotiff";

const now = () => performance.now();
const r2 = (x: number) => Math.round(x * 100) / 100;

// 1. hyparquet ----
async function hyparquet(url: string) {
  const t0 = now();
  const file = await asyncBufferFromUrl({ url });
  const t_open = now() - t0;
  // full metadata read (footer only)
  const t1 = now();
  const md = await parquetMetadataAsync(file);
  const t_meta = now() - t1;
  const rg0 = md.row_groups[0];
  const n0 = Number(rg0.num_rows);
  // three columns, first row group only
  const t2 = now();
  const rows = await parquetReadObjects({ file, metadata: md, columns: ["place_id", "name", "collection"], rowStart: 0, rowEnd: n0, compressors });
  const t_rows = now() - t2;
  return {
    ms: r2(now() - t0), ms_open_head: r2(t_open), ms_metadata: r2(t_meta), ms_rows: r2(t_rows),
    byte_length: file.byteLength, num_rows: Number(md.num_rows), row_groups: md.row_groups.length, rg0_rows: n0,
    read_rows: rows.length, sample: rows.slice(0, 2),
  };
}

// 2. duckdb-wasm ----
let db: duckdb.AsyncDuckDB;
let conn: duckdb.AsyncDuckDBConnection;
async function duckBoot(mode: "range" | "default") {
  const bundle = await duckdb.selectBundle({ mvp: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl }, eh: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl } });
  const worker = new Worker(bundle.mainWorker!);
  db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  if (mode === "range") await db.open({ filesystem: { forceFullHTTPReads: false } });
  else await db.open({});
  conn = await db.connect();
  const v = (await conn.query("SELECT version() v")).toArray()[0];
  return { duckdb: String(v.v), duckdb_wasm: await db.getVersion(), mode };
}
async function duckQuery(url: string) {
  const t0 = now();
  const res = await conn.query(`SELECT collection, count(*)::INT AS n FROM read_parquet('${url}') GROUP BY 1 ORDER BY 2 DESC`);
  const rows = res.toArray().map((r: any) => ({ collection: String(r.collection), n: Number(r.n) }));
  return { ms: r2(now() - t0), n_groups: rows.length, total: rows.reduce((s, r) => s + r.n, 0), top: rows.slice(0, 3) };
}

// 3. pmtiles ----
async function pmtilesRaw(url: string, z = 2, x = 0, y = 1) {
  const t0 = now();
  const p = new PMTiles(new FetchSource(url));
  const h = await p.getHeader();
  const t_header = now() - t0;
  const t1 = now();
  const tile = await p.getZxy(z, x, y);
  const t_tile = now() - t1;
  return {
    ms: r2(now() - t0), ms_header: r2(t_header), ms_tile: r2(t_tile),
    header: { minZoom: h.minZoom, maxZoom: h.maxZoom, numAddressedTiles: h.numAddressedTiles, tileType: h.tileType, rootDirectoryLength: h.rootDirectoryLength, minLon: h.minLonE7 / 1e7, maxLon: h.maxLonE7 / 1e7 },
    tile_bytes: tile?.data ? tile.data.byteLength : null,
  };
}
async function pmtilesDraw(url: string, sourceLayer: string) {
  const t0 = now();
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile);
  const map = new MapLibreMap({
    container: "map",
    style: {
      version: 8,
      sources: { p: { type: "vector", url: `pmtiles://${url}` } },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#dfe9f3" } },
        { id: "fill", type: "fill", source: "p", "source-layer": sourceLayer, paint: { "fill-color": "#1d7a8c", "fill-opacity": 0.5 } },
        { id: "line", type: "line", source: "p", "source-layer": sourceLayer, paint: { "line-color": "#0a3d4a", "line-width": 1 } },
      ],
    },
    center: [-98, 39], zoom: 3, fadeDuration: 0, attributionControl: false,
  });
  await new Promise<void>((ok, no) => { map.once("error", (e: any) => no(e.error ?? e)); map.once("idle", () => ok()); });
  const ms = now() - t0;
  const feats = map.queryRenderedFeatures({ layers: ["fill"] }).length;
  const loaded = map.areTilesLoaded();
  map.remove();
  removeProtocol("pmtiles");
  return { ms_to_idle: r2(ms), rendered_features: feats, tiles_loaded: loaded, maplibre: getVersion() };
}

// 4. cog ----
async function cog(url: string) {
  const t0 = now();
  const tiff = await fromUrl(url, { allowFullFile: false });
  const n = await tiff.getImageCount();
  const t_open = now() - t0;
  const small = await tiff.getImage(n - 1);
  const t1 = now();
  const w = small.getWidth(), h = small.getHeight(), bands = small.getSamplesPerPixel();
  const whole = (await small.readRasters({ samples: [0] })) as any;
  const t_small = now() - t1;
  const img0 = await tiff.getImage(0);
  const W = img0.getWidth(), H = img0.getHeight();
  const x0 = Math.max(0, Math.floor(W / 2) - 128), y0 = Math.max(0, Math.floor(H / 2) - 128);
  const t2 = now();
  const win = (await img0.readRasters({ window: [x0, y0, Math.min(W, x0 + 256), Math.min(H, y0 + 256)], samples: [0] })) as any;
  const t_win = now() - t2;
  const stat = (a: ArrayLike<number>) => { let n = 0, s = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; if (Number.isFinite(v)) { n++; s += v; } } return { n, mean: n ? s / n : null }; };
  return {
    ms: r2(now() - t0), ms_open: r2(t_open), ms_small_overview: r2(t_small), ms_window: r2(t_win),
    n_images: n, full: [W, H], bands_small: bands, small: [w, h], small_is_overview: n > 1,
    small_stat: stat(whole[0]), window: [Math.min(W, x0 + 256) - x0, Math.min(H, y0 + 256) - y0], window_stat: stat(win[0]),
    block: [img0.getTileWidth(), img0.getTileHeight()], samples_per_pixel: img0.getSamplesPerPixel(),
  };
}

// 5. a preflighted fetch: if-none-match is not CORS-safelisted, so the browser sends OPTIONS first ----
async function preflight(url: string) {
  const t0 = now();
  const res = await fetch(url, { headers: { Range: "bytes=0-1023", "If-None-Match": '"om-spike-no-such-etag"' } });
  const buf = await res.arrayBuffer();
  return { ms: r2(now() - t0), status: res.status, bytes: buf.byteLength, content_range: res.headers.get("content-range"), warn: res.headers.get("x-om-warn"), usage: res.headers.get("x-om-usage") };
}

(window as any).bench = { hyparquet, duckBoot, duckQuery, pmtilesRaw, pmtilesDraw, cog, preflight };
(window as any).benchReady = true;
