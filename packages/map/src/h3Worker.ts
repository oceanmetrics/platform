// the h3 protocols inside MapLibre's worker, so the main thread only draws (spike 1 condition 1: no dropped frames,
// where the main-thread form dropped 17 to 21 at world zoom):
//   - `h3j://<encoded archive url>/{z}/{x}/{y}` (h3.ts h3TileUrl) reads a PMTiles archive of single-value h3j tiles
//     with range requests;
//   - `h3r://<encoded release layer>/{z}/{x}/{y}` (h3ReleaseLayer.ts releaseTileUrl) reads the obis-h3 release's own
//     Parquet (h3Parquet.ts): the row groups under the tile's parents, every indicator column carried. one reader per
//     worker, so its row-group cache serves every release layer, period and slot of the page.
// both build the hexagons and encode the MVT here (h3Tiles.ts). loaded by setupMapLibre({ h3WorkerUrl }) with
// importScriptInWorkers; a Vite app imports it as `@oceanmetrics/map/h3-worker?worker&url` with worker chunks named .mjs
// (MapLibre 6 import()s only those). this module registers the protocols when it loads: the one side effect in the
// package (package.json `sideEffects`).
import type { AddProtocolAction } from 'maplibre-gl'
import { PMTiles } from 'pmtiles'
import { parseH3TileUrl } from './h3.js'
import { ReleaseReader, releaseProvider } from './h3Parquet.js'
import { H3R_SCHEME, parseReleaseTileUrl, releaseKeyOf } from './h3ReleaseLayer.js'
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

/** the worker's one release reader (its stats and cache), for a page that asks */
export const releaseReader = new ReleaseReader()
const releaseActions = new Map<string, AddProtocolAction>()

scope.addProtocol(H3R_SCHEME, (params, abort) => {
  const key = releaseKeyOf(params.url)
  if (!key) return Promise.reject(new Error(`h3r: not a release tile url: ${params.url}`))
  let action = releaseActions.get(key)
  if (!action) releaseActions.set(key, (action = h3jAction(releaseProvider(parseReleaseTileUrl(params.url)!, releaseReader))))
  return action(params, abort)
})
