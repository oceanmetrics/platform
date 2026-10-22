// size entry: maplibre-gl and the pmtiles protocol, no package (what an app pays for pmtiles:// on its own)
import * as maplibre from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
maplibre.setWorkerUrl(workerUrl)
const p = new Protocol()
maplibre.addProtocol('pmtiles', p.tile)
;(window as any).__m = new maplibre.Map({ container: 'map', style: { version: 8, sources: {}, layers: [] } })
