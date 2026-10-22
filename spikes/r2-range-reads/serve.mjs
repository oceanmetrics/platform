// static server for dist/ on localhost: the page origin that makes real cross-origin requests to the worker and S3.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("./dist/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".map": "application/json" };

export function serve(port = 5190) {
  const srv = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(ROOT, normalize(path === "/" ? "/index.html" : path));
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, () => ok(srv)));
}
if (import.meta.url === `file://${process.argv[1]}`) serve().then(() => console.log("http://localhost:5190"));
