// size entry: base + gridSlot
import { addProtocol, importScriptInWorkers, Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { baseStyle, carrySlots, composeStyle, formatLayerKey, gridSlot, parseLayerKey, seaSurfaceId, setupMapLibre, slotBeforeId } from '@oceanmetrics/map'
await setupMapLibre({ maplibre: { addProtocol, importScriptInWorkers, setWorkerUrl }, workerUrl })
const style = composeStyle(await baseStyle('light'), { theme: 'light' })
;(window as any).__m = { map: new MapLibreMap({ container: 'map', style }), parseLayerKey, formatLayerKey, slotBeforeId, seaSurfaceId, carrySlots, gridSlot }
