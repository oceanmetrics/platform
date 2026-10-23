// what one tile of the release provider costs in Node: requests, bytes read, row groups read and skipped, cells, MVT
// bytes and milliseconds, cold (an empty worker cache) and warm (the same reader, the next tile). reads the built
// package (npm run build first). run from the repo root:
//   node packages/map/fixtures/h3release/measure.mjs                      # the synthetic fixture beside this file
//   node packages/map/fixtures/h3release/measure.mjs <dir> <layer.json>   # another release folder, e.g. a sorted copy
//   node packages/map/fixtures/h3release/measure.mjs https://s3.../v20261012/ <layer.json>   # over HTTP
//   node packages/map/fixtures/h3release/measure.mjs https://s3.../obis-h3/collection.json      # a live collection, layer all
// a layer.json is { "template": "all/res={res}/data_0.parquet", "ladder": [...], "parentTemplate"?, "parentRes"? }
// relative to the folder; the tiles measured are California at z4 and z9, Fiji at z6 on the seam, every z4 tile, and
// the Monterey Bay view at z9 (res 7): every 512 px tile a 1280 x 800 map centred on -122.1, 36.75 asks, one reader
// (the atlas's docs/obis-layer.md case; obis-hex read 7 res-3 parent partitions for it).
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { h3jAction, lonLatToTile, ReleaseReader, releaseLayer, releaseProvider } from '../../dist/index.js'

const HERE = new URL('./', import.meta.url)
const src = process.argv[2] ?? HERE.pathname
const http = /^https?:/.test(src)
const live = http && /collection\.json$/.test(src)
const BASE = http ? src : 'https://release.test/'
const root = http ? null : new URL(src.endsWith('/') ? `file://${src}` : `file://${src}/`)

const fsFetch = async (url, init) => {
  const path = decodeURIComponent(url.slice(BASE.length))
  let buf
  try { buf = readFileSync(new URL(path, root)) } catch { return new Response('', { status: 403 }) }
  const range = new Headers(init?.headers).get('Range') ?? ''
  let a = 0, b = buf.length - 1
  const sfx = /^bytes=-(\d+)$/.exec(range), span = /^bytes=(\d+)-(\d+)$/.exec(range)
  if (sfx) a = Math.max(0, buf.length - Number(sfx[1]))
  else if (span) [a, b] = [Number(span[1]), Math.min(buf.length - 1, Number(span[2]))]
  return new Response(new Uint8Array(buf.subarray(a, b + 1)), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${buf.length}` } })
}
const fetch = http ? globalThis.fetch : fsFetch

let layer
if (live) {
  layer = releaseLayer(await (await globalThis.fetch(src)).json(), { keys: { layer: 'all' } })
} else if (process.argv[3]) {
  const l = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  layer = { pin: null, id: 'cell_id', idType: 'int64', columns: ['n', 'sp', 'shannon', 'simpson', 'es'], ...l,
    template: new URL(l.template, BASE).href.replace(/%7B(res|parent)%7D/gi, '{$1}'),
    ...(l.parentTemplate ? { parentTemplate: new URL(l.parentTemplate, BASE).href.replace(/%7B(res|parent)%7D/gi, '{$1}') } : {}) }
} else {
  layer = releaseLayer(JSON.parse(readFileSync(new URL('collection.json', HERE), 'utf8')), { base: BASE, keys: { layer: 'all' } })
}

async function tile(reader, z, x, y) {
  const before = { ...reader.stats, read: reader.groupsRead, skipped: reader.groupsSkipped }
  const t0 = performance.now()
  const cells = await releaseProvider(layer, reader)(z, x, y, new AbortController().signal)
  const t1 = performance.now()
  const mvt = cells ? (await h3jAction(async () => cells)({ url: `h3r://k/${z}/${x}/${y}` }, new AbortController())).data.byteLength : 0
  const t2 = performance.now()
  return { z, x, y, requests: reader.stats.requests - before.requests, bytes: reader.stats.bytes - before.bytes,
    groupsRead: reader.groupsRead - before.read, groupsSkipped: reader.groupsSkipped - before.skipped,
    cells: cells?.h3.length ?? 0, mvtBytes: mvt, readMs: +(t1 - t0).toFixed(1), buildMs: +(t2 - t1).toFixed(1) }
}

const out = { source: http ? src : src.replace(process.env.HOME ?? '~', '~'), layer: live ? layer.template : layer.template.slice(BASE.length) }
for (const [name, lon, lat, z] of [['california z4', -121, 34, 4], ['fiji z6', 178, -17.5, 6], ['california z9', -121, 34, 9]]) {
  const [x, y] = lonLatToTile(lon, lat, z)
  const reader = new ReleaseReader({ fetch })
  const cold = await tile(reader, z, x, y)
  const warm = await tile(reader, z, (x + 1) % 2 ** z, y)
  out[name] = { cold, nextTileWarm: warm }
}
// the Monterey Bay view at z9: the tiles of a 1280 x 800 map (512 px tiles), the files and bytes they read together
{
  const [lon, lat, z, W, H] = [-122.1, 36.75, 9, 1280, 800]
  const size = 512 * 2 ** z, r = (lat * Math.PI) / 180
  const px = ((lon + 180) / 360) * size, py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size
  const tiles = []
  for (let x = Math.floor((px - W / 2) / 512); x <= Math.floor((px + W / 2 - 1) / 512); x++)
    for (let y = Math.floor((py - H / 2) / 512); y <= Math.floor((py + H / 2 - 1) / 512); y++) tiles.push([x, y])
  const urls = new Set()
  const counting = async (url, init) => { urls.add(String(url)); return fetch(url, init) }
  const reader = new ReleaseReader({ fetch: counting })
  const t0 = performance.now()
  const got = await Promise.all(tiles.map(([x, y]) => tile(reader, z, x, y)))
  out['monterey z9 view (res 7)'] = {
    tiles: tiles.length, files: urls.size, requests: reader.stats.requests, bytes: reader.stats.bytes, missing: reader.stats.missing,
    groupsRead: reader.groupsRead, cells: got.reduce((a, t) => a + t.cells, 0), ms: +(performance.now() - t0).toFixed(1),
  }
}
// every z4 tile, one reader (the cache warm after the first): the mean and the worst
const reader = new ReleaseReader({ fetch })
const all = []
for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) all.push(await tile(reader, 4, x, y))
const ms = all.map((t) => t.readMs + t.buildMs).sort((a, b) => a - b)
out['all 256 z4 tiles'] = {
  requests: reader.stats.requests, bytes: reader.stats.bytes, groupsRead: reader.groupsRead,
  msMean: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1), msP95: ms[Math.floor(ms.length * 0.95)], msMax: ms[ms.length - 1],
  cellsMax: Math.max(...all.map((t) => t.cells)),
}
console.log(JSON.stringify(out, null, 1))
