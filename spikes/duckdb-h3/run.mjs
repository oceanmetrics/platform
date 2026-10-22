// drives the bench page in the system chrome (playwright, channel chrome) and writes results/run.json.
// network bytes: cdp Network on the page target and, for requests made inside the duckdb worker (the core wasm,
// the h3 extension, read_parquet ranges), cdp Network on the worker target over --remote-debugging-port.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { serve } from "./serve.mjs";

const PORT = 5181, DBG = 9333;
const DATA_URL = `http://localhost:${PORT}/data/res5.parquet`;
const EXT_URL = "https://community-extensions.duckdb.org/v1.4.3/wasm_eh/h3.duckdb_extension.wasm";
const RES = [4, 3, 2, 1];
const RUNS = 5;
const COLD = 5; // cold extension loads (fresh context, cache disabled)

// minimal raw cdp client
async function rawCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0;
  const pending = new Map(), handlers = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const [ok, no] = pending.get(m.id); pending.delete(m.id); m.error ? no(new Error(m.error.message)) : ok(m.result); }
    else if (m.method) (handlers.get(m.method) ?? []).forEach((h) => h(m.params));
  };
  return {
    send: (method, params = {}) => new Promise((ok, no) => { const i = ++id; pending.set(i, [ok, no]); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (method, h) => handlers.set(method, [...(handlers.get(method) ?? []), h]),
    close: () => ws.close(),
  };
}
async function workerCdp() {
  for (let i = 0; i < 50; i++) {
    const list = await (await fetch(`http://localhost:${DBG}/json/list`)).json();
    const w = list.find((t) => t.type === "worker" && t.url.includes("duckdb-browser-eh"));
    if (w) return rawCdp(w.webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no duckdb worker target");
}
function netLog(session) {
  const reqs = new Map();
  session.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, method: e.request.method, range: e.request.headers.Range ?? e.request.headers.range, t0: e.timestamp }));
  session.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.encoding = e.response.headers["content-encoding"]; r.protocol = e.response.protocol; r.timing = e.response.timing; } });
  session.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.ms = Math.round((e.timestamp - r.t0) * 1e5) / 100; } });
  session.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r) r.failed = e.errorText; });
  return reqs;
}

// a same-origin copy of the extension (obis-hex self-hosts duckdb-wasm; does LOAD work from our own origin?)
import { mkdirSync as mk, writeFileSync as wf } from "node:fs";
mk("dist/bench/ext", { recursive: true });
wf("dist/bench/ext/h3.duckdb_extension.wasm", Buffer.from(await (await fetch(EXT_URL)).arrayBuffer()));
const SELF_URL = `http://localhost:${PORT}/ext/h3.duckdb_extension.wasm`;

const srv = await serve(PORT);
const browser = await chromium.launch({ channel: "chrome", args: [`--remote-debugging-port=${DBG}`, "--js-flags=--expose-gc"] });
const out = { chrome: browser.version(), when: new Date().toISOString(), data_url: DATA_URL, ext_url: EXT_URL, runs: RUNS };

async function freshPage({ cache = false } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: !cache });
  const pageNet = netLog(cdp);
  page.on("pageerror", (e) => console.error("pageerror", e));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.benchReady);
  return { ctx, page, cdp, pageNet };
}
const ev = (page, fn, ...args) => page.evaluate(([fn, args]) => window.bench[fn](...args), [fn, args]);
const extReqs = (net) => [...net.values()].filter((r) => r.url.includes("duckdb_extension") || r.url.includes("duckdb.org"));

// 1. extension load: cold, per form ----
out.ext_load = [];
const forms = [...Array(COLD).fill(["community"]), ["custom_repo"], ["url", EXT_URL], ["url", SELF_URL]];
for (const [form, url] of forms) {
  const { ctx, page } = await freshPage();
  const boot = await ev(page, "boot");
  const w = await workerCdp();
  await w.send("Network.enable");
  await w.send("Network.setCacheDisabled", { cacheDisabled: true });
  const wNet = netLog(w);
  const r = await ev(page, "loadExt", form, url ?? "");
  await new Promise((ok) => setTimeout(ok, 200));
  r.boot_ms = boot.ms;
  r.requests = extReqs(wNet).map(({ url, status, bytes, encoding, ms, protocol, failed }) => ({ url, status, bytes, encoding, ms, protocol, failed }));
  out.ext_load.push(r);
  if (!out.boot) out.boot = boot;
  console.log(form, r.ok, r.ms, "ms", JSON.stringify(r.requests));
  w.close(); await ctx.close();
}
// warm: second load in the same context with the http cache on
{
  const { ctx, page } = await freshPage({ cache: true });
  await ev(page, "boot");
  await ev(page, "loadExt", "community");
  await page.reload(); await page.waitForFunction(() => window.benchReady);
  await ev(page, "boot");
  const w = await workerCdp(); await w.send("Network.enable"); const wNet = netLog(w);
  const r = await ev(page, "loadExt", "community");
  await new Promise((ok) => setTimeout(ok, 200));
  r.requests = extReqs(wNet).map(({ url, status, bytes, encoding, ms }) => ({ url, status, bytes, encoding, ms }));
  out.ext_load_warm = r;
  console.log("warm", r.ms, JSON.stringify(r.requests));
  w.close(); await ctx.close();
}

// 2. roll-ups, all paths in one page ----
{
  const { ctx, page } = await freshPage();
  await ev(page, "boot");
  const w = await workerCdp(); await w.send("Network.enable"); await w.send("Network.setCacheDisabled", { cacheDisabled: true }); const wNet = netLog(w);
  await ev(page, "loadExt", "community");
  // http read_parquet (cold, then twice more for a median of 3)
  const http = [];
  for (let i = 0; i < 3; i++) http.push(await ev(page, "loadTableHttp", DATA_URL));
  const dataReqs = [...wNet.values()].filter((r) => r.url.includes("res5.parquet"));
  out.load_http = { runs: http, requests_per_load: dataReqs.length / 3, bytes_per_load: dataReqs.reduce((s, r) => s + (r.bytes ?? 0), 0) / 3, requests: dataReqs.map(({ method, range, status, bytes, ms }) => ({ method, range, status, bytes, ms })), note: "runs 2-3 are served from duckdb-wasm's own cache of the file (no new requests)" };
  const buf = [];
  for (let i = 0; i < 3; i++) buf.push(await ev(page, "loadTableBuffer", DATA_URL));
  out.load_buffer = buf;
  out.read_hyparquet = [];
  for (let i = 0; i < 3; i++) out.read_hyparquet.push(await ev(page, "readHyparquet", DATA_URL));
  out.pull_duck = [];
  for (let i = 0; i < 3; i++) out.pull_duck.push(await ev(page, "pullDuck"));
  out.rollup = {};
  for (const r of RES) {
    out.rollup[r] = {
      ext: await ev(page, "rollExt", r, RUNS),
      sql_bits: await ev(page, "rollBits", r, RUNS),
      h3js_hyparquet: await ev(page, "rollH3js", r, "hyparquet", RUNS),
      h3js_duck: await ev(page, "rollH3js", r, "duck", RUNS),
      mixed: await ev(page, "rollMixed", r, RUNS),
      verify: await ev(page, "verify", r),
    };
    const o = out.rollup[r];
    console.log(`res ${r}: rows ${o.ext.rows} | ext ${o.ext.median_ms} | bits ${o.sql_bits.median_ms} | h3js(hp) ${o.h3js_hyparquet.median_ms} | h3js(duck) ${o.h3js_duck.median_ms} | mixed ${o.mixed.median_ms} | verify ${JSON.stringify(o.verify)}`);
  }
  // 4. boundaries
  out.boundary = { duck_wkt: await ev(page, "boundaryDuck", 10000, RUNS), h3js: await ev(page, "boundaryH3js", RUNS) };
  console.log("boundary", JSON.stringify(out.boundary));
  w.close(); await ctx.close();
}

// 3. heap after the roll-ups, one fresh page per path ----
async function heapReading(page, cdp, w) {
  await cdp.send("HeapProfiler.collectGarbage");
  const main = await cdp.send("Runtime.getHeapUsage");
  let worker = null;
  if (w) { await w.send("HeapProfiler.collectGarbage"); worker = await w.send("Runtime.getHeapUsage"); }
  return { main_js_used: main.usedSize, main_backing: main.backingStorageSize, worker_js_used: worker?.usedSize ?? 0, worker_backing_incl_wasm_memory: worker?.backingStorageSize ?? 0 };
}
out.heap = {};
for (const path of ["ext", "sql_bits", "h3js_hyparquet", "mixed"]) {
  const { ctx, page, cdp } = await freshPage();
  let w = null;
  if (path !== "h3js_hyparquet") {
    await ev(page, "boot"); w = await workerCdp();
    if (path === "ext") await ev(page, "loadExt", "community");
    await ev(page, "loadTableBuffer", DATA_URL);
  }
  if (path === "mixed") await ev(page, "pullDuck");
  if (path === "h3js_hyparquet") await ev(page, "readHyparquet", DATA_URL);
  const before = await heapReading(page, cdp, w);
  for (const r of RES) {
    if (path === "ext") await ev(page, "rollExt", r, RUNS);
    if (path === "sql_bits") await ev(page, "rollBits", r, RUNS);
    if (path === "h3js_hyparquet") await ev(page, "rollH3js", r, "hyparquet", RUNS);
    if (path === "mixed") await ev(page, "rollMixed", r, RUNS);
  }
  const after = await heapReading(page, cdp, w);
  const duckmem = w ? await ev(page, "duckMemory") : null;
  out.heap[path] = { before_rollups: before, after_rollups: after, ...duckmem };
  console.log("heap", path, JSON.stringify(out.heap[path]));
  w?.close(); await ctx.close();
}

await browser.close();
srv.close();
mkdirSync("results", { recursive: true });
writeFileSync("results/run.json", JSON.stringify(out, null, 2));
console.log("wrote results/run.json");
