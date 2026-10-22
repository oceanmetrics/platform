// the spike's measurements, in system Chrome through Playwright. Needs `npx vite preview` on 5199
// and `node serve.mjs <data_dir> 8787` (the EPSG:3857 copies under <data_dir>/3857/).
// usage: node run.mjs [draw|stats|points|shots|all]  -> results/*.json, shots/*.png
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const PAGE = 'http://localhost:5199/'
const LOCAL = 'http://localhost:8787/3857/'
const S3 = 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/'
const TITILER = 'https://titiler-v8.marinesensitivity.org'
const REPS = +(process.env.REPS ?? 3)
// S3 from this machine (curl, 2026-10-22): 130 ms per warm range request, 5.1 MB/s
const S3LIKE = { offline: false, latency: 130, downloadThroughput: 5.1e6, uploadThroughput: 5.1e6 }

export const FILES = [
  { key: 'score_risk', name: 'score_risk.tif', s3: S3 + 'atlas/aquamaps_eov/score_risk.tif',
    draw: { band: 1, range: [0, 100] }, z8: [-119.52, 33.83] },
  { key: 'am_native', name: '729c63f1d05d0515.tif', s3: S3 + 'marine-atlas/native/am/729c63f1d05d0515.tif',
    draw: { hash: '#color:BrewerYlGnBu9,1,100,c' }, z8: [110.8, -5.2] },
  { key: 'mst', name: '9fe6f75498affae1.tif', s3: S3 + 'marine-atlas/cog/usa05/9fe6f75498affae1.tif',
    draw: { hash: '#color:BrewerOrRd9,15,100,c' }, z8: [-84.625, 27.425] },
]
const VIEWS = { world: f => ({ center: [0, 20], zoom: 1.3 }), z8: f => ({ center: f.z8, zoom: 8 }) }

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })

/** a fresh context (empty HTTP and protocol caches) with a CDP byte counter over .tif requests. */
async function fresh(viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  const urls = new Map(), net = { bytes: 0, requests: 0, byUrl: {} }
  cdp.on('Network.requestWillBeSent', e => urls.set(e.requestId, e.request.url))
  cdp.on('Network.loadingFinished', e => {
    const u = urls.get(e.requestId) ?? ''
    if (!/\.tif/.test(u)) return
    net.bytes += e.encodedDataLength; net.requests += 1
    net.byUrl[u] = (net.byUrl[u] ?? 0) + e.encodedDataLength
  })
  page.on('pageerror', e => console.error('pageerror', e.message))
  await page.goto(PAGE)
  await page.waitForFunction(() => window.spikeReady)
  await page.evaluate(() => window.spikeReady)
  const reset = () => { net.bytes = 0; net.requests = 0; net.byUrl = {} }
  const throttle = c => cdp.send('Network.emulateNetworkConditions', c ?? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  return { ctx, page, net, reset, throttle }
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }

async function drawRuns() {
  const out = []
  const sources = [
    { src: '4326 S3 (as published)', url: f => f.s3, net: null },
    { src: '3857 copy, local', url: f => LOCAL + f.name, net: null },
    { src: '3857 copy, local + S3-like network', url: f => LOCAL + f.name, net: S3LIKE },
  ]
  for (const f of FILES) for (const s of sources) for (const [vk, v] of Object.entries(VIEWS)) {
    const runs = []
    for (let r = 0; r < REPS; r++) {
      const { ctx, page, net, reset, throttle } = await fresh()
      await throttle(s.net)
      reset()
      const res = await page.evaluate(o => window.spike.draw(o), { url: s.url(f), ...f.draw, ...v(f) })
      runs.push({ ...res, bytes: net.bytes, requests: net.requests })
      await ctx.close()
    }
    const row = { file: f.key, source: s.src, view: vk, reps: REPS,
      firstTileMs: median(runs.map(r => r.firstTileMs)), idleMs: median(runs.map(r => r.idleMs)),
      bytes: median(runs.map(r => r.bytes)), requests: median(runs.map(r => r.requests)), tiles: median(runs.map(r => r.tiles)),
      errors: [...new Set(runs.flatMap(r => r.errors))], tilejson: runs[0].tilejson, runs }
    console.log(row.file, row.source, row.view, Math.round(row.firstTileMs), Math.round(row.idleMs), row.bytes, row.requests, row.tiles, row.errors.join('|').slice(0, 160), JSON.stringify(row.tilejson?.bounds))
    out.push(row)
  }
  writeFileSync('results/draw.json', JSON.stringify(out, null, 1))
}

async function statsRuns() {
  const gdal = JSON.parse(readFileSync('results/gdal_stats.json', 'utf8'))
  const out = { overview: [], view: [], titiler: [] }
  for (const f of FILES) {
    const g = gdal.files[f.name]
    for (const [label, url, crs, netc] of [['4326 S3', f.s3, '4326', null], ['3857 copy, local + S3-like network', LOCAL + f.name, '3857', S3LIKE]]) {
      const refEdges = g['4326'].bands.map(b => [b.full.minimum, b.full.maximum])
      const runs = []
      for (let r = 0; r < REPS; r++) {
        const { ctx, page, net, reset, throttle } = await fresh()
        await throttle(netc); reset()
        const t0 = Date.now()
        const s = await page.evaluate(([u, e]) => window.spike.overviewStats(u, e), [url, refEdges])
        s.wallMs = Date.now() - t0; s.cdpBytes = net.bytes; s.cdpRequests = net.requests
        if (r === 0 && crs === '4326') {
          const b = s.bands[0]
          await page.evaluate(([b, lab]) => window.spike.showHist(lab, b.histogram.buckets, b.histogram.min, b.histogram.max), [b, `${f.key} band 1: overview ${s.width}x${s.height}`])
        }
        runs.push(s)
        await ctx.close()
      }
      const s = runs[0]
      console.log('overview', f.key, label, s.width, s.height, 'ms', runs.map(r => Math.round(r.ms.total)), 'bytes', s.bytes, s.cdpBytes, s.requests)
      out.overview.push({ file: f.key, source: label, crs, runs, medianMs: median(runs.map(r => r.ms.total)), bytes: s.bytes, cdpBytes: s.cdpBytes, requests: s.requests })
    }
    // view statistics for the world and zoom-8 views, on the 4326 original (S3) and the 3857 copy
    const variants = f.key === 'score_risk' ? [{}, { band: 1 }, { band: 1, pool: true }] : [{}]
    for (const [vk, v] of Object.entries(VIEWS)) for (const [label, url, netc] of [['4326 S3', f.s3, null], ['3857 copy, local + S3-like network', LOCAL + f.name, S3LIKE]]) for (const opts of variants) {
      const runs = []
      for (let r = 0; r < REPS; r++) {
        const { ctx, page, net, reset, throttle } = await fresh()
        const { center, zoom } = v(f)
        const view = await page.evaluate(([c, z]) => window.spike.jump(c, z), [center, zoom])
        await throttle(netc); reset()
        const s = await page.evaluate(([u, b, w, o]) => window.spike.viewStats(u, b, w, o), [url, view.bounds, view.width, opts])
        s.view = view; s.cdpBytes = net.bytes
        runs.push(s)
        await ctx.close()
      }
      const s = runs[0]
      console.log('view', f.key, vk, label, JSON.stringify(opts), 'image', s.image, s.window, 'ms', runs.map(r => Math.round(r.ms.total)), 'read', runs.map(r => Math.round(r.ms.read)), 'bytes', s.bytes)
      out.view.push({ file: f.key, view: vk, source: label, opts, runs, medianMs: median(runs.map(r => r.ms.total)), medianReadMs: median(runs.map(r => r.ms.read)), bytes: s.bytes, requests: s.requests })
    }
    // titiler /cog/statistics on the public 4326 url: its default (max_size=1024) and full resolution
    for (const ms of [null, Math.max(g['4326'].width, g['4326'].height)]) {
      const u = `${TITILER}/cog/statistics?url=${encodeURIComponent(f.s3)}&histogram_bins=32${ms ? `&max_size=${ms}` : ''}`
      const t0 = performance.now(); const r = await fetch(u); const j = r.ok ? await r.json() : { status: r.status, text: await r.text() }
      out.titiler.push({ file: f.key, max_size: ms ?? 1024, ms: performance.now() - t0, status: r.status, body: j })
      console.log('titiler', f.key, ms ?? 1024, r.status, Math.round(performance.now() - t0))
    }
  }
  writeFileSync('results/stats.json', JSON.stringify(out, null, 1))
}

async function pointRuns() {
  const out = []
  for (const f of FILES) {
    const [lon, lat] = f.z8
    const near = [lon + 0.3, lat + 0.2]
    for (const [label, fn, url, netc] of [
      ['protocol locationValues, 3857 copy, S3-like', 'protoPoint', LOCAL + f.name, S3LIKE],
      ['geotiff.js window, 3857 copy, S3-like', 'pointValues', LOCAL + f.name, S3LIKE],
      ['geotiff.js window, 4326 S3', 'pointValues', f.s3, null],
    ]) {
      const runs = []
      for (let r = 0; r < REPS; r++) {
        const { ctx, page, net, reset, throttle } = await fresh()
        await throttle(netc); reset()
        const cold = await page.evaluate(([fn, u, x, y]) => window.spike[fn](u, x, y), [fn, url, lon, lat])
        const coldBytes = net.bytes; reset()
        const warm = await page.evaluate(([fn, u, x, y]) => window.spike[fn](u, x, y), [fn, url, ...near])
        runs.push({ cold, coldBytes, warm, warmBytes: net.bytes })
        await ctx.close()
      }
      const ms = r => (typeof r.ms === 'number' ? r.ms : r.ms.total)
      const row = { file: f.key, method: label, lonlat: [lon, lat], near, values: runs[0].cold.values, nearValues: runs[0].warm.values,
        coldMs: median(runs.map(r => ms(r.cold))), warmMs: median(runs.map(r => ms(r.warm))),
        coldBytes: median(runs.map(r => r.coldBytes)), warmBytes: median(runs.map(r => r.warmBytes)), runs }
      console.log('point', f.key, label, JSON.stringify(row.values), JSON.stringify(row.nearValues), Math.round(row.coldMs), Math.round(row.warmMs), row.coldBytes, row.warmBytes)
      out.push(row)
    }
    // today's flower hook: titiler /cog/point
    const times = []
    let body
    for (let r = 0; r < REPS; r++) {
      const t0 = performance.now()
      const res = await fetch(`${TITILER}/cog/point/${lon},${lat}?url=${encodeURIComponent(f.s3)}`)
      body = await res.json(); times.push(performance.now() - t0)
    }
    out.push({ file: f.key, method: 'titiler /cog/point (Node fetch)', lonlat: [lon, lat], values: body.values, coldMs: median(times), runs: times })
    console.log('point', f.key, 'titiler', JSON.stringify(body.values), times.map(Math.round))
  }
  writeFileSync('results/points.json', JSON.stringify(out, null, 1))
}

async function shots() {
  const vp = { width: 640, height: 400 }
  const shoot = async (name, o) => {
    const { ctx, page } = await fresh(vp)
    const res = await page.evaluate(o => window.spike.draw(o), o)
    if (o.hist) await page.evaluate(h => window.spike.showHist(...h), o.hist)
    await page.screenshot({ path: `shots/${name}.png` })
    console.log('shot', name, JSON.stringify(res.tilejson?.bounds), res.errors)
    await ctx.close()
  }
  const gdal = JSON.parse(readFileSync('results/gdal_stats.json', 'utf8'))
  for (const f of FILES) {
    const b = gdal.files[f.name]['4326'].bands[0].overviews.at(-1)?.histogram ?? gdal.files[f.name]['4326'].bands[0].full.histogram
    const hist = [`${f.key} band 1: legend histogram (32 buckets)`, b.buckets, b.min, b.max]
    await shoot(`${f.key}_3857_world`, { url: LOCAL + f.name, ...f.draw, ...VIEWS.world(f), hist })
    await shoot(`${f.key}_3857_z8`, { url: LOCAL + f.name, ...f.draw, ...VIEWS.z8(f) })
    await shoot(`${f.key}_4326_world`, { url: f.s3, ...f.draw, ...VIEWS.world(f) })
  }
  // where the 4326 file lands: degrees read as metres, so the world sits within ±0.0016° of 0,0
  await shoot('score_risk_4326_nullisland_z16', { url: FILES[0].s3, ...FILES[0].draw, center: [0, 0], zoom: 16 })
}

const what = process.argv[2] ?? 'all'
if (what === 'draw' || what === 'all') await drawRuns()
if (what === 'stats' || what === 'all') await statsRuns()
if (what === 'points' || what === 'all') await pointRuns()
if (what === 'shots' || what === 'all') await shots()
await browser.close()
