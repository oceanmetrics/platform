// the h3j protocol inside MapLibre's worker: `h3j://<encoded archive url>/{z}/{x}/{y}` (h3.ts h3TileUrl) reads a PMTiles
// archive of h3j tiles with range requests from the worker, builds the hexagons and encodes the MVT there, so the main
// thread only draws (spike 1 condition 1: no dropped frames, where the main-thread form dropped 17 to 21 at world zoom).
// loaded by setupMapLibre({ h3WorkerUrl }) with importScriptInWorkers; a Vite app imports it as
// `@oceanmetrics/map/h3-worker?worker&url` with worker chunks named .mjs (MapLibre 6 import()s only those). this module
// registers the protocol when it loads: the one side effect in the package (package.json `sideEffects`).
import type { AddProtocolAction } from 'maplibre-gl'
import { PMTiles } from 'pmtiles'
import { parseH3TileUrl } from './h3.js'
import { h3jAction, pmtilesProvider } from './h3Tiles.js'
import { H3J_SCHEME } from './maplibre.js'

const scope = self as unknown as { addProtocol(scheme: string, action: AddProtocolAction): void }
const actions = new Map<string, AddProtocolAction>()

scope.addProtocol(H3J_SCHEME, (params, abort) => {
  const url = parseH3TileUrl(params.url)
  if (!url) return Promise.reject(new Error(`h3j: not an h3j tile url: ${params.url}`))
  let action = actions.get(url)
  if (!action) actions.set(url, (action = h3jAction(pmtilesProvider(new PMTiles(url)))))
  return action(params, abort)
})
