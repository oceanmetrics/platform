// bundle sizes, gzip -9 (zlib level 9) of the minified JS:
// 1. each variant's dist (built by `VARIANT=<v> vite build`) against the map-only baseline `zero`: the JS the
//    page loads on the main thread (entry + its chunks, deck's lazy chunks included since it loads them at
//    start) and the worker modules (MapLibre's own, the same in every variant, and h3jWorker for BW and CW);
// 2. each dependency group alone (a Vite library build of scripts/deps/<group>.ts with everything bundled),
//    to attribute the delta: deck (the four @deck.gl packages as obis-hex imports them), h3-js,
//    @maplibre/geojson-vt + @maplibre/vt-pbf, pmtiles, and the port itself with its deps.
import { build } from "vite";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const gz = (f) => gzipSync(readFileSync(f), { level: 9 }).length;
const kb = (n) => +(n / 1024).toFixed(1);
const out = { variants: {}, deps: {} };
for (const v of ["zero", "a", "b", "c", "bw", "cw"]) {
  const dir = `dist-${v}/assets`;
  const files = readdirSync(dir).filter((f) => /\.(m?js)$/.test(f));
  const main = files.filter((f) => f.endsWith(".js")), workers = files.filter((f) => f.endsWith(".mjs"));
  const sum = (fs) => fs.reduce((s, f) => s + gz(`${dir}/${f}`), 0);
  out.variants[v] = { mainGzKB: kb(sum(main)), workerGzKB: kb(sum(workers)), files: Object.fromEntries(files.map((f) => [f, kb(gz(`${dir}/${f}`))])) };
}
for (const v of Object.keys(out.variants)) {
  const z = out.variants.zero, x = out.variants[v];
  x.deltaMainKB = +(x.mainGzKB - z.mainGzKB).toFixed(1);
  x.deltaWorkerKB = +(x.workerGzKB - z.workerGzKB).toFixed(1);
}
mkdirSync("dist-deps", { recursive: true });
for (const g of ["deck", "h3", "vt", "pmtiles", "port"]) {
  await build({
    configFile: false, logLevel: "error",
    build: { outDir: `dist-deps/${g}`, emptyOutDir: true, minify: true, target: "es2022",
      lib: { entry: `scripts/deps/${g}.ts`, formats: ["es"], fileName: g },
      rollupOptions: { external: [/^maplibre-gl/], output: { inlineDynamicImports: true } } },
  });
  const f = readdirSync(`dist-deps/${g}`).filter((x) => /\.m?js$/.test(x)).map((x) => `dist-deps/${g}/${x}`);
  out.deps[g] = kb(f.reduce((s, x) => s + gz(x), 0));
}
writeFileSync("results/bundle.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ variants: Object.fromEntries(Object.entries(out.variants).map(([k, v]) => [k, { main: v.mainGzKB, worker: v.workerGzKB, dMain: v.deltaMainKB, dWorker: v.deltaWorkerKB }])), deps: out.deps }, null, 1));
