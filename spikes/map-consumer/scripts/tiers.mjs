// the bytes of a first view per basemap tier (packages/map 0.3.4, "far and core no longer both draw at z0-5"): the page
// boots the README flow on CARTO's real style, then composeStyle with the live tiers, at one centre and one zoom per
// run; every response is counted by the archive it came from (Playwright's request.sizes(): the body bytes on the wire,
// worker requests included). tiers are read from the S3 host (same bytes as storage.oceanmetrics.io, CORS on every prefix).
// usage: npm run build && node scripts/tiers.mjs [label]   (label names results/tiers-<label>.json, default "after")
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { serve } from './serve.mjs'

const PORT = 5211
const LABEL = process.argv[2] ?? 'after'
const BASE = process.env.TIERS_BASE ?? 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/basemap/'
const TILES = {
  core: `${BASE}gebco/core.pmtiles`, far: `${BASE}gebco/far.pmtiles`, regional: [`${BASE}gebco/core-sanctuaries.pmtiles`],
  contours: `${BASE}gebco/contours.pmtiles`, names: `${BASE}gebco/names.pmtiles`, land: `${BASE}osm/land.pmtiles`,
}
const KINDS = [['far', /gebco\/far\.pmtiles/], ['core-sanctuaries', /core-sanctuaries\.pmtiles/], ['core', /gebco\/core\.pmtiles/],
  ['contours', /contours\.pmtiles/], ['names', /names\.pmtiles/], ['land', /land\.pmtiles/]]
const kind = (url) => KINDS.find(([, re]) => re.test(url))?.[0] ?? (/cartocdn|basemaps\./.test(url) ? 'carto' : null)
// the views: Monterey Bay (inside the sanctuaries' boxes), the zooms of the claim and the seams
const VIEWS = (process.env.VIEWS ?? '2,6,8').split(',').map(Number)
const WIDTHS = (process.env.WIDTHS ?? '1280,390').split(',').map(Number)
const CENTER = [-122.5, 36.8]

const server = await serve(PORT)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] })
const out = { when: new Date().toISOString(), chrome: browser.version(), label: LABEL, center: CENTER, tiles: TILES, views: [] }
for (const W of WIDTHS) for (const zoom of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: W < 500 ? 844 : 800 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const seen = []
  ctx.on('requestfinished', async (r) => {
    const k = kind(r.url())
    if (!k) return
    const s = await r.sizes().catch(() => null)
    if (s) seen.push({ k, bytes: s.responseBodySize, range: (await r.headerValue('range')) ?? null })
  })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForFunction(() => window.__ready)
  const b = await page.evaluate((v) => window.__c.boot(v), { center: CENTER, zoom, part: false, style: { tiles: TILES } })
  await page.waitForTimeout(1500)
  const tiers = {}
  for (const { k, bytes } of seen) { const t = (tiers[k] ??= { requests: 0, bytes: 0 }); t.requests++; t.bytes += bytes }
  const relief = ['far', 'core', 'core-sanctuaries'].reduce((a, k) => a + (tiers[k]?.bytes ?? 0), 0)
  const total = Object.values(tiers).reduce((a, t) => a + t.bytes, 0)
  out.views.push({ width: W, zoom, tiers, relief, total, errors: b.errors })
  console.log(`@${W} z${zoom}: relief ${relief} B (${['far', 'core', 'core-sanctuaries'].map((k) => `${k} ${tiers[k]?.bytes ?? 0}/${tiers[k]?.requests ?? 0}`).join(', ')}); all tiers + carto ${total} B; errors ${b.errors}`)
  await ctx.close()
}
await browser.close()
server.close()
mkdirSync('results', { recursive: true })
writeFileSync(`results/tiers-${LABEL}.json`, JSON.stringify(out, null, 2) + '\n')
