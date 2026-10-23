// builds the synthetic obis-h3 0.11-shaped release the h3 release provider is tested on (h3Release.test.ts): layer
// files sorted by cell_id with small row groups and their statistics, as obisindicators 0.11 writes them, plus a
// stats.parquet and a collection.json of the h3 profile 1.1. synthetic: cells from h3-js, values from a hash of the
// cell id; no OBIS data. run from the repo root (needs the duckdb CLI on PATH):
//   node packages/map/fixtures/h3release/build.mjs
// the layers (relative to this folder):
//   all/res=1..3/data_0.parquet   the globe (842, 5,882, 41,162 cells), row groups of 10,240 (res 3: 5 groups)
//   all/res=4,5/data_0.parquet    three regions (California, the Gulf of Guinea, Fiji), res 5: 3 x 2,048 rows in
//                                 row groups of 2,048, one region per group (checked below)
//   all/res=6/p=<res-2 parent>/   a California disc at res 6 split by its res-2 parents (h3:layout.parent_template)
//   seam/res=5/                   the 55 cells of fixtures/h3/crossing55.json (the antimeridian)
//   taxon/rank=class/taxon=Aves/res=5,6/   a whole file at res 6 (no parent split: the fallback)
//   decade/all/decade=1990s|2000s/res=1..3/, year/all/year=2015/res=1..3/   the period sets (res 1 the globe, 2 and 3
//                                 the regions), values shifted per period
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cellToChildren, cellToLatLng, cellToParent, getRes0Cells, gridDisk, greatCircleDistance, latLngToCell, UNITS } from 'h3-js'

const HERE = dirname(new URL(import.meta.url).pathname)
const TMP = join(HERE, '.tmp')
const COLS = ['h3', 'cell_id', 'n', 'sp', 'shannon', 'simpson', 'es']

// ---- values: a hash of the cell id, shifted per period so a test can tell which file it read ----
function hash(h3) {
  let x = 2166136261
  for (let i = 0; i < h3.length; i++) x = Math.imul(x ^ h3.charCodeAt(i), 16777619) >>> 0
  return x
}
function row(h3, shift = 0) {
  const k = hash(h3)
  // few distinct values (dictionary pages), so the fixture stays small; es is NULL under 50 records, as the release's
  const n = 1 + (k % 400) * 10 + shift
  return {
    h3, cell_id: BigInt('0x' + h3).toString(), n, sp: 1 + (k % 600),
    shannon: ((k >>> 3) % 80) / 10 + shift / 1000, simpson: ((k >>> 5) % 100) / 100,
    es: n >= 50 ? 1 + ((k >>> 7) % 490) / 10 + shift / 100 : null,
  }
}

// ---- writing ----
let files = 0
function write(path, cells, { shift = 0, rowGroup = 10240 } = {}) {
  mkdirSync(TMP, { recursive: true })
  const nd = join(TMP, `f${files++}.ndjson`)
  writeFileSync(nd, cells.map((h) => JSON.stringify(row(h, shift))).join('\n') + '\n')
  const out = join(HERE, path)
  mkdirSync(dirname(out), { recursive: true })
  rmSync(out, { force: true })
  const sql = `SET threads = 1; SET preserve_insertion_order = true;
    COPY (SELECT h3, cell_id::BIGINT AS cell_id, n::BIGINT AS n, sp::BIGINT AS sp, shannon::DOUBLE AS shannon,
      simpson::DOUBLE AS simpson, es::DOUBLE AS es
      FROM read_json('${nd}', columns = {h3: 'VARCHAR', cell_id: 'VARCHAR', n: 'BIGINT', sp: 'BIGINT', shannon: 'DOUBLE', simpson: 'DOUBLE', es: 'DOUBLE'})
      ORDER BY cell_id::BIGINT)
    TO '${out}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE ${rowGroup});`
  execFileSync('duckdb', ['-c', sql])
  return out
}
function groups(path) {
  const sql = `SELECT row_group_id, row_group_num_rows, stats_min, stats_max FROM parquet_metadata('${join(HERE, path)}') WHERE path_in_schema = 'cell_id' ORDER BY 1`
  return JSON.parse(execFileSync('duckdb', ['-json', '-c', sql]).toString())
}

// ---- the cells ----
const globe = (res) => getRes0Cells().flatMap((c) => cellToChildren(c, res))
/** the `count` cells of `res` nearest a centre (a round disc), sorted by id */
function disc(lat, lng, res, count) {
  const c = latLngToCell(lat, lng, res)
  let k = 1
  while (3 * k * (k + 1) + 1 < count * 1.3) k++
  return gridDisk(c, k)
    .map((h) => [h, greatCircleDistance(cellToLatLng(h), [lat, lng], UNITS.km)])
    .sort((a, b) => a[1] - b[1]).slice(0, count).map((x) => x[0])
}
const REGIONS = { cal: [34, -121], gog: [0, 3], fiji: [-17.5, 178] }
const res5 = Object.fromEntries(Object.entries(REGIONS).map(([k, [la, lo]]) => [k, disc(la, lo, 5, 2048)]))
const regions5 = [...res5.cal, ...res5.gog, ...res5.fiji]
const regions4 = [...new Set(regions5.map((h) => cellToParent(h, 4)))]
const regions3 = [...new Set(regions5.map((h) => cellToParent(h, 3)))]
const regions2 = [...new Set(regions5.map((h) => cellToParent(h, 2)))]

rmSync(join(HERE, 'all'), { recursive: true, force: true })
for (const d of ['seam', 'taxon', 'decade', 'year']) rmSync(join(HERE, d), { recursive: true, force: true })

for (const r of [1, 2, 3]) write(`all/res=${r}/data_0.parquet`, globe(r))
write('all/res=4/data_0.parquet', regions4, { rowGroup: 2048 })
write('all/res=5/data_0.parquet', regions5, { rowGroup: 2048 })
// res 6 split by res-2 parents: a California disc
const cal6 = disc(34, -121, 6, 1500)
const byParent = new Map()
for (const h of cal6) { const p = cellToParent(h, 2); byParent.set(p, [...(byParent.get(p) ?? []), h]) }
for (const [p, hs] of byParent) write(`all/res=6/p=${p}/data_0.parquet`, hs, { rowGroup: 2048 })

const CROSSING = JSON.parse(readFileSync(join(HERE, '../h3/crossing55.json'), 'utf8')).h3
write('seam/res=5/data_0.parquet', CROSSING)

write('taxon/rank=class/taxon=Aves/res=5/data_0.parquet', res5.cal.slice(0, 300))
write('taxon/rank=class/taxon=Aves/res=6/data_0.parquet', cal6.slice(0, 400))

const PERIODS = [['decade', '1990s', 1000], ['decade', '2000s', 2000], ['year', '2015', 3000]]
for (const [grain, v, shift] of PERIODS) {
  write(`${grain}/all/${grain}=${v}/res=1/data_0.parquet`, globe(1), { shift })
  write(`${grain}/all/${grain}=${v}/res=2/data_0.parquet`, regions2, { shift })
  write(`${grain}/all/${grain}=${v}/res=3/data_0.parquet`, regions3, { shift })
}

// ---- checks: the res-5 file has three groups, one region each; res 3 has five ----
const g5 = groups('all/res=5/data_0.parquet')
if (g5.length !== 3) throw new Error(`all/res=5: ${g5.length} row groups, wanted 3`)
for (const [i, k] of ['cal', 'gog', 'fiji'].entries()) {
  const ids = res5[k].map((h) => BigInt('0x' + h))
  const lo = ids.reduce((a, b) => (b < a ? b : a)), hi = ids.reduce((a, b) => (b > a ? b : a))
  const g = g5.find((x) => BigInt(x.stats_min) === lo && BigInt(x.stats_max) === hi)
  if (!g) throw new Error(`all/res=5: region ${k} is not one row group`)
  console.log(`all/res=5 group ${g.row_group_id}: ${k}, ${g.row_group_num_rows} rows`)
}
const g3 = groups('all/res=3/data_0.parquet')
console.log(`all/res=3: ${g3.length} row groups (${g3.map((g) => g.row_group_num_rows).join(', ')})`)

// ---- stats.parquet: one row per layer x key x rank x period x res x variable, as the release's, from the files;
// plus 400 synthetic taxon keys so the file has several row groups (the legend reads only the group of its layer) ----
const statFiles = [
  ['all', '', '', null, null, (r) => `all/res=${r}/data_0.parquet`, [1, 2, 3, 4, 5]],
  ['decade_all', '', '', '1990s', null, (r) => `decade/all/decade=1990s/res=${r}/data_0.parquet`, [1, 2, 3]],
  ['decade_all', '', '', '2000s', null, (r) => `decade/all/decade=2000s/res=${r}/data_0.parquet`, [1, 2, 3]],
  ['year_all', '', '', null, '2015', (r) => `year/all/year=2015/res=${r}/data_0.parquet`, [1, 2, 3]],
  ['taxon', 'Aves', 'class', null, null, (r) => `taxon/rank=class/taxon=Aves/res=${r}/data_0.parquet`, [5, 6]],
]
const parts = []
for (const [layer, key, rank, decade, year, path, ress] of statFiles) for (const r of ress) for (const v of COLS.slice(2)) {
  parts.push(`SELECT '${layer}' AS layer, '${key}' AS key, '${rank}' AS rank, ${decade ? parseInt(decade) : 'NULL'}::INTEGER AS decade,
    ${year ? parseInt(year) : 'NULL'}::INTEGER AS year, ${r}::INTEGER AS res, '${v}' AS variable, min(${v})::DOUBLE AS min,
    quantile_cont(${v}, 0.02)::DOUBLE AS p02, quantile_cont(${v}, 0.5)::DOUBLE AS p50, quantile_cont(${v}, 0.98)::DOUBLE AS p98,
    max(${v})::DOUBLE AS max, count(${v})::BIGINT AS n_cells FROM '${join(HERE, path(r))}'`)
}
const fake = `SELECT 'taxon' AS layer, 'Taxon' || lpad(i::VARCHAR, 3, '0') AS key, 'family' AS rank, NULL::INTEGER AS decade,
  NULL::INTEGER AS year, r::INTEGER AS res, v AS variable, 1.0 AS min, 2.0 AS p02, 5.0 AS p50, 9.0 AS p98, 10.0 AS max, 100::BIGINT AS n_cells
  FROM range(400) t(i), range(1, 6) s(r), (VALUES ('n'), ('sp'), ('shannon'), ('simpson'), ('es')) u(v)`
rmSync(join(HERE, 'stats.parquet'), { force: true })
execFileSync('duckdb', ['-c', `SET threads = 1; COPY (SELECT * FROM (${parts.join(' UNION ALL ')} UNION ALL ${fake})
  ORDER BY layer, key, rank, decade NULLS FIRST, year NULLS FIRST, res, variable) TO '${join(HERE, 'stats.parquet')}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 2048);`])
const gs = JSON.parse(execFileSync('duckdb', ['-json', '-c', `SELECT row_group_id, stats_min, stats_max FROM parquet_metadata('${join(HERE, 'stats.parquet')}') WHERE path_in_schema = 'layer' ORDER BY 1`]).toString())
console.log(`stats.parquet: ${gs.length} row groups (${gs.map((g) => `${g.stats_min}..${g.stats_max}`).join(', ')})`)

rmSync(TMP, { recursive: true, force: true })
console.log(`${files} layer files written`)
