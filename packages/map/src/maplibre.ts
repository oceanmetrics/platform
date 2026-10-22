// MapLibre 6 setup, once per page: the worker url, the pmtiles:// and cog:// protocols on the main thread, and the h3j
// protocol inside MapLibre's worker. the rules, each with a measured failure behind it (atlas docs/spikes/S2.md, obis-hex,
// platform spike 1):
//   - named imports only: maplibre-gl 6 has no default export (a default import is a hard Rolldown MISSING_EXPORT).
//     this module takes the app's `import * as maplibre from 'maplibre-gl'` as an argument, so the package never
//     imports maplibre-gl at run time (its tests run without it, and the app bundles one copy).
//   - the worker url comes from Vite's `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` (plain `?url` emits a worker
//     whose shared chunk 404s: rasters paint and vector tiles silently never parse).
//   - the h3j protocol runs in MapLibre's worker, loaded with `importScriptInWorkers(<absolute url>.mjs)`: MapLibre 6
//     `import()`s a url only when it ends in .mjs, and resolves a relative one against the worker, not the page.
//   - the cog:// protocol (@geomatico/maplibre-cog-protocol) is registered at once but loaded on its first request, so
//     an app that never draws a COG never fetches its code (and plain Node can load this package: the protocol's ESM
//     build has extensionless imports).
import type { AddProtocolAction } from 'maplibre-gl'
import { Protocol } from 'pmtiles'

/** the scheme of the h3j protocol in MapLibre's worker (h3Worker.ts): `h3j://<encoded archive url>/{z}/{x}/{y}` */
export const H3J_SCHEME = 'h3j'
export const COG_SCHEME = 'cog'
export const PMTILES_SCHEME = 'pmtiles'

/** the part of maplibre-gl this module calls: pass the app's `import * as maplibre from 'maplibre-gl'` */
export interface MapLibreModule {
  setWorkerUrl(url: string): void
  addProtocol(scheme: string, action: AddProtocolAction): void
  importScriptInWorkers(url: string): Promise<void>
}

export type ProtocolName = 'pmtiles' | 'cog' | 'h3'

export interface SetupOptions {
  maplibre: MapLibreModule
  /** maplibre-gl's own worker: `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` */
  workerUrl: string
  /** this package's worker module: `import h3WorkerUrl from '@oceanmetrics/map/h3-worker?worker&url'`, emitted as .mjs */
  h3WorkerUrl?: string
  /** the protocols to register; default pmtiles and cog, and h3 when h3WorkerUrl is given */
  protocols?: ProtocolName[]
  /** the page url relative urls resolve against; default location.href */
  base?: string
}

export class WorkerUrlError extends Error {
  constructor(readonly url: string, reason: string) {
    super(`h3 worker url ${url}: ${reason}`)
    this.name = 'WorkerUrlError'
  }
}

/** a worker or worker-module url made absolute against the page (Vite's `?worker&url` gives `/assets/x-<hash>.mjs`) */
export function workerUrl(url: string, base: string | undefined = globalThis.location?.href): string {
  return base ? new URL(url, base).href : new URL(url).href
}

/** the url `importScriptInWorkers` needs for the h3 module: absolute, and ending in .mjs (MapLibre 6 import()s only those) */
export function h3ModuleUrl(url: string, base?: string): string {
  let abs: string
  try {
    abs = workerUrl(url, base)
  } catch {
    throw new WorkerUrlError(url, 'not a url, and no page url to resolve it against')
  }
  if (!new URL(abs).pathname.endsWith('.mjs')) {
    throw new WorkerUrlError(url, 'MapLibre 6 imports a worker module only when its name ends in .mjs (set worker.rollupOptions.output.entryFileNames to "[name]-[hash].mjs" in vite.config)')
  }
  return abs
}

// ---- the protocols ----

let pmtiles: Protocol | null = null
/** the one pmtiles Protocol of the page (an app may `add()` PMTiles instances to it) */
export function pmtilesProtocol(): Protocol {
  return (pmtiles ??= new Protocol())
}

type CogModule = typeof import('@geomatico/maplibre-cog-protocol')
let cogModule: Promise<CogModule> | null = null
/** the COG protocol module, imported on first use (one copy: cog.ts's colour functions go to the same instance) */
export function loadCogProtocol(): Promise<CogModule> {
  return (cogModule ??= import('@geomatico/maplibre-cog-protocol'))
}

/** cog:// registered now, loaded on the first request */
export const lazyCogProtocol: AddProtocolAction = async (params) => (await loadCogProtocol()).cogProtocol(params)

// ---- setup ----

let wired: MapLibreModule | null = null
const registered = new Set<string>()

/** the MapLibre module setupMapLibre was given (an in-memory h3 slot registers its protocol on it); throws before setup */
export function mapLibre(): MapLibreModule {
  if (!wired) throw new Error('@oceanmetrics/map: call setupMapLibre() before drawing a slot')
  return wired
}

/** register a main-thread protocol once per page (MapLibre's registry is global: a second addProtocol replaces the first) */
export function registerProtocol(scheme: string, action: AddProtocolAction): void {
  if (registered.has(scheme)) return
  mapLibre().addProtocol(scheme, action)
  registered.add(scheme)
}

/**
 * once per page, before the first map: the worker url, the protocols on the main thread, and the h3j module in
 * MapLibre's worker (resolves when the worker has imported it). a second call adds only what the first did not.
 */
export async function setupMapLibre(opts: SetupOptions): Promise<void> {
  const lib = opts.maplibre
  if (wired && wired !== lib) throw new Error('@oceanmetrics/map: setupMapLibre() was given a second maplibre-gl module')
  const protocols = opts.protocols ?? (['pmtiles', 'cog', ...(opts.h3WorkerUrl ? ['h3'] : [])] as ProtocolName[])
  if (protocols.includes('h3') && !opts.h3WorkerUrl) throw new WorkerUrlError('', 'the h3 protocol needs h3WorkerUrl')
  const h3Url = opts.h3WorkerUrl && protocols.includes('h3') ? h3ModuleUrl(opts.h3WorkerUrl, opts.base) : null
  if (!wired) {
    lib.setWorkerUrl(opts.workerUrl)
    wired = lib
  }
  if (protocols.includes('pmtiles')) registerProtocol(PMTILES_SCHEME, pmtilesProtocol().tile as unknown as AddProtocolAction)
  if (protocols.includes('cog')) registerProtocol(COG_SCHEME, lazyCogProtocol)
  if (h3Url && !registered.has(`worker:${H3J_SCHEME}`)) {
    await lib.importScriptInWorkers(h3Url)
    registered.add(`worker:${H3J_SCHEME}`)
  }
}

/** forget the setup (tests; an app never needs it) */
export function resetMapLibreSetup(): void {
  wired = null
  registered.clear()
}
