// the spike's static server: /<variant>/ serves dist-<variant>/ with public/ beside it, gzip (level 6, cached)
// for text as a CDN or S3 with stored Content-Encoding would, HTTP Range (uncompressed) for .pmtiles
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".pmtiles": "application/octet-stream", ".png": "image/png" };
const gz = new Map();
export function serve(port = 5180) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/([a-z0-9-]+)\/(.*)$/.exec(normalize(decodeURIComponent(url.pathname)));
    if (!m) { res.statusCode = 404; return res.end(); }
    const [, v, rel] = m;
    const file = [join(ROOT, `dist-${v}`, rel || `${v}.html`), join(ROOT, "public", rel)].find((f) => existsSync(f) && statSync(f).isFile());
    if (!file) { res.statusCode = 404; return res.end(); }
    const ext = extname(file);
    res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    if (ext === ".pmtiles") {
      const size = statSync(file).size;
      res.setHeader("Accept-Ranges", "bytes");
      const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      if (!r) { res.setHeader("Content-Length", size); return createReadStream(file).pipe(res); }
      const start = Number(r[1]), end = r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      return createReadStream(file, { start, end }).pipe(res);
    }
    if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(file), { level: 6 }));
    const body = gz.get(file);
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", body.length);
    res.end(body);
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
if (import.meta.url === `file://${process.argv[1]}`) serve().then(() => console.log("http://localhost:5180/<a|b|c|zero>/"));
