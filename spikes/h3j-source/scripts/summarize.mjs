// results/raw.json -> results/summary.json and markdown tables (results/summary.md): the median over the reps
// of each per-run number, per mode x dataset x view x variant, and p95 relative to deck.gl (A)
import { readFileSync, writeFileSync } from "node:fs";
const raw = ["results/raw-a.json", "results/raw-h3j.json", "results/raw-workers.json"].flatMap((f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return []; } });
const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const keys = ["firstDrawMs", "meanMs", "p95Ms", "maxMs", "dropped", "pendingFrames", "settleMs", "longTaskMs", "heapMB", "workerHeapMB", "loadDataKB", "runDataKB", "loadDataRequests", "runDataRequests", "frames"];
const groups = new Map();
for (const r of raw) {
  const k = [r.mode, r.ds, r.view, r.variant].join("|");
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const summary = [];
for (const [k, rs] of groups) {
  const [mode, ds, view, variant] = k.split("|");
  const row = { mode, ds, view, variant, reps: rs.length, cells: rs[0].cells };
  for (const key of keys) row[key] = +med(rs.map((r) => r[key])).toFixed(2);
  row.errors = rs.flatMap((r) => r.errors).length;
  summary.push(row);
}
for (const r of summary) {
  const a = summary.find((x) => x.mode === r.mode && x.ds === r.ds && x.view === r.view && x.variant === "a");
  r.p95VsA = a ? +(r.p95Ms / a.p95Ms).toFixed(2) : null;
}
writeFileSync("results/summary.json", JSON.stringify(summary, null, 1));
const NAMES = { a: "A deck.gl", b: "B h3j, main thread", c: "C h3j PMTiles, main thread", bw: "B-w h3j, in worker", cw: "C-w h3j PMTiles, in worker", "bw+workers=3": "B-w, 3 workers", "cw+workers=3": "C-w, 3 workers" };
let md = "";
for (const mode of ["vsync", "uncapped"])
  for (const ds of ["es", "n"]) {
    const rows = summary.filter((r) => r.mode === mode && r.ds === ds);
    if (!rows.length) continue;
    md += `\n### ${mode}, ${ds} (${rows[0].cells.toLocaleString("en-US")} cells)\n\n`;
    md += "| view | variant | first draw ms | mean ms | p95 ms | p95 / A | max ms | dropped | frames with tiles missing | settle ms | long tasks ms | heap MB main + workers | data KB load + motion |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|\n";
    for (const view of ["fiji", "world"])
      for (const v of ["a", "b", "c", "bw", "cw", "bw+workers=3", "cw+workers=3"]) {
        const r = rows.find((x) => x.view === view && x.variant === v);
        if (!r) continue;
        md += `| ${view} | ${NAMES[v]} | ${r.firstDrawMs} | ${r.meanMs.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${r.p95VsA.toFixed(2)} | ${r.maxMs.toFixed(0)} | ${r.dropped} | ${r.pendingFrames} | ${r.settleMs} | ${r.longTaskMs} | ${r.heapMB} + ${r.workerHeapMB} | ${r.loadDataKB} + ${r.runDataKB} |\n`;
      }
  }
writeFileSync("results/summary.md", md);
console.log(md);
