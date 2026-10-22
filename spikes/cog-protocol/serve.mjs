// a static file server with Range and CORS, for the local EPSG:3857 copies (Vite's dev server
// ignores Range). usage: node serve.mjs <dir> [port=8787]
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, normalize } from 'node:path'

const [dir, port = '8787'] = process.argv.slice(2)
createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(dir, path)
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  let size
  try { size = statSync(file).size } catch { res.writeHead(404, cors); return res.end() }
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (m) {
    const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
    res.writeHead(206, { ...cors, 'Content-Type': 'image/tiff', 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...cors, 'Content-Type': 'image/tiff', 'Accept-Ranges': 'bytes', 'Content-Length': size })
  createReadStream(file).pipe(res)
}).listen(+port, () => console.log(`serving ${dir} on ${port}`))
