// the bundle numbers (Vite 8 build, minified; gzip -9 per file). each size entry is built as its own app
// (SIZE=<name> vite build -> dist-size-<name>/), so its eager JS is what that app pays: the entry chunk and every chunk
// it imports statically (dist-size-<name>/.vite/manifest.json); its dynamic imports load on demand. the package's share
// is the difference from size-zero (maplibre-gl alone) or size-pmtiles (maplibre-gl + the pmtiles protocol, which
// setupMapLibre registers), each provider's the difference from size-base. the worker chunks come from the page build
// (dist/). writes results/bundle.json. usage: npm run build && node scripts/bundle.mjs
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const NAMES = ['zero', 'pmtiles', 'ns', 'base', 'grid', 'cogslot', 'cog', 'h3', 'all']
const gz = (dir, f) => gzipSync(readFileSync(`${dir}/${f}`), { level: 9 }).length
function measure(dir) {
  const manifest = JSON.parse(readFileSync(`${dir}/.vite/manifest.json`, 'utf8'))
  const closure = (key, seen = new Set()) => {
    if (seen.has(key)) return seen
    seen.add(key)
    for (const k of manifest[key].imports ?? []) closure(k, seen)
    return seen
  }
  const key = Object.keys(manifest).find((k) => manifest[k].isEntry)
  const eager = [...closure(key)]
  const files = eager.map((k) => manifest[k].file).filter((f) => f.endsWith('.js'))
  const dyn = new Set()
  for (const k of eager) for (const d of manifest[k].dynamicImports ?? []) for (const c of closure(d)) if (!eager.includes(c)) dyn.add(c)
  return {
    eagerGzip: files.reduce((s, f) => s + gz(dir, f), 0),
    eagerFiles: files.length,
    onDemand: [...dyn].map((k) => ({ src: (manifest[k].src ?? k).replace(/^.*node_modules\//, '').replace(/^.*packages\/map\//, '@oceanmetrics/map/'), gzip: gz(dir, manifest[k].file) })).sort((a, b) => b.gzip - a.gzip),
    workers: Object.fromEntries(readdirSync(`${dir}/assets`).filter((f) => f.endsWith('.mjs')).map((f) => [f.replace(/-[\w-]{8}\.mjs$/, '.mjs'), gz(dir, `assets/${f}`)])),
  }
}
const out = { entries: {} }
for (const n of NAMES) {
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { env: { ...process.env, SIZE: n }, stdio: 'inherit' })
  out.entries[n] = measure(`dist-size-${n}`)
}
const e = (n) => out.entries[n].eagerGzip
out.package = {
  'base over maplibre-gl': e('base') - e('zero'),
  'base over maplibre-gl + pmtiles': e('base') - e('pmtiles'),
  'namespace import over named (the 0.2.0 README snippet)': e('ns') - e('base'),
  'grid over base': e('grid') - e('base'),
  'cogSlot over base': e('cogslot') - e('base'),
  'cogSlot + pointValue + overviewHistogram over base': e('cog') - e('base'),
  'h3 over base': e('h3') - e('base'),
  'all three over base': e('all') - e('base'),
}
out.workers = out.entries.all.workers
out.cogProtocol = out.entries.cog.onDemand.find((d) => /maplibre-cog-protocol/.test(d.src)) ?? null
writeFileSync('results/bundle.json', JSON.stringify(out, null, 1))
console.log(JSON.stringify({ eager: Object.fromEntries(NAMES.map((n) => [n, e(n)])), package: out.package, workers: out.workers, cogProtocol: out.cogProtocol }, null, 1))
for (const n of NAMES) console.log(n, out.entries[n].onDemand.map((d) => `${d.src}:${d.gzip}`).join('  '))
