// the packages' size budget (README "Size budget"): gzip (level 9) of the summed dist/**/*.js of each package, after
// `npm run build`. raise a budget only with the reason written in the README. one line per package; exit 1 if any is over.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { H3_WORKER_BUDGET, measureH3Worker } from './h3-worker-size.mjs'

const ROOT = new URL('../packages/', import.meta.url).pathname
// bytes, gzip. measured on 2026-10-22 (places 11_708, status 7_997), set at about 1.5 times the measurement, rounded up.
// map: 26_014 on 2026-10-23 (0.2.0: the slots, the setup, the basemap, the ramps and the grid, cog and h3 providers,
// the h3 worker module and the archive writer all counted), so 39_000; the 5_000 it held was the scaffold's provisional
// budget. catalog held only constants and types in the browser until 0.3.0 (404 B on 2026-10-22, its validator and CLI
// left out below).
// catalog: 6_726 on 2026-10-23 (0.3.0: the indicators readers and cards land, dist/indicators.js, cards.js and manifest.js
// counted; hyparquet and @oceanmetrics/status are dependencies and not counted; the root index alone is 511), so 10_000.
// map 0.3.0: 41_877 on 2026-10-23 (28_589 at 0.2.3): the h3 provider over a release adds seven modules (h3Bits,
// h3Zoom, h3ReleaseLayer, h3Release, h3Parquet, h3Stats, parquetFile; +13.3 kB of dist, comments counted), so 48_000.
// what an app pays eagerly for h3ReleaseSlot is +5.2 kB minified (the reader runs in the worker, measured on its own
// line below; the legend reader is a lazy 20.9 kB chunk with hyparquet and fzstd). the reason is in the map README "Size".
// engine: 26_794 on 2026-10-23 (0.1.0: the mask, the ERDDAP and dataset modules, the engine, the preview and the five
// SQL templates as strings; DuckDB-WASM and Apache Arrow are peers and not counted), so 40_000.
// catalog 0.5.0: 11_560 on 2026-10-23: /changes (diff, sentences, Atom, feed names; 3_696) and /report (the rules moved
// from indicators; 2_170) land, each loaded only by its own users, so 15_000 (README "Size budget").
const BUDGET = { places: 18_000, status: 12_000, map: 48_000, catalog: 15_000, engine: 40_000 }

// files a browser never loads, left out of a package's measure: catalog's validator (ajv) and CLI are Node only,
// reached through the @oceanmetrics/catalog/validate subpath and the om-catalog bin, never from the package index
const NODE_ONLY = { catalog: /^(validate|cli)[^/]*\.js$/ }

const jsFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? jsFiles(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : [])

let over = false
for (const [name, max] of Object.entries(BUDGET)) {
  const dist = join(ROOT, name, 'dist')
  if (!existsSync(dist)) throw new Error(`size budget: ${dist} not found; run npm run build first`)
  const skip = NODE_ONLY[name]
  const files = jsFiles(dist).filter(f => !(skip && skip.test(f.slice(dist.length + 1)))).sort()
  const got = gzipSync(Buffer.concat(files.map(f => readFileSync(f))), { level: 9 }).length
  const ok = got <= max
  over ||= !ok
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name.padEnd(8)} ${String(got).padStart(6)} B gzip (budget ${max} B, ${files.length} files)`)
}

// the h3 worker chunk, bundled (rolldown, minified), measured apart: what a browser fetches on the first hexagon
const w = await measureH3Worker()
const wok = w.gzip <= H3_WORKER_BUDGET
over ||= !wok
console.log(`${wok ? 'ok  ' : 'OVER'} ${'map/h3-worker'.padEnd(8)} ${String(w.gzip).padStart(6)} B gzip (budget ${H3_WORKER_BUDGET} B, one chunk bundled and minified)`)
process.exit(over ? 1 : 0)
