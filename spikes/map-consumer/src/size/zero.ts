// size entry: maplibre-gl alone, as an app has it before the package (the floor the others are measured from)
import * as maplibre from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
maplibre.setWorkerUrl(workerUrl)
;(window as any).__m = new maplibre.Map({ container: 'map', style: { version: 8, sources: {}, layers: [] } })
