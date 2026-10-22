// static server with range support: dist/bench at /, the obis-h3 res-5 all file at /data/res5.parquet.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

export const DATA = process.env.RES5 ?? "/Volumes/msens_big/_big/obis/obis-h3/v20261012/all/res=5/data_0.parquet";
const ROOT = new URL("./dist/bench/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".parquet": "application/octet-stream", ".map": "application/json" };

export function serve(port = 5181) {
  const srv = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path === "/data/res5.parquet" ? DATA : join(ROOT, normalize(path === "/" ? "/index.html" : path));
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    const size = statSync(file).size;
    const head = { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes", "access-control-allow-origin": "*", "access-control-expose-headers": "content-length, content-range, accept-ranges", "cache-control": "no-store" };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (m) {
      const start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
      const end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") res.end(); else createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, "content-length": size });
    if (req.method === "HEAD") res.end(); else createReadStream(file).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, () => ok(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) serve().then(() => console.log("http://localhost:5181"));
