// the measurement: for each variant x dataset x view, a fresh context loads the page (1280x800, DPR 2),
// waits for the first full draw, collects the garbage and reads the JS heap, then runs the scripted 5 s
// pan + zoom and samples every requestAnimationFrame. Bytes are Playwright
// request sizes, page and workers (the data files alone: cells JSON or PMTiles ranges); heap is the main
// thread's and, separately, the sum over MapLibre's workers, each after a forced GC. Two Chrome modes:
// `vsync` (default frame pacing: dropped frames show) and `uncapped` (--disable-gpu-vsync
// --disable-frame-rate-limit: rAF runs as fast as the frame can be made, so frame time is its cost).
// usage: node scripts/measure.mjs [reps=3] [modes=vsync,uncapped] [variants=a,b,c] [ds=es,n] [views=fiji,world]
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { serve } from "./serve.mjs";

const [reps = "3", modes = "vsync,uncapped", variants = "a,b,c", dss = "es,n", views = "fiji,world"] = process.argv.slice(2);
const BASE_ARGS = ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--ignore-gpu-blocklist", "--enable-precise-memory-info"];
const MODE_ARGS = { vsync: [], uncapped: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] };
// EXTRA=<query> adds to every page URL (e.g. workers=3) and to the variant name; OUT names the raw file
const EXTRA = process.env.EXTRA ?? "";
const OUT = process.env.OUT ?? "results/raw-h3j.json";
const server = await serve(5180);
// APPEND=1 adds to an existing OUT (to resume a matrix)
const out = process.env.APPEND && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
mkdirSync("results", { recursive: true });

for (const mode of modes.split(",")) {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...BASE_ARGS, ...MODE_ARGS[mode]] });
  for (const ds of dss.split(","))
    for (const view of views.split(","))
      for (const v of variants.split(","))
        for (let rep = 0; rep < Number(reps); rep++) {
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const cdp = await ctx.newCDPSession(page);
          // bytes: Playwright's request sizes (encoded body + headers), which include the requests made by
          // MapLibre's workers (variants BW and CW read their data there)
          const bytes = { all: 0, data: 0, requests: 0 };
          const sizing = [];
          page.on("requestfinished", (req) => sizing.push(req.sizes().then((sz) => {
            const n = sz.responseBodySize + sz.responseHeadersSize;
            bytes.all += n;
            if (/cells-|\.pmtiles/.test(req.url())) { bytes.data += n; bytes.requests++; }
          }).catch(() => {})));
          const settleBytes = async () => { await new Promise((r) => setTimeout(r, 300)); await Promise.all(sizing); };
          // worker heaps: auto-attach (non-flat) to the page's workers and ask each for its heap
          await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
          const workers = new Set();
          cdp.on("Target.attachedToTarget", (e) => { if (e.targetInfo.type === "worker") workers.add(e.sessionId); });
          cdp.on("Target.detachedFromTarget", (e) => workers.delete(e.sessionId));
          let msgId = 1;
          const pending = new Map();
          cdp.on("Target.receivedMessageFromTarget", (e) => { const m = JSON.parse(e.message); pending.get(m.id)?.(m.result); pending.delete(m.id); });
          const inWorker = (sessionId, method) => new Promise((resolve) => {
            const id = msgId++;
            pending.set(id, resolve);
            cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method }) }).catch(() => resolve(null));
            setTimeout(() => resolve(null), 3000);
          });
          const workerHeap = async () => {
            let sum = 0;
            for (const sid of workers) { await inWorker(sid, "HeapProfiler.collectGarbage"); sum += (await inWorker(sid, "Runtime.getHeapUsage"))?.usedSize ?? 0; }
            return sum;
          };
          // one retry: a navigation once failed with ERR_HTTP_RESPONSE_CODE_FAILURE after a heavy run
          const url = `http://localhost:5180/${v}/?ds=${ds}&view=${view}${EXTRA ? `&${EXTRA}` : ""}`;
          try { await page.goto(url); } catch { await new Promise((r) => setTimeout(r, 2000)); await page.goto(url); }
          await page.waitForFunction(() => window.__spike, null, { timeout: 60000 });
          const firstDraw = await page.evaluate(() => window.__spike.ready);
          await settleBytes();
          const load = { ...bytes };
          await cdp.send("HeapProfiler.collectGarbage");
          const heap = (await cdp.send("Runtime.getHeapUsage")).usedSize;
          const wheap = await workerHeap();
          const run = await page.evaluate((view) => window.__spike.run(view, 5000), view);
          await settleBytes();
          const f = run.frames.slice().sort((a, b) => a - b);
          const dropped = run.frames.reduce((s, d) => s + Math.max(0, Math.round(d / run.interval) - 1), 0);
          const row = {
            mode, ds, view, variant: EXTRA ? `${v}+${EXTRA}` : v, rep,
            cells: await page.evaluate(() => window.__spike.cells()),
            firstDrawMs: Math.round(firstDraw), heapMB: +(heap / 1e6).toFixed(1), workerHeapMB: +(wheap / 1e6).toFixed(1), workers: workers.size,
            frames: f.length, meanMs: +(f.reduce((s, x) => s + x, 0) / f.length).toFixed(2),
            p95Ms: +f[Math.floor(f.length * 0.95)].toFixed(2), maxMs: +f[f.length - 1].toFixed(1), dropped,
            intervalMs: +run.interval.toFixed(2), pendingFrames: run.pending, settleMs: Math.round(run.settle),
            longTasks: run.longTasks, longTaskMs: Math.round(run.longTaskMs),
            tilesBuilt: run.tilesBuilt ?? 0, tileBuildMs: Math.round(run.tileMs ?? 0),
            loadDataKB: Math.round(load.data / 1024), loadAllKB: Math.round(load.all / 1024), loadDataRequests: load.requests,
            runDataKB: Math.round((bytes.data - load.data) / 1024), runDataRequests: bytes.requests - load.requests,
            errors,
          };
          out.push(row);
          console.log(JSON.stringify(row));
          writeFileSync(OUT, JSON.stringify(out, null, 1));
          await ctx.close();
        }
  await browser.close();
}
server.close();
