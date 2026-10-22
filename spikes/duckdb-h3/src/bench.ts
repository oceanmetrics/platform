// day 7 spike 4: duckdb-wasm h3 community extension vs h3-js.
// every step is a window.bench function so run.mjs can drive it and read cdp between steps.
// the duckdb boot copies obis-hex src/lib/engine/bundles.ts (1.32.0, self-hosted eh bundle, hand-built worker).
import * as duckdb from "@duckdb/duckdb-wasm";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import { cellToParent, cellToBoundary } from "h3-js";
import { asyncBufferFromUrl, parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors"; // the obis-h3 files are zstd
import { tableFromArrays } from "apache-arrow";

let db: duckdb.AsyncDuckDB;
let conn: duckdb.AsyncDuckDBConnection;
let worker: Worker;
// columns read with hyparquet (h3 strings, n) and pulled from duckdb (cell_id)
let hp_h3: string[] = [];
let hp_n: Float64Array = new Float64Array(0);
let dk_id: BigInt64Array = new BigInt64Array(0);
let dk_n: Float64Array = new Float64Array(0);
// keep results alive until the heap reading
const keep: unknown[] = [];

const now = () => performance.now();
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

async function q(sql: string) {
  return conn.query(sql);
}

async function boot() {
  const t0 = now();
  const bundle = await duckdb.selectBundle({ mvp: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl }, eh: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl } });
  worker = new Worker(bundle.mainWorker!);
  db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();
  const ms = now() - t0;
  const v = (await q("SELECT version() v, (SELECT source_id FROM pragma_version()) s")).toArray()[0];
  const lib = await db.getVersion();
  const platform = (await q("PRAGMA platform")).toArray()[0]?.platform;
  return { ms: r2(ms), duckdb: String(v.v), source_id: String(v.s), duckdb_wasm: lib, platform: String(platform) };
}

// forms: "community" (INSTALL h3 FROM community), "custom_repo" (SET custom_extension_repository), "url" (LOAD '<url>')
async function loadExt(form: string, url = "") {
  const sql =
    form === "community"
      ? ["INSTALL h3 FROM community", "LOAD h3"]
      : form === "custom_repo"
        ? ["SET custom_extension_repository = 'https://community-extensions.duckdb.org'", "INSTALL h3", "LOAD h3"]
        : [`LOAD '${url}'`];
  const t0 = now();
  try {
    for (const s of sql) await q(s);
  } catch (e) {
    return { ok: false, form, sql, ms: r2(now() - t0), error: String(e) };
  }
  const ms = now() - t0;
  const ext = (await q("SELECT extension_name, loaded, installed, install_path, extension_version, install_mode, installed_from FROM duckdb_extensions() WHERE extension_name = 'h3'")).toArray().map((r: any) => ({ ...r.toJSON() }));
  const probe = (await q("SELECT h3_h3_to_string(h3_cell_to_parent(602023973521195007, 3)) p")).toArray()[0].p;
  const fns = (await q("SELECT DISTINCT function_name FROM duckdb_functions() WHERE function_name LIKE 'h3_%' ORDER BY 1")).toArray().map((r: any) => String(r.function_name));
  return { ok: true, form, sql, ms: r2(ms), ext, probe: String(probe), n_functions: fns.length, boundary_functions: fns.filter((f) => f.includes("boundary")) };
}

async function loadTableHttp(url: string) {
  const t0 = now();
  await q(`CREATE OR REPLACE TABLE t AS SELECT h3, cell_id, n FROM read_parquet('${url}')`);
  const ms = now() - t0;
  const rows = Number((await q("SELECT count(*) c FROM t")).toArray()[0].c);
  return { ms: r2(ms), rows };
}

async function loadTableBuffer(url: string) {
  const t0 = now();
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const t1 = now();
  const nbytes = bytes.byteLength; // registerFileBuffer transfers (detaches) the buffer
  await db.registerFileBuffer("res5.parquet", bytes);
  const t2 = now();
  await q(`CREATE OR REPLACE TABLE t AS SELECT h3, cell_id, n FROM read_parquet('res5.parquet')`);
  const t3 = now();
  const rows = Number((await q("SELECT count(*) c FROM t")).toArray()[0].c);
  return { fetch_ms: r2(t1 - t0), register_ms: r2(t2 - t1), create_ms: r2(t3 - t2), total_ms: r2(t3 - t0), bytes: nbytes, rows };
}

// a. duckdb with the h3 extension
async function rollExt(res: number, runs = 5) {
  const sql = `SELECT h3_h3_to_string(p) p, n, c FROM (SELECT h3_cell_to_parent(cell_id, ${res}) p, SUM(n)::DOUBLE n, COUNT(*)::INTEGER c FROM t GROUP BY 1)`;
  const ts: number[] = [];
  let out: any;
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    out = await q(sql);
    ts.push(now() - t0);
  }
  keep.push(out);
  return { res, rows: out.numRows, sum_n: sumCol(out, "n"), ms: ts.map(r2), median_ms: r2(median(ts)), sql };
}

// d. duckdb without any extension: the h3 parent is bit arithmetic on the index (resolution in bits 52-55,
// 3-bit digits below; a parent sets the resolution and fills the finer digits with 7)
function bitsSql(res: number) {
  const clear = ~(15n << 52n); // signed bigint literal
  const set = (BigInt(res) << 52n) | ((1n << BigInt(3 * (15 - res))) - 1n);
  return `((cell_id & ${clear}) | ${set})`;
}
async function rollBits(res: number, runs = 5) {
  const sql = `SELECT lower(hex(p)) p, n, c FROM (SELECT ${bitsSql(res)} p, SUM(n)::DOUBLE n, COUNT(*)::INTEGER c FROM t GROUP BY 1)`;
  const ts: number[] = [];
  let out: any;
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    out = await q(sql);
    ts.push(now() - t0);
  }
  keep.push(out);
  return { res, rows: out.numRows, sum_n: sumCol(out, "n"), ms: ts.map(r2), median_ms: r2(median(ts)), sql };
}

function sumCol(tbl: any, name: string) {
  const a = tbl.getChild(name).toArray();
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Number(a[i]);
  return s;
}

// b. h3-js over the h3 string column read with hyparquet
async function readHyparquet(url: string) {
  const t0 = now();
  const file = await asyncBufferFromUrl({ url });
  await parquetRead({
    file,
    compressors,
    columns: ["h3", "n"],
    onComplete: (rows: any[][]) => {
      const nr = rows.length;
      hp_h3 = new Array(nr);
      hp_n = new Float64Array(nr);
      for (let i = 0; i < nr; i++) {
        hp_h3[i] = rows[i][0];
        hp_n[i] = Number(rows[i][1]);
      }
    },
  });
  return { ms: r2(now() - t0), rows: hp_h3.length };
}

// b2. the cell_id array pulled from duckdb once (no strings: h3-js takes [low, high] split longs)
async function pullDuck() {
  const t0 = now();
  const tbl = await q("SELECT cell_id, n::DOUBLE n FROM t");
  dk_id = tbl.getChild("cell_id")!.toArray() as BigInt64Array;
  dk_n = tbl.getChild("n")!.toArray() as Float64Array;
  return { ms: r2(now() - t0), rows: dk_id.length };
}

function rollMap(res: number, source: "hyparquet" | "duck") {
  const m = new Map<string, { n: number; c: number }>();
  if (source === "hyparquet") {
    for (let i = 0; i < hp_h3.length; i++) {
      const p = cellToParent(hp_h3[i], res);
      const o = m.get(p);
      if (o) { o.n += hp_n[i]; o.c++; } else m.set(p, { n: hp_n[i], c: 1 });
    }
  } else {
    const u32 = new Uint32Array(dk_id.buffer, dk_id.byteOffset, dk_id.length * 2);
    const sl: [number, number] = [0, 0];
    for (let i = 0; i < dk_id.length; i++) {
      sl[0] = u32[2 * i]; sl[1] = u32[2 * i + 1];
      const p = cellToParent(sl, res);
      const o = m.get(p);
      if (o) { o.n += dk_n[i]; o.c++; } else m.set(p, { n: dk_n[i], c: 1 });
    }
  }
  return m;
}

async function rollH3js(res: number, source: "hyparquet" | "duck", runs = 5) {
  const ts: number[] = [];
  let m = new Map<string, { n: number; c: number }>();
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    m = rollMap(res, source);
    ts.push(now() - t0);
  }
  keep.push(m);
  let s = 0;
  for (const v of m.values()) s += v.n;
  return { res, source, rows: m.size, sum_n: s, ms: ts.map(r2), median_ms: r2(median(ts)) };
}

// c. mixed: duckdb without the extension; parents computed in js with h3-js, pushed back as an arrow table, joined
async function rollMixed(res: number, runs = 5) {
  const ts: number[] = [];
  const parts: Record<string, number[]> = { js: [], push: [], join: [] };
  let out: any;
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    const u32 = new Uint32Array(dk_id.buffer, dk_id.byteOffset, dk_id.length * 2);
    const sl: [number, number] = [0, 0];
    const p = new Array<string>(dk_id.length);
    for (let j = 0; j < dk_id.length; j++) {
      sl[0] = u32[2 * j]; sl[1] = u32[2 * j + 1];
      p[j] = cellToParent(sl, res);
    }
    const t1 = now();
    await q("DROP TABLE IF EXISTS m");
    await conn.insertArrowTable(tableFromArrays({ cell_id: dk_id, p }), { name: "m", create: true });
    const t2 = now();
    out = await q("SELECT m.p, SUM(t.n)::DOUBLE n, COUNT(*)::INTEGER c FROM t JOIN m USING (cell_id) GROUP BY m.p");
    const t3 = now();
    ts.push(t3 - t0);
    parts.js.push(t1 - t0); parts.push.push(t2 - t1); parts.join.push(t3 - t2);
  }
  keep.push(out);
  return {
    res, rows: out.numRows, sum_n: sumCol(out, "n"), ms: ts.map(r2), median_ms: r2(median(ts)),
    median_js_ms: r2(median(parts.js)), median_push_ms: r2(median(parts.push)), median_join_ms: r2(median(parts.join)),
  };
}

// cross-check: the three paths give the same parents, counts and sums
async function verify(res: number) {
  const ext = await q(`SELECT h3_h3_to_string(h3_cell_to_parent(cell_id, ${res})) p, SUM(n)::DOUBLE n, COUNT(*)::INTEGER c FROM t GROUP BY 1`);
  const bits = await q(`SELECT lower(hex(${bitsSql(res)})) p, SUM(n)::DOUBLE n, COUNT(*)::INTEGER c FROM t GROUP BY 1`);
  const js = rollMap(res, "hyparquet");
  const toMap = (tb: any) => {
    const p = tb.getChild("p").toArray(), n = tb.getChild("n").toArray(), c = tb.getChild("c").toArray();
    const mm = new Map<string, string>();
    for (let i = 0; i < p.length; i++) mm.set(String(p[i]), `${n[i]}|${c[i]}`);
    return mm;
  };
  const a = toMap(ext), b = toMap(bits);
  let diff_bits = 0, diff_js = 0;
  for (const [k, v] of a) {
    if (b.get(k) !== v) diff_bits++;
    const o = js.get(k);
    if (!o || `${o.n}|${o.c}` !== v) diff_js++;
  }
  return { res, ext_rows: a.size, bits_rows: b.size, js_rows: js.size, diff_bits, diff_js };
}

// boundaries for n cells: duckdb wkt vs h3-js arrays
async function boundaryDuck(nCells = 10000, runs = 5) {
  await q(`CREATE OR REPLACE TABLE b AS SELECT h3, cell_id FROM t ORDER BY cell_id LIMIT ${nCells}`);
  const ts: number[] = [];
  let out: any;
  let chars = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    out = await q("SELECT h3_cell_to_boundary_wkt(cell_id) w FROM b");
    const w = out.getChild("w").toArray(); // decode the strings into js, as a caller would
    chars = 0;
    for (let j = 0; j < w.length; j++) chars += w[j].length;
    ts.push(now() - t0);
  }
  keep.push(out);
  return { cells: out.numRows, wkt_chars: chars, ms: ts.map(r2), median_ms: r2(median(ts)) };
}

async function boundaryH3js(runs = 5) {
  const ids = (await q("SELECT h3 FROM b")).getChild("h3")!.toArray() as string[];
  const ts: number[] = [];
  let out: any[] = [];
  let verts = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    out = new Array(ids.length);
    for (let j = 0; j < ids.length; j++) out[j] = cellToBoundary(ids[j], true);
    ts.push(now() - t0);
  }
  for (const o of out) verts += o.length;
  keep.push(out);
  return { cells: ids.length, vertices: verts, ms: ts.map(r2), median_ms: r2(median(ts)) };
}

async function duckMemory() {
  const r = (await q("SELECT sum(memory_usage_bytes)::BIGINT b FROM duckdb_memory()")).toArray()[0];
  return { duckdb_memory_bytes: Number(r.b) };
}

function heap() {
  const m = (performance as any).memory;
  return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null;
}

(window as any).bench = {
  boot, loadExt, loadTableHttp, loadTableBuffer, rollExt, rollBits, readHyparquet, pullDuck, rollH3js, rollMixed,
  verify, boundaryDuck, boundaryH3js, duckMemory, heap,
  dropKeep: () => { keep.length = 0; },
};
(window as any).benchReady = true;
