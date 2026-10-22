// the check's static server: dist/ at /, data/ at /data/, every file with HTTP Range (pmtiles, COGs) and no caching.
// a CDN serves the same bytes; Vite's own preview server is not used because the COG and PMTiles reads need Range.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.tif': 'image/tiff' }
export function serve(port = 5210) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = path.startsWith('/data/') ? join(ROOT, path) : join(ROOT, 'dist', path === '/' ? 'index.html' : path)
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end() }
    const size = statSync(file).size
    const head = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' }
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
    if (m) {
      const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
      return createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, { ...head, 'Content-Length': size })
    createReadStream(file).pipe(res)
  })
  return new Promise((r) => server.listen(port, () => r(server)))
}
if (import.meta.url === `file://${process.argv[1]}`) serve().then(() => console.log('http://localhost:5210/'))
