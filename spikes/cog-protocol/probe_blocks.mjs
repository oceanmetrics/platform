// the 3857 world-view window of score_risk.tif: is the read time network (requests in series) or
// decoding? local without and with the S3-like network, 16 kB and 64 kB blocks. -> results/blocks.json
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome' })
const out = []
for (const net of [null, { offline: false, latency: 130, downloadThroughput: 5.1e6, uploadThroughput: 5.1e6 }])
  for (const bs of [16384, 65536]) for (let r = 0; r < 3; r++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await page.goto('http://localhost:5199/'); await page.evaluate(() => window.spikeReady)
    const view = await page.evaluate(() => window.spike.jump([0, 20], 1.3))
    if (net) await cdp.send('Network.emulateNetworkConditions', net)
    const s = await page.evaluate(([b, v]) => { window.spike.setBlockSize(b); return window.spike.viewStats('http://localhost:8787/3857/score_risk.tif', v.bounds, v.width, { band: 1 }) }, [bs, view])
    out.push({ net: net ? 'S3-like' : 'local', blockSize: bs, requests: s.requests, bytes: s.bytes, ms: s.ms })
    console.log(net ? 'S3-like' : 'local', bs, s.requests, s.bytes, JSON.stringify(Object.fromEntries(Object.entries(s.ms).map(([k, v]) => [k, Math.round(v)]))))
    await ctx.close()
  }
writeFileSync('results/blocks.json', JSON.stringify(out, null, 1))
await browser.close()
