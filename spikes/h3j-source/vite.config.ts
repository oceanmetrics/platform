// one build per variant (VARIANT=a|b|c|zero) so each dist holds only that variant's dependencies
import { defineConfig } from "vite";
const v = process.env.VARIANT ?? "a";
export default defineConfig({
  base: "./",
  publicDir: false,
  // the worker module is import()ed by MapLibre only when its name ends in .mjs (importScriptInWorkers)
  worker: { format: "es", rollupOptions: { output: { entryFileNames: "assets/[name]-[hash].mjs", chunkFileNames: "assets/[name]-[hash].mjs" } } },
  build: { target: "es2022", outDir: `dist-${v}`, emptyOutDir: true, rollupOptions: { input: `${v}.html` }, chunkSizeWarningLimit: 4000 },
});
