// what the Cell pane's species read costs (speciesForCell): requests, bytes, row groups and milliseconds per cell,
// cold (a new reader: the footer too) and warm (the same reader, footer kept). reads the built package (npm run build
// first). run from the repo root:
//   node packages/map/fixtures/h3release/measure_species.mjs                         # the synthetic fixture
//   node packages/map/fixtures/h3release/measure_species.mjs https://.../species_flat/res=3.parquet [cell ...]
// default cells over HTTP: 81197ffffffffff (res 1, the atlas's 8,963 species) and 8329a9fffffffff (res 3, Monterey); each with
// the default 64 KiB tail and a 256 KiB one (the release's footer is 245 kB).
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { ReleaseReader, speciesForCell } from '../../dist/index.js'

const HERE = new URL('./', import.meta.url)
const href = process.argv[2] ?? 'https://release.test/species_flat/res=3.parquet'
const local = /^https?:\/\/release\.test/.test(href)
// the fixture's own: the res-1 cell over California (49 res-3 children) and a res-3 cell across two row groups
const cells = process.argv.length > 3 ? process.argv.slice(3) : local ? ['81293ffffffffff', '832929fffffffff'] : ['81197ffffffffff', '8329a9fffffffff']
const fsFetch = async (url, init) => {
  const buf = readFileSync(new URL('species_flat/res=3.parquet', HERE))
  const range = new Headers(init?.headers).get('Range') ?? ''
  let a = 0, b = buf.length - 1
  const sfx = /^bytes=-(\d+)$/.exec(range), span = /^bytes=(\d+)-(\d+)$/.exec(range)
  if (sfx) a = Math.max(0, buf.length - Number(sfx[1]))
  else if (span) [a, b] = [Number(span[1]), Math.min(buf.length - 1, Number(span[2]))]
  return new Response(new Uint8Array(buf.subarray(a, b + 1)), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${buf.length}` } })
}
const fetch = local ? fsFetch : globalThis.fetch

const out = { href }
for (const tail of [65_536, 262_144]) for (const cell of cells) {
  const reader = new ReleaseReader({ fetch, tail })
  const runs = []
  for (const k of ['cold', 'warm']) {
    const t0 = performance.now()
    const r = await speciesForCell(href, cell, { res: 3, reader, columns: ['aphiaid', 'n', 'name_key', 'year_min', 'year_max'] })
    runs.push([k, { requests: r.requests, bytes: r.bytes, groupsRead: r.groupsRead, groupsSkipped: r.groupsSkipped, rows: r.rows.length,
      species: new Set(r.rows.map((x) => x.aphiaid)).size, ms: +(performance.now() - t0).toFixed(0) }])
  }
  out[`${cell} tail ${tail}`] = Object.fromEntries(runs)
}
console.log(JSON.stringify(out, null, 1))
