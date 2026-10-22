// the packages' size budget (README "Size budget"): gzip (level 9) of the summed dist/**/*.js of each package, after
// `npm run build`. raise a budget only with the reason written in the README. one line per package; exit 1 if any is over.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ROOT = new URL('../packages/', import.meta.url).pathname
// bytes, gzip. measured on 2026-10-22 (places 11_708, status 7_997), set at about 1.5 times the measurement, rounded up.
// map: 26_024 on 2026-10-23 (0.2.0: the slots, the setup, the basemap, the ramps and the grid, cog and h3 providers,
// the h3 worker module and the archive writer all counted), so 39_000; the 5_000 it held was the scaffold's provisional
// budget. catalog holds only constants and types in the browser (404 B on 2026-10-22, its validator and CLI left out
// below): its 5_000 budget is provisional and gets set from a measurement once its readers land (build week 1).
const BUDGET = { places: 18_000, status: 12_000, map: 39_000, catalog: 5_000 }

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
process.exit(over ? 1 : 0)
