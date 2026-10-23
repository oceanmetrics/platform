// the indicators readers: one test per rule, on the synthetic fixtures in fixtures/indicators/ (no network: fetch is faked)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_COVERAGE_COLUMNS, COVERAGE_COLUMNS, loadCoverage, loadManifest } from './indicators.js'
import type { IndicatorsManifest } from './indicators.js'

const fx = (name: string) => new URL(`../fixtures/indicators/${name}`, import.meta.url)
const MANIFEST = JSON.parse(readFileSync(fx('indicators.json'), 'utf8')) as IndicatorsManifest
const PARQUET = readFileSync(fx('coverage.parquet'))

/** a fetch that serves the fixtures under `base` and 404s anything else; it records the urls asked for */
function fakeFetch(base = 'https://x.test/ind/') {
  const asked: string[] = []
  const f = (async (input: unknown) => {
    const url = String(input)
    asked.push(url)
    if (url === base + 'indicators.json') return new Response(JSON.stringify(MANIFEST), { status: 200 })
    if (url === base + 'coverage.parquet') return new Response(new Uint8Array(PARQUET), { status: 200 })
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  return { f, asked }
}

describe('loadManifest', () => {
  it('reads indicators.json under the base, adding the trailing slash', async () => {
    const { f, asked } = fakeFetch()
    const m = await loadManifest('https://x.test/ind', f)
    expect([m.version, m.contract, m.indicators.length, m.place_sets?.[0].id]).toEqual(['2026.10.22', '1.2.0', 8, 'sanctuaries'])
    expect(asked).toEqual(['https://x.test/ind/indicators.json'])
  })

  it('says which file failed, and where', async () => {
    const { f } = fakeFetch()
    await expect(loadManifest('https://other.test/', f)).rejects.toThrow('indicators.json: HTTP 404 at https://other.test/')
    await expect(loadCoverage('https://other.test/', { fetch: f })).rejects.toThrow('coverage.parquet: HTTP 404 at https://other.test/')
  })
})

describe('loadCoverage', () => {
  it('projects to the card columns by default: the sparkline and the place name are not decoded', async () => {
    const rows = await loadCoverage('https://x.test/ind/', { fetch: fakeFetch().f })
    expect(rows).toHaveLength(13)
    expect(Object.keys(rows[0]).sort()).toEqual([...COVERAGE_COLUMNS].sort())
    expect(rows[0]).toMatchObject({ place_id: 'NMS:A', indicator: 'erddap:sst', time_grain: 'year', n_periods: 30, last_value: 15.6605, status: 'within', trend: 'flat' })
  })

  it('an int64 column comes back as a plain number', async () => {
    const rows = await loadCoverage('https://x.test/ind/', { fetch: fakeFetch().f })
    expect(rows.map((r) => typeof r.n_periods)).toEqual(Array(13).fill('number'))
    expect(rows[1].n_periods).toBe(360)
  })

  it('reads the columns asked for, and only those', async () => {
    const rows = await loadCoverage('https://x.test/ind/', { fetch: fakeFetch().f, columns: ['place_id', 'place_name', 'spark'] })
    expect(rows[0]).toEqual({ place_id: 'NMS:A', place_name: 'A', spark: '[]' })
  })

  it('keeps one place, reading place_id even when the columns leave it out', async () => {
    const rows = await loadCoverage('https://x.test/ind/', { fetch: fakeFetch().f, placeId: 'MRGID:1' })
    expect(rows.map((r) => `${r.indicator}/${r.time_grain}`)).toEqual([
      'obis:species/year', 'obis:species/all', 'obis:es50/year', 'obis:density:fish/year', 'obis:density:fish/decade', 'sdg:mpa/year',
    ])
    const names = await loadCoverage('https://x.test/ind/', { fetch: fakeFetch().f, placeId: 'NMS:EMPTY', columns: ['place_name'] })
    expect(names).toEqual([{ place_id: 'NMS:EMPTY', place_name: 'Empty' }])
  })

  it('ALL_COVERAGE_COLUMNS holds the card columns', () => {
    expect(COVERAGE_COLUMNS.every((c) => (ALL_COVERAGE_COLUMNS as readonly string[]).includes(c))).toBe(true)
    expect(ALL_COVERAGE_COLUMNS).toHaveLength(26)
  })
})
