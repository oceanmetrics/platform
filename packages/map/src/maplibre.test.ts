import { afterEach, describe, expect, it } from 'vitest'
import { h3ModuleUrl, registerProtocol, resetMapLibreSetup, setupMapLibre, workerUrl, WorkerUrlError } from './maplibre.js'
import type { MapLibreModule } from './maplibre.js'

// a stand-in for maplibre-gl that records what setup calls: the package never loads MapLibre in a test
function fakeMapLibre() {
  const calls: string[] = []
  const lib: MapLibreModule = {
    setWorkerUrl: (u) => { calls.push(`setWorkerUrl ${u}`) },
    addProtocol: (s) => { calls.push(`addProtocol ${s}`) },
    importScriptInWorkers: async (u) => { calls.push(`importScriptInWorkers ${u}`) },
  }
  return { lib, calls }
}

const PAGE = 'https://oceanmetrics.io/indicators/'

afterEach(() => resetMapLibreSetup())

describe('worker urls', () => {
  it('a Vite ?worker&url path is made absolute against the page', () => {
    expect(workerUrl('/assets/maplibre-gl-worker-abc.mjs', PAGE)).toBe('https://oceanmetrics.io/assets/maplibre-gl-worker-abc.mjs')
    expect(workerUrl('assets/h3Worker-abc.mjs', PAGE)).toBe('https://oceanmetrics.io/indicators/assets/h3Worker-abc.mjs')
  })
  it('the h3 module must end in .mjs (MapLibre 6 import()s only those): spike 1 condition 1', () => {
    expect(h3ModuleUrl('/assets/h3Worker-abc.mjs', PAGE)).toBe('https://oceanmetrics.io/assets/h3Worker-abc.mjs')
    expect(() => h3ModuleUrl('/assets/h3Worker-abc.js', PAGE)).toThrow(WorkerUrlError)
    expect(() => h3ModuleUrl('/assets/h3Worker-abc.js', PAGE)).toThrow(/ends in \.mjs/)
  })
})

describe('setupMapLibre', () => {
  it('sets the worker url, registers pmtiles and cog, and imports the h3 module into the worker', async () => {
    const { lib, calls } = fakeMapLibre()
    await setupMapLibre({ maplibre: lib, workerUrl: '/assets/maplibre-gl-worker-1.mjs', h3WorkerUrl: '/assets/h3Worker-2.mjs', base: PAGE })
    expect(calls).toEqual([
      'setWorkerUrl /assets/maplibre-gl-worker-1.mjs',
      'addProtocol pmtiles',
      'addProtocol cog',
      'importScriptInWorkers https://oceanmetrics.io/assets/h3Worker-2.mjs',
    ])
  })
  it('a second call registers nothing twice', async () => {
    const { lib, calls } = fakeMapLibre()
    await setupMapLibre({ maplibre: lib, workerUrl: '/w.mjs', protocols: ['pmtiles'] })
    await setupMapLibre({ maplibre: lib, workerUrl: '/w.mjs', protocols: ['pmtiles', 'cog'] })
    registerProtocol('cog', async () => ({ data: new ArrayBuffer(0) }))
    expect(calls).toEqual(['setWorkerUrl /w.mjs', 'addProtocol pmtiles', 'addProtocol cog'])
  })
  it('regression (map 0.2.2): the same module again is a no-op, whether the same object or one rebuilt from the same functions', async () => {
    const { lib, calls } = fakeMapLibre()
    await setupMapLibre({ maplibre: lib, workerUrl: '/w.mjs', protocols: ['pmtiles'] })
    await setupMapLibre({ maplibre: lib, workerUrl: '/w.mjs', protocols: ['pmtiles'] })
    await setupMapLibre({ maplibre: { ...lib }, workerUrl: '/w.mjs', protocols: ['pmtiles', 'cog'] })
    expect(calls).toEqual(['setWorkerUrl /w.mjs', 'addProtocol pmtiles', 'addProtocol cog'])
  })
  it('refuses the h3 protocol without a worker module url, and a second maplibre module', async () => {
    const { lib } = fakeMapLibre()
    await expect(setupMapLibre({ maplibre: lib, workerUrl: '/w.mjs', protocols: ['h3'] })).rejects.toThrow(/needs h3WorkerUrl/)
    await setupMapLibre({ maplibre: lib, workerUrl: '/w.mjs' })
    await expect(setupMapLibre({ maplibre: fakeMapLibre().lib, workerUrl: '/w.mjs' })).rejects.toThrow(/second maplibre-gl module/)
  })
})
