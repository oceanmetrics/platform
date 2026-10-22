// the h3 data of the consumer check, from the obis-h3 res-5 `all` partition (hyparquet, zstd via hyparquet-compressors):
//   data/es5.pmtiles   buildH3jArchive over ES(50): res 1..4 rolled up (mean) from the res-5 table, z0-6, domain p02-p98
//   data/cells-pacific.json  the in-memory form: the res-5 cells with a centre within 30° of ±180 and |lat| < 45
// usage: node scripts/build-data.mjs [parquet]
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { cellToLatLng } from 'h3-js'
import { buildH3jArchive, rollUp } from '@oceanmetrics/map'

const SRC = process.argv[2] ?? '/Volumes/msens_big/_big/obis/obis-h3/v20261012/all/res=5/data_0.parquet'
const t0 = performance.now()
const rows = await parquetReadObjects({ file: await asyncBufferFromFile(SRC), columns: ['h3', 'es'], compressors })
const keep = rows.filter((r) => r.es !== null && r.es !== undefined)
const h3 = keep.map((r) => String(r.h3))
const v = keep.map((r) => Math.round(Number(r.es) * 100) / 100)
const s = Float64Array.from(v).sort()
const q = (p) => { const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.min(s.length - 1, lo + 1); return s[lo] + (h - lo) * (s[hi] - s[lo]) }
const domain = [Math.round(q(0.02) * 1000) / 1000, Math.round(q(0.98) * 1000) / 1000]
console.log(`read ${rows.length} rows, ${keep.length} with es, domain ${domain} (${Math.round(performance.now() - t0)} ms)`)

mkdirSync('data', { recursive: true })
const res5 = { h3, v }
const levels = [1, 2, 3, 4].map((r) => rollUp(res5, r, 'mean')).concat([res5])
const t1 = performance.now()
const arch = await buildH3jArchive({ levels, maxzoom: 6, metadata: { domain, value: 'es', source: 'obis-h3 v20261012 all res=5' }, gzip: (b) => gzipSync(b, { level: 9 }) })
writeFileSync('data/es5.pmtiles', arch.bytes)
const info = { cells: keep.length, domain, levels: levels.map((l) => l.h3.length), bytes: arch.bytes.length, tiles: arch.tiles, zooms: arch.zooms, buildMs: Math.round(performance.now() - t1) }
console.log(JSON.stringify(info))

const pac = { h3: [], v: [] }
for (let i = 0; i < h3.length; i++) {
  const [lat, lon] = cellToLatLng(h3[i])
  if (Math.abs(lat) < 45 && Math.abs(lon) > 150) { pac.h3.push(h3[i]); pac.v.push(v[i]) }
}
writeFileSync('data/cells-pacific.json', JSON.stringify({ domain, ...pac }))
console.log(`pacific: ${pac.h3.length} cells`)
writeFileSync('results/data.json', JSON.stringify({ ...info, pacificCells: pac.h3.length }, null, 1))
