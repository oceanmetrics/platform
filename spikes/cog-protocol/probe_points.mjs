// point agreement: at 300 random valid pixels per file, the protocol's locationValues() on the
// 3857 copy and geotiff.js on the 4326 original against GDAL on the original (points_sample.py).
// Both served locally (serve.mjs). -> results/points_agreement.json
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const pts = JSON.parse(readFileSync('results/points_sample.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto('http://localhost:5199/'); await page.evaluate(() => window.spikeReady)
const out = {}
for (const [name, p] of Object.entries(pts)) {
  const res = await page.evaluate(async ([name, p]) => {
    const rows = []
    for (const q of p) {
      const a = await window.spike.protoPoint(`http://localhost:8787/3857/${name}`, q.lon, q.lat)
      const b = await window.spike.pointValues(`http://localhost:8787/${name}`, q.lon, q.lat)
      rows.push({ proto: a.values, protoMs: a.ms, geotiff: b.values, geotiffMs: b.ms.total })
    }
    return rows
  }, [name, p])
  const norm = v => v.map(x => (x === null || Number.isNaN(x) ? null : x))
  const eq = (u, v) => JSON.stringify(norm(u)) === JSON.stringify(norm(v))
  const protoOk = res.filter((r, i) => eq(r.proto, p[i].values)).length
  const gtOk = res.filter((r, i) => eq(r.geotiff, p[i].values)).length
  const protoNull = res.filter(r => r.proto.every(x => x === null || Number.isNaN(x))).length
  // where the protocol differs: how far is the point from its 4326 pixel's edge (in pixels)?
  const diffs = res.map((r, i) => ({ r, q: p[i] })).filter(({ r, q }) => !eq(r.proto, q.values)).slice(0, 5)
    .map(({ r, q }) => ({ lon: q.lon, lat: q.lat, gdal: q.values, proto: norm(r.proto) }))
  const mismatch = res.map((r, i) => (eq(r.proto, p[i].values) ? -1 : i)).filter(i => i >= 0)
  out[name] = { n: p.length, mismatch, protoMsMedian: res.map(r => r.protoMs).sort((a, b) => a - b)[150], geotiffMsMedian: res.map(r => r.geotiffMs).sort((a, b) => a - b)[150], protocolMatchesGdal: protoOk, protocolNoData: protoNull, geotiffMatchesGdal: gtOk, examples: diffs }
  console.log(name, out[name].n, 'protocol==gdal', protoOk, 'protocol nodata', protoNull, 'geotiff==gdal', gtOk)
}
writeFileSync('results/points_agreement.json', JSON.stringify(out, null, 1))
await browser.close()
