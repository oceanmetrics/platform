// drives the bench page in the system chrome (playwright, channel chrome) and writes results/results.json.
// usage: OM_KEY=<preview key> [OUT_NAME=x.json RUNS=3 SKIP=4b,4c] node run.mjs [a|b]   a = checks 1, 2, 5 (files already on the worker); b = checks 3, 4 (wait for the mirror)
// network log: cdp Network on the page target and, for requests made inside the duckdb worker, cdp Network on the worker
// target over --remote-debugging-port. every check runs RUNS times against the worker and S3, interleaved, in a fresh
// browser context with the http cache disabled (so every run is cold for chrome; the cloudflare edge may still be warm).
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { serve } from "./serve.mjs";

const PORT = 5190, DBG = 9334, RUNS = Math.max(1, Number(process.env.RUNS ?? 3) || 3); // RUNS env: runs per check and origin
const KEY = process.env.OM_KEY ?? "";
const WORKER = "https://om-gazetteer.ben-f07.workers.dev/";
const S3 = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/";
const ORIGIN = `http://localhost:${PORT}`;
const PHASE = process.argv[2] ?? "a";
const SKIP = (process.env.SKIP ?? "").split(",").filter(Boolean); // e.g. SKIP=4b to skip the atlas COG
const WAIT_MS = 45 * 60e3, POLL_MS = 60e3;
const OUT = new URL(`./results/${process.env.OUT_NAME ?? "results.json"}`, import.meta.url).pathname;
mkdirSync(new URL("./results/", import.meta.url).pathname, { recursive: true });

const redact = (s) => (KEY ? String(s).replaceAll(KEY, "<preview-key>") : String(s));
const targets = [
  { name: "worker", base: WORKER, q: KEY ? `?key=${KEY}` : "" },
  { name: "s3", base: S3, q: "" },
];
const urlOf = (t, path) => `${t.base}${path}${t.q}`;
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// ---- cdp helpers ----
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
  for (let i = 0; i < 80; i++) {
    const list = await (await fetch(`http://localhost:${DBG}/json/list`)).json();
    const w = list.find((t) => t.type === "worker" && t.url.includes("duckdb-browser-eh"));
    if (w) return rawCdp(w.webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no duckdb worker target");
}
function netLog(session) {
  const reqs = new Map();
  const h = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  session.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId + (e.type === "Preflight" ? "-pf" : ""), { url: e.request.url, method: e.request.method, type: e.type, range: h(e.request.headers).range, t0: e.timestamp }));
  session.on("Network.responseReceived", (e) => {
    const r = reqs.get(e.requestId + (e.type === "Preflight" ? "-pf" : "")) ?? reqs.get(e.requestId);
    if (!r) return;
    const hd = h(e.response.headers);
    r.status = e.response.status; r.protocol = e.response.protocol; r.content_length = hd["content-length"]; r.content_range = hd["content-range"];
    r.warn = hd["x-om-warn"]; r.usage = hd["x-om-usage"]; r.acao = hd["access-control-allow-origin"]; r.vary = hd["vary"]; r.cache = hd["cf-cache-status"] ?? hd["x-cache"];
  });
  session.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; r.ms = r2((e.timestamp - r.t0) * 1000); } });
  session.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r) r.failed = e.errorText; });
  return reqs;
}

// ---- wait for the mirror ----
async function head(url) { return (await fetch(url, { method: "HEAD" })).status; }
async function waitFor(path) {
  const url = `${WORKER}${path}`, t0 = Date.now();
  let s = await head(url);
  while (s !== 200) {
    if (Date.now() - t0 >= WAIT_MS) return { ok: false, status: s, waited_s: Math.round((Date.now() - t0) / 1000) };
    console.log(`  ${path}: ${s}, waiting (${Math.round((Date.now() - t0) / 1000)} s)`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    s = await head(url);
  }
  return { ok: true, status: s, waited_s: Math.round((Date.now() - t0) / 1000) };
}

// ---- one run of one check ----
const srv = await serve(PORT);
const browser = await chromium.launch({ channel: "chrome", args: [`--remote-debugging-port=${DBG}`, "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function run({ fn, args, dataPath, duck = false, boot }) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const nets = [netLog(cdp)];
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.benchReady);
  let w = null, bootInfo = null;
  if (duck) {
    bootInfo = await page.evaluate(([m]) => window.bench.duckBoot(m), [boot]);
    w = await workerCdp();
    await w.send("Network.enable");
    await w.send("Network.setCacheDisabled", { cacheDisabled: true });
    nets.push(netLog(w));
  }
  let result, error = null;
  try { result = await page.evaluate(([fn, args]) => window.bench[fn](...args), [fn, args]); }
  catch (e) { error = String(e).split("\n")[0]; }
  await new Promise((r) => setTimeout(r, 400));
  const file = dataPath.split("?")[0];
  const reqs = nets.flatMap((n) => [...n.values()]).filter((r) => r.url.includes(file)).sort((a, b) => a.t0 - b.t0);
  const get = reqs.filter((r) => r.method === "GET");
  const data = reqs.filter((r) => r.method !== "OPTIONS" && r.method !== "HEAD");
  const rec = {
    error, errors: errs.length ? errs : undefined, boot: bootInfo,
    wall_ms: result ? (result.ms ?? result.ms_to_idle) : null,
    net_span_ms: data.length && data.every((r) => r.t1) ? r2((Math.max(...data.map((r) => r.t1)) - Math.min(...data.map((r) => r.t0))) * 1000) : null,
    n_requests: reqs.length, n_get: get.length, n_head: reqs.filter((r) => r.method === "HEAD").length, n_options: reqs.filter((r) => r.method === "OPTIONS").length,
    statuses: Object.fromEntries([...new Set(reqs.map((r) => `${r.method} ${r.status ?? r.failed}`))].map((k) => [k, reqs.filter((r) => `${r.method} ${r.status ?? r.failed}` === k).length])),
    bytes_wire: reqs.reduce((s, r) => s + (r.bytes ?? 0), 0),
    bytes_body: data.reduce((s, r) => s + Number(r.content_length ?? 0), 0),
    all_206: data.length > 0 && data.every((r) => r.status === 206),
    full_file_warn: reqs.some((r) => r.warn != null) ? [...new Set(reqs.filter((r) => r.warn != null).map((r) => r.warn))] : false,
    result,
    requests: reqs.map(({ method, type, range, status, content_length, content_range, warn, bytes, ms, failed, protocol, acao, vary, cache }) => ({ method, type, range, status, content_length, content_range, warn, bytes, ms, failed, protocol, acao, vary, cache })),
  };
  w?.close(); await ctx.close();
  return rec;
}

function summarize(runs) {
  const ok = runs.filter((r) => !r.error);
  return {
    n_runs: runs.length, n_ok: ok.length,
    wall_ms_cold: ok[0]?.wall_ms ?? null, wall_ms_median: r2(median(ok.map((r) => r.wall_ms))), wall_ms_all: ok.map((r) => r.wall_ms),
    net_span_ms_median: r2(median(ok.map((r) => r.net_span_ms))),
    n_requests: ok[0]?.n_requests ?? null, n_get: ok[0]?.n_get ?? null, n_head: ok[0]?.n_head ?? null, n_options: ok[0]?.n_options ?? null,
    bytes_wire: ok[0]?.bytes_wire ?? null, bytes_body: ok[0]?.bytes_body ?? null,
    all_206: ok.length > 0 && ok.every((r) => r.all_206),
    full_file_warn: ok.some((r) => r.full_file_warn),
    statuses: ok[0]?.statuses ?? null,
    errors: runs.filter((r) => r.error).map((r) => r.error),
    runs,
  };
}

async function check(id, title, spec, { wait = null, probe = null } = {}) {
  console.log(`== ${id} ${title}`);
  const out = { title, files: {}, wait: null };
  if (wait) {
    out.wait = await waitFor(wait);
    console.log("  wait:", JSON.stringify(out.wait));
    if (!out.wait.ok) { out.skipped = `still ${out.wait.status} on the worker after ${out.wait.waited_s} s`; return out; }
  }
  // probe: one HEAD on the worker; when it is not 200 the check runs against S3 only and records why
  let tgts = targets;
  if (probe) {
    const s = await head(`${WORKER}${probe}${KEY ? `?key=${KEY}` : ""}`);
    out.worker_probe = { path: probe, status: s };
    console.log("  probe:", JSON.stringify(out.worker_probe));
    if (s !== 200) tgts = targets.filter((t) => t.name !== "worker");
  }
  const runsBy = Object.fromEntries(tgts.map((t) => [t.name, []]));
  for (let i = 0; i < RUNS; i++) {
    for (const t of tgts) {
      const u = urlOf(t, spec.path);
      const s = spec.extra ? spec.extra(t) : [];
      const rec = await run({ fn: spec.fn, args: [u, ...s], dataPath: spec.path, duck: spec.duck, boot: spec.boot });
      runsBy[t.name].push(rec);
      console.log(`  ${t.name} #${i + 1}: ${rec.error ?? `${rec.wall_ms} ms, ${rec.n_requests} req (${JSON.stringify(rec.statuses)}), ${rec.bytes_wire} B, all206=${rec.all_206}`}`);
    }
  }
  for (const t of tgts) out.files[t.name] = { url: redact(urlOf(t, spec.path)), ...summarize(runsBy[t.name]) };
  return out;
}

const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
results.meta = { ...(results.meta ?? {}), note: process.env.NOTE ?? null, chrome: browser.version(), when: new Date().toISOString(), page_origin: ORIGIN, worker: WORKER, s3: S3, runs_per_check: RUNS, key_used: KEY ? "preview-tier ?key= (redacted)" : "keyless (anonymous tier)", platform: process.platform + " " + process.arch };
const save = () => writeFileSync(OUT, redact(JSON.stringify(results, null, 1)));

const PARQ = "gazetteer/index/places_index.parquet";
if (PHASE === "a") {
  results.c1_hyparquet = await check("1", "hyparquet (metadata + 3 columns of row group 0)", { fn: "hyparquet", path: PARQ }, { wait: PARQ }); save();
  results.c2a_duckdb_range = await check("2a", "duckdb-wasm forceFullHTTPReads:false", { fn: "duckQuery", path: PARQ, duck: true, boot: "range" }, { wait: PARQ }); save();
  results.c2b_duckdb_default = await check("2b", "duckdb-wasm default open", { fn: "duckQuery", path: PARQ, duck: true, boot: "default" }, { wait: PARQ }); save();

  // 5. cors: browser preflight from the page origin, then curl with explicit origins ----
  console.log("== 5 cors");
  const c5 = { browser: {}, curl: [] };
  for (const t of targets) {
    const u = urlOf(t, PARQ);
    const rec = await run({ fn: "preflight", args: [u], dataPath: PARQ });
    c5.browser[t.name] = { url: redact(u), result: rec.result, error: rec.error, requests: rec.requests.map((r) => ({ method: r.method, type: r.type, status: r.status, acao: r.acao, vary: r.vary, warn: r.warn, cache: r.cache })) };
    console.log(" ", t.name, JSON.stringify(c5.browser[t.name].requests));
  }
  const curl = (args) => execFileSync("curl", ["-s", "-D-", "-o", "/dev/null", ...args], { encoding: "utf8" }).replace(/\r/g, "");
  const pick = (txt) => Object.fromEntries(txt.split("\n").filter((l) => /^(HTTP|access-control|vary|x-om|cache-control|cf-cache)/i.test(l)).map((l) => (l.startsWith("HTTP") ? ["status", l] : [l.split(":")[0].toLowerCase(), l.slice(l.indexOf(":") + 1).trim()])));
  const cases = [
    ["OPTIONS preflight, Origin localhost page, no key", ["-X", "OPTIONS", "-H", `Origin: ${ORIGIN}`, "-H", "Access-Control-Request-Method: GET", "-H", "Access-Control-Request-Headers: range,if-none-match", WORKER + PARQ]],
    ["OPTIONS preflight, Origin https://oceanmetrics.io, key", ["-X", "OPTIONS", "-H", "Origin: https://oceanmetrics.io", "-H", "Access-Control-Request-Method: GET", "-H", "Access-Control-Request-Headers: range,if-none-match", WORKER + PARQ + (KEY ? `?key=${KEY}` : "")]],
    ["GET Range 0-1023, Origin https://oceanmetrics.io, key", ["-H", "Origin: https://oceanmetrics.io", "-H", "Range: bytes=0-1023", WORKER + PARQ + (KEY ? `?key=${KEY}` : "")]],
    ["GET Range 0-1023, Origin https://oceanmetrics.io, no key", ["-H", "Origin: https://oceanmetrics.io", "-H", "Range: bytes=0-1023", WORKER + PARQ]],
    ["GET Range 0-1023, Origin http://localhost page, key", ["-H", `Origin: ${ORIGIN}`, "-H", "Range: bytes=0-1023", WORKER + PARQ + (KEY ? `?key=${KEY}` : "")]],
    ["GET Range 0-1023, no Origin, key", ["-H", "Range: bytes=0-1023", WORKER + PARQ + (KEY ? `?key=${KEY}` : "")]],
    ["GET Range 0-1023, Origin https://evil.example, key", ["-H", "Origin: https://evil.example", "-H", "Range: bytes=0-1023", WORKER + PARQ + (KEY ? `?key=${KEY}` : "")]],
    ["S3 OPTIONS preflight, Origin https://oceanmetrics.io", ["-X", "OPTIONS", "-H", "Origin: https://oceanmetrics.io", "-H", "Access-Control-Request-Method: GET", "-H", "Access-Control-Request-Headers: range,if-none-match", S3 + PARQ]],
    ["S3 GET Range 0-1023, Origin https://oceanmetrics.io", ["-H", "Origin: https://oceanmetrics.io", "-H", "Range: bytes=0-1023", S3 + PARQ]],
  ];
  for (const [label, a] of cases) c5.curl.push({ case: label, ...pick(curl(a)) });
  results.c5_cors = c5; save();
}

if (PHASE === "b") {
  const layers = await (await fetch(`${WORKER}gazetteer/index/layers.json`)).json();
  const lay = layers.layers.find((l) => l.slug === "noaa_sanctuaries");
  const PMT = "gazetteer/noaa_sanctuaries/places.pmtiles";
  results.c3a_pmtiles_raw = await check("3a", "pmtiles getHeader + getZxy(2,0,1)", { fn: "pmtilesRaw", path: PMT }, { wait: PMT }); save();
  results.c3b_pmtiles_draw = await check("3b", "maplibre 6 pmtiles:// zoom 3 to idle", { fn: "pmtilesDraw", path: PMT, extra: () => [lay.source_layer] }, { wait: PMT }); save();
  const FK = "gazetteer/rasters/dhw_5km/CRW_SST/NMS:FKNMS/2024.tif";
  results.c4a_cog_gazetteer = await check("4a", "geotiff.js gazetteer Then vs Now FKNMS 2024 (no overviews)", { fn: "cog", path: FK }, { wait: FK }); save();
  // run 2 (quiet network): no waiting; the worker is probed once and a 404 leaves the check S3-only
  const AT = "atlas/aquamaps_eov/score_risk.tif", AT3 = "atlas/aquamaps_eov/score_risk_3857.tif", FAR = "basemap/gebco/far.pmtiles";
  if (!SKIP.includes("4b")) { results.c4b_cog_atlas = await check("4b", "geotiff.js atlas aquamaps_eov score_risk (overviews)", { fn: "cog", path: AT }, { probe: AT }); save(); }
  if (!SKIP.includes("4c")) { results.c4c_cog_atlas_3857 = await check("4c", "geotiff.js atlas aquamaps_eov score_risk_3857 (overviews)", { fn: "cog", path: AT3 }, { probe: AT3 }); save(); }
  if (!SKIP.includes("3c")) { results.c3c_pmtiles_basemap = await check("3c", "pmtiles getHeader + getZxy(2,1,1) basemap/gebco/far", { fn: "pmtilesRaw", path: FAR, extra: () => [2, 1, 1] }, { probe: FAR }); save(); }
}

save();
await browser.close(); srv.close();
console.log("done", PHASE);
