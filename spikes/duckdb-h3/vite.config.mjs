import { defineConfig } from "vite";
export default defineConfig({
  build: { target: "es2022", outDir: "dist/bench", assetsInlineLimit: 0 },
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
});
