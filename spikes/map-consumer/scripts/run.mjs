// the consumer checklist (packages/map README, "What a consumer verifies in step 2") run on the built page with
// Playwright on the system Chrome (channel 'chrome', headless, as spikes 1 and 3), at 1280x800 and 390x844, DPR 1.
// every point records pass/fail, its numbers and a screenshot (shots/<point>-<width>.jpg); results/run.json holds the
// raw numbers, results/table.md the table checklist.md quotes. usage: npm run build && node scripts/run.mjs
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { serve } from './serve.mjs'

const PORT = 5210
const URL0 = `http://localhost:${PORT}/`
const WIDTHS = (process.env.WIDTHS ?? '1280,390').split(',').map(Number)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
mkdirSync('shots', { recursive: true })
mkdirSync('results', { recursive: true })

const server = await serve(PORT)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] })
const out = { when: new Date().toISOString(), chrome: browser.version(), widths: WIDTHS, points: {} }
const rows = []

// the page build's cog protocol chunk (the dynamic import setupMapLibre's cog:// action makes)
const MANIFEST = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
const COG_CHUNK = MANIFEST[Object.keys(MANIFEST).find((k) => /maplibre-cog-protocol/.test(k))].file
const isCogChunk = (url) => url.endsWith(COG_CHUNK)
const near = (a, b, tol = 3) => [0, 1, 2].every((k) => Math.abs(a[k] - b[k]) <= tol)
const differs = (a, b, tol = 8) => [0, 1, 2].some((k) => Math.abs(a[k] - b[k]) > tol)
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d

async function newPage(width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 800 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const log = { pageErrors: [], requests: [], t0: Date.now() }
  page.on('pageerror', (e) => log.pageErrors.push(e.message))
  page.on('request', (r) => log.requests.push({ url: r.url(), t: Date.now() - log.t0 }))
  if (opts.cdp) {
    // which thread made each request: the page's Network domain, and each worker's (attached before it runs)
    const cdp = await ctx.newCDPSession(page)
    log.byTarget = []
    await cdp.send('Network.enable')
    cdp.on('Network.requestWillBeSent', (e) => log.byTarget.push({ target: 'page', url: e.request.url }))
    const workers = new Map()
    let id = 1
    const send = (sessionId, method, params = {}) => cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: id++, method, params }) }).catch(() => {})
    cdp.on('Target.attachedToTarget', async (e) => {
      if (e.targetInfo.type !== 'worker') return
      workers.set(e.sessionId, e.targetInfo.url)
      await send(e.sessionId, 'Network.enable')
      await send(e.sessionId, 'Runtime.runIfWaitingForDebugger')
    })
    cdp.on('Target.receivedMessageFromTarget', (e) => {
      const m = JSON.parse(e.message)
      if (m.method === 'Network.requestWillBeSent') log.byTarget.push({ target: 'worker', worker: workers.get(e.sessionId), url: m.params.request.url })
    })
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false })
    log.workers = workers
  }
  await page.goto(URL0)
  await page.waitForFunction(() => window.__ready)
  const ev = (f, a) => page.evaluate(f, a)
  const shot = async (name) => { const p = `shots/${name}-${width}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality: 70 }); return p }
  return { ctx, page, ev, shot, log }
}

function record(point, width, check, pass, number, shot) {
  rows.push({ point, width, check, pass, number, shot })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${point} @${width} ${check}: ${number}${shot ? ` (${shot})` : ''}`)
}
const want = (p) => !ONLY || ONLY.includes(p)

/** the seam test: columns 3 px west, on, and 3 px east of the 180° meridian, against the same columns unmounted.
 * a row "straddles" when both side columns are coloured by the layer with one colour (one cell or hexagon across the
 * seam); a gap is a straddling row whose seam pixel is not that colour. no gap = 0 such rows */
async function seamGap(ev, lat0, lat1, mountFn) {
  const cols = () => ev((a) => [-3, 0, 3].map((dx) => window.__c.column(180, a[0], a[1], dx)), [lat0, lat1])
  const base = await cols()
  await mountFn()
  const got = await cols()
  let straddle = 0, gap = 0, covered = 0
  for (let i = 0; i < got[1].length; i++) {
    const [w, c, e] = [got[0][i], got[1][i], got[2][i]]
    if (differs(c, base[1][i])) covered++
    if (differs(w, base[0][i]) && differs(e, base[2][i]) && near(w, e, 6)) { straddle++; if (!near(c, w, 6)) gap++ }
  }
  return { rows: got[1].length, covered, straddle, gap }
}

const GULF = (w) => ({ center: w < 500 ? [-89.5, 24] : [-89.5, 24], zoom: w < 500 ? 3.4 : 4.4 })

for (const W of WIDTHS) {
  // ---- 1: setup, a vector feature, h3 from the worker ----
  if (want('1')) {
    const { ctx, ev, shot, log } = await newPage(W, { cdp: true })
    const b = await ev((v) => window.__c.boot(v), { ...GULF(W) })
    const part = (await ev(() => window.__c.pixels([[-77.5, 25.5]])))[0]
    const partColor = await ev(() => window.__c.partColor)
    const water = await ev(() => window.__c.rendered(['water']))
    const s1 = await shot('p1-setup-part')
    record('1', W, 'vector part renders after setupMapLibre (GeoJSON parsed in the worker)', near(part, partColor), `pixel ${part.slice(0, 3)} vs ${partColor}; CARTO water features drawn ${water}`, s1)
    await ev((z) => window.__c.jump([180, -17], z), W < 500 ? 4 : 5)
    const h = await ev(() => window.__c.mountH3('archive'))
    const r = await ev(() => window.__c.h3Res())
    const s2 = await shot('p1-h3-worker-fiji')
    const pm = log.byTarget.filter((x) => /es5\.pmtiles/.test(x.url))
    const w3 = log.byTarget.filter((x) => /h3Worker-.*\.mjs/.test(x.url))
    const main = b.mainProtocols
    const pass = r.features > 0 && !main.includes('h3j') && pm.some((x) => x.target === 'worker') && w3.length > 0
    out.points[`1@${W}`] = { boot: b, h3: { source: h.source, res: r }, pmtilesRequests: { page: pm.filter((x) => x.target === 'page').length, worker: pm.filter((x) => x.target === 'worker').length }, h3WorkerModule: w3, workers: [...log.workers.values()], pageErrors: log.pageErrors }
    record('1', W, 'h3 tiles from the worker: no h3j protocol on the main thread, archive reads in the worker', pass,
      `main-thread protocols [${main}]; ${r.features} hexagons drawn; es5.pmtiles requests page ${pm.filter((x) => x.target === 'page').length} / worker ${pm.filter((x) => x.target === 'worker').length}; h3Worker module requested by ${[...new Set(w3.map((x) => x.target))]}`, s2)
    await ctx.close()
  }

  // ---- 2: composeStyle on CARTO's real styles, tiers 404; the stack; the theme flip ----
  if (want('2')) {
    if (W === WIDTHS[0]) {
      // the boot stall: the composed style (tiers unreachable) given to the constructor, load watched for 6 s
      const stall = []
      for (let i = 0; i < 4; i++) {
        const { ctx, ev } = await newPage(W)
        stall.push(await ev((v) => window.__c.boot(v), { ...GULF(W), direct: true, waitMs: 6000, part: false }).then((x) => ({ loadMs: x.loadMs && round(x.loadMs, 0), unnudged: x.loadUnnudged })))
        await ctx.close()
      }
      out.points.stall = stall
      record('2', W, '`load` with the composed style at construction and every tier failing (MapLibre schedules no frame on a failed source)', true,
        `load without a repaint nudge in ${stall.filter((x) => x.unnudged).length} of ${stall.length} boots (${stall.map((x) => x.loadMs).join(', ')} ms); the README flow (boot dem: false, setStyle on load) never stalled`, null)
    }
    const { ctx, ev, shot, log } = await newPage(W)
    const b = await ev((v) => window.__c.boot(v), { ...GULF(W), part: false })
    const ids = b.ids
    const at = (id) => ids.indexOf(id)
    const firstSymbol = (await ev(() => window.__c.style().layers.findIndex((l) => l.type === 'symbol' && !l.id.startsWith('gebco-'))))
    const order = ['background', 'water', 'gebco-far-relief', 'gebco-relief', 'gebco-contour-3', 'land', 'water-inland', 'landcover']
    const stack = order.every((id, i) => i === 0 || at(id) > at(order[i - 1])) && at('landcover') < firstSymbol
    const waterColor = await ev(() => window.__c.style().layers.find((l) => l.id === 'water').paint['fill-color'])
    const sea = (await ev(() => window.__c.pixels([[-90.5, 25.2]])))[0]
    const drawn = await ev(() => window.__c.rendered(['water', 'boundary_country_outline', 'landuse']))
    const tierErrors = (await ev(() => window.__c.errors())).length
    const s1 = await shot('p2-positron-tiers-404')
    out.points[`2@${W}`] = { ids, stack, waterColor, sea, drawn, tierErrors }
    record('2', W, 'positron composed, tiers 404: base and land layers draw, stack order', stack && drawn > 0 && near(sea, [212, 218, 220]),
      `${ids.length} layers; ${order.join(' < ')} < first symbol: ${stack}; CARTO features drawn ${drawn}; sea pixel ${sea.slice(0, 3)} (water ${waterColor}); ${tierErrors} tier errors`, s1)
    // the flip with a mounted slot, under the land mask (no parts: the atlas case)
    const g = await ev(() => window.__c.mountGrid('gulf'))
    const cell = (await ev(() => window.__c.lattice('gulf'))).find((c) => !c.hole && c.i === 8 && c.j === 6)
    const before = await ev((c) => [window.__c.pixels([[c.lon, c.lat]])[0], window.__c.expectedGrid(c, '2024-01')], cell)
    const s2 = await shot('p2-slot-light')
    const f = await ev(() => window.__c.flip('dark'))
    const after = (await ev((c) => window.__c.pixels([[c.lon, c.lat]]), cell))[0]
    const slotIds = (xs) => xs.filter((x) => x.startsWith('slot:'))
    const kept = slotIds(f.after).length === 1 && f.after.indexOf('slot:grid:fill') === f.after.indexOf('land') - 1
    const s3 = await shot('p2-flip-dark-carrySlots')
    const dark = await ev(() => window.__c.style().layers.map((l) => l.id).filter((id) => !id.startsWith('slot:')))
    record('2', W, 'theme flip setStyle(composeStyle(dark), { diff: true, transformStyle: carrySlots }) keeps the slot; the slot under the land mask shows over the open sea (water-inland fix)', kept && near(after, before[1]),
      `slot ids before [${slotIds(f.before)}] after [${slotIds(f.after)}], under ${f.after[f.after.indexOf('slot:grid:fill') + 1]}; cell pixel light ${before[0].slice(0, 3)} dark ${after.slice(0, 3)} (expected ${before[1]}); basemap ids the same set across themes: ${JSON.stringify([...dark].sort()) === JSON.stringify([...ids].sort())} (order differs: ${JSON.stringify(dark) !== JSON.stringify(ids)})`, s3)
    const f2 = await ev(() => window.__c.flip('light', { keep: false }))
    const s4 = await shot('p2-flip-light-diff-only')
    record('2', W, 'regression evidence: the 0.2.0 README flip (diff alone) drops the slot', slotIds(f2.after).length === 0,
      `diff alone: slot ids before [${slotIds(f2.before)}] after [${slotIds(f2.after)}] (MapLibre's diff removes every layer the next style does not name)`, s4)
    out.points[`2flip@${W}`] = { grid: g.beforeId, flip: { before: slotIds(f.before), after: slotIds(f.after) }, diffOnly: slotIds(f2.after), pageErrors: log.pageErrors }
    await ctx.close()
  }

  // ---- 3: the grid ----
  if (want('3')) {
    const { ctx, ev, shot, page } = await newPage(W)
    await ev((v) => window.__c.boot(v), { ...GULF(W), part: false })
    const cells = await ev(() => window.__c.lattice('gulf'))
    const d = W < 500 ? 0.3 : 0.35
    const ptsOf = (c) => [[c.lon, c.lat], [c.lon - d, c.lat - d], [c.lon + d, c.lat - d], [c.lon - d, c.lat + d], [c.lon + d, c.lat + d]]
    const inView = await ev((cs) => cs.map((c) => { const m = window.__map, p = m.project([c.lon, c.lat]), cv = m.getCanvas(); return p.x > 8 && p.y > 8 && p.x < cv.clientWidth - 8 && p.y < cv.clientHeight - 8 }), cells)
    const test = cells.filter((c, i) => inView[i])
    const all = test.flatMap(ptsOf)
    const base = await ev((p) => window.__c.pixels(p), all)
    const g = await ev(() => window.__c.mountGrid('gulf', '2024-01'))
    const got = await ev((p) => window.__c.pixels(p), all)
    let ok = 0, n = 0, holeOk = 0, holes = 0
    const bad = []
    for (let k = 0; k < test.length; k++) {
      const c = test[k]
      if (c.hole) { holes++; if (!differs(got[k * 5], base[k * 5], 2)) holeOk++; else bad.push(`hole ${c.lon},${c.lat}`); continue }
      const e = await ev((x) => window.__c.expectedGrid(x, '2024-01'), c)
      for (let q = 0; q < 5; q++) { n++; if (near(got[k * 5 + q], e)) ok++; else bad.push(`${c.lon},${c.lat}#${q} ${got[k * 5 + q].slice(0, 3)}≠${e}`) }
    }
    const s1 = await shot('p3-grid-gulf-t1')
    record('3', W, 'squares on the lattice: cell centre and ±0.35° inside each cell = the ramp stop of its value', ok / n >= 0.95,
      `${ok}/${n} points (${round((100 * ok) / n, 1)}%) on ${test.length - holes} cells; misses: ${bad.filter((x) => !x.startsWith('hole')).slice(0, 6).join('; ') || 'none'}`, s1)
    record('3', W, 'holes transparent: a null cell shows the basemap pixel underneath', holeOk === holes, `${holeOk}/${holes} hole centres equal the unmounted pixel`, s1)
    // update(t): every frame shows either t1's or t2's colours at eight cells
    const sample = test.filter((c) => !c.hole && c.i >= 3 && c.i <= 13 && c.j >= 3 && c.j <= 8).slice(0, 8)
    const flash = await ev(async (cs) => {
      const c = window.__c
      const pts = cs.map((x) => [x.lon, x.lat])
      const e1 = cs.map((x) => c.expectedGrid(x, '2024-01')), e2 = cs.map((x) => c.expectedGrid(x, '2024-02'))
      const near = (a, b) => [0, 1, 2].every((k) => Math.abs(a[k] - b[k]) <= 3)
      const frames = await c.sampleDuring(() => c.update('2024-02'), pts, 1500)
      const kinds = frames.map((f) => f.map((px, i) => (near(px, e1[i]) ? '1' : near(px, e2[i]) ? '2' : 'x')).join(''))
      return { frames: frames.length, mixed: kinds.filter((k) => /x/.test(k) || (k.includes('1') && k.includes('2'))).length, switchAt: kinds.findIndex((k) => k === '2'.repeat(cs.length)), last: kinds[kinds.length - 1] }
    }, sample)
    await ev(() => window.__c.idle())
    const a = await page.screenshot({ type: 'png' })
    await new Promise((r) => setTimeout(r, 50))
    const b2 = await page.screenshot({ type: 'png' })
    const s2 = await shot('p3-grid-gulf-t2')
    record('3', W, 'update(t) without a flash: every frame t1 or t2 at 8 cells, then two screenshots 50 ms apart identical', flash.mixed === 0 && flash.last === '2'.repeat(sample.length) && a.equals(b2),
      `${flash.frames} frames sampled, ${flash.mixed} mixed or blank, all-t2 from frame ${flash.switchAt}; screenshots identical: ${a.equals(b2)}`, s2)
    // the lattice across ±180 (PMNM)
    await ev((w) => window.__c.jump([180, 25], w < 500 ? 3.4 : 4.4), W)
    const pc = await ev(() => window.__c.lattice('pmnm'))
    const sg = await seamGap(ev, 20.6, 29.4, () => ev(() => window.__c.mountGrid('pmnm', '2024-01')))
    const seamCells = pc.filter((c) => !c.hole && (c.lon === 179.5 || c.lon === -179.5))
    const seamPx = await ev((cs) => window.__c.pixels(cs.map((c) => [c.lon < 0 ? c.lon + 360 : c.lon, c.lat])), seamCells)
    let sok = 0
    for (let k = 0; k < seamCells.length; k++) if (near(seamPx[k], await ev((x) => window.__c.expectedGrid(x, '2024-01'), seamCells[k]))) sok++
    const s3 = await shot('p3-grid-pmnm-180')
    record('3', W, 'grid across ±180 (PMNM lattice 170.5°E..170.5°W): cells either side of the seam in place, no gap', sok === seamCells.length && sg.gap === 0 && sg.covered > 0,
      `${sok}/${seamCells.length} cells at 179.5°E/179.5°W (read at 180.5°) on their colour; seam column: ${sg.covered}/${sg.rows} rows coloured, ${sg.gap} gap rows`, s3)
    const seam = { sok, of: seamCells.length, ...sg }
    out.points[`3@${W}`] = { beforeId: g.beforeId, ok, n, holes, holeOk, bad: bad.slice(0, 20), flash, seam }
    await ctx.close()
  }

  // ---- 4: the cog ----
  if (want('4')) {
    const { ctx, ev, shot, log } = await newPage(W)
    const pts = JSON.parse(readFileSync('data/cogs/points.json', 'utf8'))
    const view = W < 500 ? { center: [30, 20], zoom: 0.3 } : { center: [0, 0], zoom: 1 }
    await ev((v) => window.__c.boot(v), { ...view, part: false })
    const lazyBefore = log.requests.filter((r) => isCogChunk(r.url)).length
    const stripes = [[-135, 0], [-45, 33], [45, 66], [135, 100]].map(([lon, v]) => ({ lon, lat: 10, v }))
    const P = [pts.inside.lonlat, pts.outside.lonlat, ...stripes.map((s) => [s.lon, s.lat]), [-135, -70], [45, -70]]
    const visible = await ev((ps) => ps.map((p) => { const m = window.__map, q = m.project(p), cv = m.getCanvas(); return q.x >= 2 && q.y >= 2 && q.x < cv.clientWidth - 2 && q.y < cv.clientHeight - 2 }), P)
    const base = await ev((p) => window.__c.pixels(p), P)
    const tMount = Date.now() - log.t0
    const am = await ev(() => window.__c.mountCog('am'))
    const lazy = log.requests.filter((r) => isCogChunk(r.url))
    const px = await ev((p) => window.__c.pixels(p), P)
    const eIn = await ev((v) => window.__c.expectedCog('am', v), pts.inside.value)
    const s1 = await shot('p4-cog-am-native')
    record('4', W, 'COG (AquaMaps native, 3857 copy) in place: inside the range coloured, outside transparent', visible[0] && visible[1] && near(px[0], eIn) && !differs(px[1], base[1], 2),
      `inside ${pts.inside.lonlat.map((x) => round(x))} (value ${pts.inside.value}) ${px[0].slice(0, 3)} vs ramp ${eIn}; outside ${pts.outside.lonlat.map((x) => round(x))} (nodata) ${px[1].slice(0, 3)} = basemap ${base[1].slice(0, 3)}; legend ${am.legend?.stats?.mean} mean from STAC`, s1)
    record('4', W, 'COG protocol lazy: its chunk arrives on the first cog:// request, not at setup', lazyBefore === 0 && lazy.length >= 1 && lazy[0].t >= tMount,
      `cog protocol chunk requests before mount ${lazyBefore}, after ${lazy.length} (${lazy.map((r) => r.url.split('/').pop()).join(', ')}, at +${lazy[0] ? lazy[0].t - tMount : '-'} ms after mount)`, s1)
    const two = await ev(() => window.__c.mountCog('two'))
    const px2 = await ev((p) => window.__c.pixels(p), P)
    let sOk = 0, sN = 0
    const stripeLog = []
    for (let k = 0; k < stripes.length; k++) {
      if (!visible[2 + k]) continue
      sN++
      const e = await ev((v) => window.__c.expectedCog('two', v), stripes[k].v)
      if (near(px2[2 + k], e)) sOk++
      stripeLog.push(`${stripes[k].lon}°: ${px2[2 + k].slice(0, 3)} vs ${e}`)
    }
    const band1 = await ev(() => window.__c.expectedCog('two', 10))
    const ndOk = [6, 7].filter((k) => visible[k]).every((k) => !differs(px2[k], base[k], 2))
    const s2 = await shot('p4-cog-two-band-bidx2')
    record('4', W, 'atlas:bidx 2 draws band 2 (four stripes 0/33/66/100), not band 1 (10 everywhere); nodata 255 transparent', sOk === sN && sN > 0 && ndOk && !stripeLog.some((s) => s.includes(`${band1}`)),
      `${sOk}/${sN} stripes on band 2's colour (${stripeLog.join('; ')}); band 1 would paint ${band1}; nodata rows at 70°S = basemap: ${ndOk}`, s2)
    const ref = await ev(() => window.__c.mountCog('am4326'))
    record('4', W, 'a 4326 asset is refused with CogProjectionError naming the asset', ref.error === 'CogProjectionError' && /am4326/.test(ref.message), `${ref.error}: ${ref.message}`, null)
    out.points[`4@${W}`] = { am: { legend: am.legend, beforeId: am.beforeId }, two: { beforeId: two.beforeId }, px: px.map((p) => p.slice(0, 3)), px2: px2.map((p) => p.slice(0, 3)), base: base.map((p) => p.slice(0, 3)), visible, refused: ref, lazy, tMount, pageErrors: log.pageErrors }
    await ctx.close()
  }

  // ---- 5: the hexagons ----
  if (want('5')) {
    const { ctx, ev, shot, log } = await newPage(W)
    await ev((v) => window.__c.boot(v), { center: [180, -17], zoom: 5, part: false })
    const res = {}
    const seam = {}
    const VIEWS = { fiji: { center: [180, -17], zoom: W < 500 ? 4 : 5, lat: [-21, -13] }, pmnm: { center: [180, 26], zoom: W < 500 ? 3.5 : 4.5, lat: [20, 31] } }
    for (const form of ['archive', 'memory', 'relative']) {
      for (const [name, v] of Object.entries(VIEWS)) {
        if (form === 'relative' && name === 'pmnm') continue
        await ev(() => window.__c.unmount())
        await ev((x) => window.__c.jump(x.center, x.zoom), v)
        let m = null
        const sg = await seamGap(ev, v.lat[0], v.lat[1], async () => { m = await ev((f) => window.__c.mountH3(f), form) })
        const feats = (await ev(() => window.__c.h3Res())).features
        const s = await shot(`p5-h3-${form}-${name}`)
        seam[`${form}/${name}`] = { ...sg, feats, problem: m?.legend?.problem ?? null }
        record('5', W, `h3 ${form} at ${name}, centred on ±180: no gap at the seam`, feats > 0 && sg.straddle > 0 && sg.gap === 0,
          `${feats} hexagons; seam column ${sg.covered}/${sg.rows} rows coloured, ${sg.straddle} rows with one hexagon across the seam, ${sg.gap} gap rows`, s)
      }
      if (form === 'relative') continue
      await ev(() => window.__c.jump([180, 0], 1))
      const r1 = await ev(() => window.__c.h3Res())
      await ev(() => window.__c.jump([178.4, -17.8], 7))
      const r7 = await ev(() => window.__c.h3Res())
      const s = await shot(`p5-h3-${form}-z7`)
      res[form] = { z1: r1, z7: r7 }
      record('5', W, `RES_FOR_ZOOM (${form}): zoom 1 draws res 1, zoom 7 res 5`, Object.keys(r1.res).join() === '1' && Object.keys(r7.res).join() === '5',
        `z1: ${JSON.stringify(r1.res)} (tile z${r1.tileZoom}); z7: ${JSON.stringify(r7.res)}`, s)
    }
    // frame time during the scripted 5 s pan at Fiji (spike 1's path), both forms
    const frames = {}
    for (const form of ['archive', 'memory']) {
      await ev((f) => window.__c.mountH3(f), form)
      frames[form] = await ev(() => window.__c.run('fiji', 5000))
      record('5', W, `frame time p95 during a 5 s pan at Fiji (${form})`, frames[form].p95Ms <= 17,
        `p95 ${round(frames[form].p95Ms)} ms, mean ${round(frames[form].meanMs)}, max ${round(frames[form].maxMs, 1)}, ${frames[form].frames} frames (display interval ${round(frames[form].interval)} ms)`, null)
    }
    out.points[`5@${W}`] = { res, seam, frames, timeouts: await ev(() => window.__c.timeouts()), pageErrors: log.pageErrors }
    await ctx.close()
  }
}

// ---- 6: the bundle (scripts/bundle.mjs measured it) ----
if (want('6')) {
  const b = JSON.parse(readFileSync('results/bundle.json', 'utf8'))
  const p = b.package
  record('6', 0, 'eager gzip per provider over base (expected about 4 kB)', p['grid over base'] < 5000 && p['cogSlot over base'] < 5000 && p['h3 over base'] < 5000,
    `grid +${p['grid over base']} B, cogSlot +${p['cogSlot over base']} B (+${p['cogSlot + pointValue + overviewHistogram over base']} B with pointValue and overviewHistogram: geotiff's core), h3 +${p['h3 over base']} B; all three +${p['all three over base']} B; base +${p['base over maplibre-gl + pmtiles']} B over maplibre-gl and pmtiles`, null)
  record('6', 0, 'the COG protocol lazy, the h3 worker chunk about 76 kB', !!b.cogProtocol && Math.abs(b.workers['h3Worker.mjs'] - 76400) < 8000,
    `cog protocol on demand ${b.cogProtocol?.gzip} B; h3Worker.mjs ${b.workers['h3Worker.mjs']} B; maplibre-gl-worker.mjs ${b.workers['maplibre-gl-worker.mjs']} B`, null)
  record('6', 0, 'the README snippet passes the namespace object (keeps every maplibre-gl export)', true, `+${p['namespace import over named (the 0.2.0 README snippet)']} B gzip over named imports`, null)
}

out.rows = rows
const prev = (() => { try { return JSON.parse(readFileSync('results/run.json', 'utf8')) } catch { return null } })()
const merged = ONLY && prev ? { ...prev, ...out, points: { ...prev.points, ...out.points }, rows: [...prev.rows.filter((r) => !ONLY.includes(r.point)), ...rows] } : out
merged.rows.sort((a, b) => a.point.localeCompare(b.point) || b.width - a.width)
writeFileSync('results/run.json', JSON.stringify(merged, null, 1))
const md = ['| point | width | check | pass | number | shot |', '|---|--:|---|---|---|---|',
  ...merged.rows.map((r) => `| ${r.point} | ${r.width || '-'} | ${r.check} | ${r.pass ? 'pass' : '**FAIL**'} | ${String(r.number).replace(/\|/g, '/')} | ${r.shot ? `[${r.shot.replace('shots/', '')}](../${r.shot})` : '-'} |`)]
writeFileSync('results/table.md', md.join('\n') + '\n')
await browser.close()
server.close()
