// vite build of a page importing only cellToParent, cellToBoundary, latLngToCell, and of the full h3-js;
// gzip -9 and brotli of the emitted js, plus the h3 extension wasm as served and re-compressed.
import { build } from "vite";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { join } from "node:path";

const out = {};
const sizes = (buf) => ({ raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length });
for (const name of ["h3-min", "h3-full"]) {
  const dir = `dist/size/${name}`;
  await build({
    logLevel: "warn", configFile: false,
    build: { target: "es2022", outDir: dir, emptyOutDir: true, minify: true, rollupOptions: { input: `size/${name}.js`, preserveEntrySignatures: "strict" } },
  });
  const files = readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".js"));
  const buf = Buffer.concat(files.map((f) => readFileSync(join(dir, "assets", f))));
  out[name] = { files, ...sizes(buf) };
}
// the extension, as the browser receives it and re-compressed
const url = process.env.H3_EXT_URL ?? "https://community-extensions.duckdb.org/v1.4.3/wasm_eh/h3.duckdb_extension.wasm";
const res = await fetch(url, { headers: { "accept-encoding": "identity" } });
const wasm = Buffer.from(await res.arrayBuffer());
const br = await fetch(url, { headers: { "accept-encoding": "br" } });
out.h3_extension = { url, served_content_encoding_br: br.headers.get("content-encoding"), served_content_length_br: Number(br.headers.get("content-length")), ...sizes(wasm) };
mkdirSync("results", { recursive: true });
writeFileSync("results/size.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
