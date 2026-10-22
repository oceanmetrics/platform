// read the obis-h3 res-5 `all` partition once (hyparquet, zstd via hyparquet-compressors) and write the
// page's columnar data: public/cells-<col>.json = { h3: string[], v: number[], domain: [p02, p98] }.
// `es` keeps the cells with an ES(50) value (the obis-hex default ramp); `n` keeps every cell (a stress set).
import { asyncBufferFromFile, asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const LOCAL = "/Volumes/msens_big/_big/obis/obis-h3/v20261012/all/res=5/data_0.parquet";
const URL = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/v20261012/all/res=5/data_0.parquet";

const file = existsSync(LOCAL) ? await asyncBufferFromFile(LOCAL) : await asyncBufferFromUrl({ url: URL });
const rows = await parquetReadObjects({ file, columns: ["h3", "n", "es"], compressors });
console.log(`read ${rows.length} rows from ${existsSync(LOCAL) ? LOCAL : URL}`);

// quantile type 7 (as obis-hex ramp.ts quantileSorted)
const q = (s, p) => { const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.min(s.length - 1, lo + 1); return s[lo] + (h - lo) * (s[hi] - s[lo]); };
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

mkdirSync("public", { recursive: true });
mkdirSync("data", { recursive: true });
for (const [col, tf, digits] of [["es", (x) => x, 2], ["n", (x) => Math.log10(Number(x)), 3]]) {
  const keep = rows.filter((r) => r[col] !== null && r[col] !== undefined);
  const h3 = keep.map((r) => r.h3);
  const v = keep.map((r) => round(tf(r[col]), digits));
  const s = Float64Array.from(v).sort();
  const domain = [round(q(s, 0.02), 3), round(q(s, 0.98), 3)];
  const json = JSON.stringify({ col, transform: col === "n" ? "log10" : "none", domain, h3, v });
  writeFileSync(`public/cells-${col}.json`, json);
  writeFileSync(`public/domain-${col}.json`, JSON.stringify({ domain, cells: keep.length, col }));
  console.log(`${col}: ${keep.length} cells, domain ${domain}, ${(json.length / 1e6).toFixed(2)} MB`);
}
