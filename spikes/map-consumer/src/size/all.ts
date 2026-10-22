// size entry: base + the three providers
import { addProtocol, importScriptInWorkers, Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import h3WorkerUrl from '@oceanmetrics/map/h3-worker?worker&url'
import { baseStyle, carrySlots, cogSlot, composeStyle, formatLayerKey, gridSlot, h3Slot, parseLayerKey, seaSurfaceId, setupMapLibre, slotBeforeId } from '@oceanmetrics/map'
await setupMapLibre({ maplibre: { addProtocol, importScriptInWorkers, setWorkerUrl }, workerUrl, h3WorkerUrl })
const style = composeStyle(await baseStyle('light'), { theme: 'light' })
;(window as any).__m = { map: new MapLibreMap({ container: 'map', style }), parseLayerKey, formatLayerKey, slotBeforeId, seaSurfaceId, carrySlots, gridSlot, cogSlot, h3Slot }
