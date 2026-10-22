// size entry: the base as the 0.2.0 README wrote it, the namespace object passed to setupMapLibre (it keeps every
// export of maplibre-gl: about 11 kB gzip more than the named form, size-base)
import * as maplibre from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { baseStyle, carrySlots, composeStyle, formatLayerKey, parseLayerKey, seaSurfaceId, setupMapLibre, slotBeforeId } from '@oceanmetrics/map'
await setupMapLibre({ maplibre, workerUrl })
const style = composeStyle(await baseStyle('light'), { theme: 'light' })
;(window as any).__m = { map: new maplibre.Map({ container: 'map', style }), parseLayerKey, formatLayerKey, slotBeforeId, seaSurfaceId, carrySlots }
