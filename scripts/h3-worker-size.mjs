// the h3 worker chunk an app ships (`@oceanmetrics/map/h3-worker`, loaded into MapLibre's worker by setupMapLibre):
// packages/map/src/h3Worker.ts bundled alone with everything it imports (h3-js, geojson-vt, vt-pbf, pmtiles, hyparquet,
// fzstd), minified, gzip -9, as Vite 8 (rolldown) emits it. measured apart from the package budget: the package line
// sums dist/**/*.js unbundled, this is the bytes a browser fetches on the first hexagon. used by scripts/size-budget.mjs
// and packages/map/src/h3Worker.size.test.ts.
import { gzipSync } from 'node:zlib'
import { build } from 'rolldown'

// bytes, gzip. 76,808 on 2026-10-23 at 0.2.3 (the h3j PMTiles protocol; h3-js is 60.6 kB of it). 100,199 at 0.3.0 with
// the release provider: + hyparquet's reader 16.7 kB (parquetRead and parquetMetadataAsync bundled alone; its metadata
// path imports the geoparquet, wkb and bloom modules unconditionally, so it does not tree-shake further), + fzstd 3.4 kB
// (the release's ZSTD), + the reader and the bit arithmetic about 3 kB. the week 4 plan's provisional 100 kB was
// "measure, then set": set at 110,000 (about 10% over the measure), the reason in the map README "Size".
export const H3_WORKER_BUDGET = 110_000

export async function measureH3Worker() {
  const input = new URL('../packages/map/src/h3Worker.ts', import.meta.url).pathname
  const r = await build({ input, write: false, platform: 'browser', treeshake: true, logLevel: 'silent', output: { format: 'es', minify: true, codeSplitting: false } })
  const chunks = (r.output ?? r).filter((c) => c.type === 'chunk')
  const code = chunks.map((c) => c.code).join('\n')
  return { chunks: chunks.length, bytes: code.length, gzip: gzipSync(code, { level: 9 }).length }
}
