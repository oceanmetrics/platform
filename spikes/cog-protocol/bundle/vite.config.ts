// an app build (minified, as the atlas would ship it) of bundle/entry.ts; maplibre-gl external
import { defineConfig } from 'vite'
export default defineConfig({
  build: { outDir: '../dist-bundle', emptyOutDir: true, rolldownOptions: { external: ['maplibre-gl'] } },
})
