// size entry: base + cogSlot alone (its legend is legendFromStac; geotiff.js comes with pointValue and overviewHistogram)
import { addProtocol, importScriptInWorkers, Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { baseStyle, carrySlots, cogSlot, composeStyle, formatLayerKey, parseLayerKey, seaSurfaceId, setupMapLibre, slotBeforeId } from '@oceanmetrics/map'
await setupMapLibre({ maplibre: { addProtocol, importScriptInWorkers, setWorkerUrl }, workerUrl })
const style = composeStyle(await baseStyle('light'), { theme: 'light' })
;(window as any).__m = { map: new MapLibreMap({ container: 'map', style }), parseLayerKey, formatLayerKey, slotBeforeId, seaSurfaceId, carrySlots, cogSlot }
