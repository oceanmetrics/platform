// the packages' size budget (README "Size budget"): gzip (level 9) of the summed dist/**/*.js of each package, after
// `npm run build`. raise a budget only with the reason written in the README. one line per package; exit 1 if any is over.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ROOT = new URL('../packages/', import.meta.url).pathname
// bytes, gzip. measured on 2026-10-22 (places 11_708, status 7_997), set at about 1.5 times the measurement, rounded up.
// map and catalog are scaffolds: their 5_000 budgets are provisional and get set from a measurement once they hold code
// (map in build week 2, catalog in build week 1; see their READMEs).
const BUDGET = { places: 18_000, status: 12_000, map: 5_000, catalog: 5_000 }

const jsFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? jsFiles(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : [])

let over = false
for (const [name, max] of Object.entries(BUDGET)) {
  const dist = join(ROOT, name, 'dist')
  if (!existsSync(dist)) throw new Error(`size budget: ${dist} not found; run npm run build first`)
  const files = jsFiles(dist).sort()
  const got = gzipSync(Buffer.concat(files.map(f => readFileSync(f))), { level: 9 }).length
  const ok = got <= max
  over ||= !ok
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name.padEnd(8)} ${String(got).padStart(6)} B gzip (budget ${max} B, ${files.length} files)`)
}
process.exit(over ? 1 : 0)
