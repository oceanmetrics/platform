// prints the Worker-vs-S3 table (markdown) from a results file: node summary.mjs results/<name>.json
// per check: wall time cold / median / p95 over the runs (nearest rank), the p95 of the individual GET durations pooled
// over the runs, the request counts, and the ratio of the Worker's p95 to S3's (D4's rule: over 1.5 means re-create the bucket in enam).
import { readFileSync } from "node:fs";
const res = JSON.parse(readFileSync(process.argv[2], "utf8"));
const p95 = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : null; };
const f = (x) => (x == null ? "n/a" : Math.round(x).toLocaleString("en-US"));
const side = (o) => {
  if (!o || !o.n_ok) return null;
  const gets = o.runs.filter((r) => !r.error).flatMap((r) => r.requests.filter((q) => q.method === "GET" && q.ms != null).map((q) => q.ms));
  return { cold: o.wall_ms_cold, med: o.wall_ms_median, p95: p95(o.wall_ms_all), get95: p95(gets), req: o.n_requests, ok206: o.all_206, runs: o.n_ok };
};
const rows = [], ratios = [];
for (const [k, c] of Object.entries(res)) {
  if (!k.startsWith("c") || !c.files) continue;
  const w = side(c.files.worker), s = side(c.files.s3);
  const cell = (x) => (x ? `${f(x.cold)} / ${f(x.med)} / ${f(x.p95)}` : c.skipped ?? (c.worker_probe ? `not served (probe ${c.worker_probe.status})` : "n/a"));
  const r = w && s && s.p95 ? w.p95 / s.p95 : null, rg = w && s && s.get95 ? w.get95 / s.get95 : null;
  if (r != null) ratios.push([k, r, rg]);
  rows.push(`| ${c.title} | ${cell(w)} | ${cell(s)} | ${f(w?.get95)} / ${f(s?.get95)} | ${w ? w.req : "n/a"} / ${s ? s.req : "n/a"} | ${w ? (w.ok206 ? "yes" : "NO") : "n/a"} / ${s ? (s.ok206 ? "yes" : "NO") : "n/a"} | ${r == null ? "n/a" : r.toFixed(2)} |`);
}
console.log("| check | Worker ms (cold / median / p95) | S3 ms (cold / median / p95) | GET p95 ms (W / S3) | requests (W / S3) | all 206 (W / S3) | p95 W/S3 |");
console.log("|---|---|---|---|---|---|---|");
console.log(rows.join("\n"));
const worst = ratios.sort((a, b) => b[1] - a[1])[0];
console.log(`\nruns per check and origin: ${res.meta?.runs_per_check}; Chrome ${res.meta?.chrome}; ${res.meta?.when}`);
if (worst) console.log(`worst p95 ratio (Worker / S3): ${worst[1].toFixed(2)} (${worst[0]}); D4 rule: re-create the bucket in enam only if over 1.5 -> ${ratios.some((r) => r[1] > 1.5) ? "OVER 1.5 on " + ratios.filter((r) => r[1] > 1.5).map((r) => r[0]).join(", ") : "within 1.5 on every check"}`);
