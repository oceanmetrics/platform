// the app's vite config, as the package README asks: worker chunks named .mjs (MapLibre 6's importScriptInWorkers
// import()s a module only when its url ends in .mjs). the size entries (size-*.html) are the per-provider bundles.
// dedupe: the package is linked with file:, so its own imports of pmtiles would resolve from the platform checkout's
// node_modules (a second copy) without it; a published install has one copy anyway.
import { defineConfig } from 'vite'
import { readdirSync } from 'node:fs'

// SIZE=<name> builds size-<name>.html alone into dist-size-<name>/ (scripts/bundle.mjs: one app per provider set)
const SIZE = process.env.SIZE
const pages = SIZE ? [`size-${SIZE}.html`] : readdirSync('.').filter((f) => f.endsWith('.html'))
export default defineConfig({
  base: './',
  publicDir: false,
  resolve: { dedupe: ['pmtiles', 'maplibre-gl'] },
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].mjs', chunkFileNames: 'assets/[name]-[hash].mjs' } } },
  build: {
    target: 'es2022', outDir: SIZE ? `dist-size-${SIZE}` : 'dist', emptyOutDir: true, manifest: true, chunkSizeWarningLimit: 4000,
    rollupOptions: { input: Object.fromEntries(pages.map((f) => [f.replace(/\.html$/, ''), f])) },
  },
})
