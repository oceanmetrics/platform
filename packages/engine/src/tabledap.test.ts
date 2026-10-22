// the tabledap path: the URL builder (ERDDAP 2.30 on erddap.calcofi.io) and the point mask.
import { describe, expect, it } from 'vitest'
import { pickFormat, tabledapPlaceConstraints, tabledapUrl, tableConstraint } from './erddap.js'
import { pointMask } from './mask.js'
import { statsTemplate, toDataset, toLongFormat, valueExpr } from './dataset.js'
import type { FeatureCollection } from 'geojson'

const BASE = 'https://erddap.calcofi.io/erddap'
const COLS = ['longitude', 'latitude', 'time', 'depth', 'measurement_type', 'measurement_value']

describe('tableConstraint', () => {
  it('encodes only the comparison characters, leaving = and the value literal', () => {
    expect(tableConstraint({ column: 'time', op: '>=', value: '2015-01-01T00:00:00Z' }))
      .toBe('time%3E=2015-01-01T00:00:00Z')
    expect(tableConstraint({ column: 'longitude', op: '<=', value: -119 })).toBe('longitude%3C=-119')
    expect(tableConstraint({ column: 'latitude', op: '>', value: 33.5 })).toBe('latitude%3E33.5')
    expect(tableConstraint({ column: 'measurement_type', op: '=', value: '%22temperature%22' }))
      .toBe('measurement_type=%22temperature%22')
  })
})

describe('tabledapUrl', () => {
  it('builds the verified CalCOFI request: %2C between columns, one &constraint each', () => {
    const url = tabledapUrl({
      base: BASE + '/', datasetId: 'calcofi_bottle', columns: COLS,
      constraints: tabledapPlaceConstraints({ bbox: [-121, 33.5, -119, 34.5], from: '2015-01-01', to: '2016-01-01' }),
    })
    expect(url).toBe(
      'https://erddap.calcofi.io/erddap/tabledap/calcofi_bottle.parquetWMeta' +
      '?longitude%2Clatitude%2Ctime%2Cdepth%2Cmeasurement_type%2Cmeasurement_value' +
      '&time%3E=2015-01-01T00:00:00Z&time%3C=2016-01-01T23:59:59Z' +
      '&longitude%3E=-121&longitude%3C=-119' +
      '&latitude%3E=33.5&latitude%3C=34.5')
    // no bare comma, and the brackets/encoding of the griddap path never leak in here
    expect(url).not.toContain(',')
    expect(url).not.toContain('%5B')
  })

  it('adds the long-format row filter, quoted with %22', () => {
    const url = tabledapUrl({
      base: BASE, datasetId: 'calcofi_bottle', columns: COLS,
      constraints: tabledapPlaceConstraints({
        bbox: [-121, 33.5, -119, 34.5], from: '2015-01-01', to: '2016-01-01',
        typeColumn: 'measurement_type', typeValue: 'temperature',
      }),
    })
    expect(url.endsWith('&measurement_type=%22temperature%22')).toBe(true)
  })

  it('appends server-side functions after the constraints', () => {
    const url = tabledapUrl({
      base: BASE, datasetId: 'calcofi_bottle', columns: ['time'],
      functions: ['orderByMinMax(%22time%22)'], format: 'csvp',
    })
    expect(url).toBe(`${BASE}/tabledap/calcofi_bottle.csvp?time&orderByMinMax(%22time%22)`)
  })

  it('falls back to jsonp with a callback, like the griddap builder', () => {
    const url = tabledapUrl({ base: BASE, datasetId: 'x', columns: ['time'], format: 'jsonp', callback: 'cb0' })
    expect(url).toBe(`${BASE}/tabledap/x.json?time&.jsonp=cb0`)
  })
})

describe('the tabledap collection', () => {
  const COLLECTION = {
    id: 'erddap/calcofi_bottle',
    'erddap:base_url': BASE,
    'erddap:dataset_id': 'calcofi_bottle',
    'erddap:protocol': 'tabledap',
    'erddap:version': '2.30',
    'erddap:cors': true,
    'erddap:formats': ['parquetWMeta', 'parquet', 'csvp', 'json'],
    'erddap-places:long_format': { type_column: 'measurement_type', value_column: 'measurement_value' },
    'cube:variables': { temperature: { type: 'data', unit: 'degC', description: 'water temperature' } },
  }

  it('reads the protocol, the long-format columns and the parquetWMeta rung', () => {
    const ds = toDataset(COLLECTION)
    expect(ds.protocol).toBe('tabledap')
    expect(ds.longFormat).toEqual({ typeColumn: 'measurement_type', valueColumn: 'measurement_value' })
    expect(ds.format).toBe('parquetWMeta')
    expect(pickFormat({ erddap: { cors: true, formats: ['parquetWMeta', 'parquet'] } })).toBe('parquetWMeta')
  })
  it('summarises a tabledap run by month, whatever the variable', () => {
    expect(statsTemplate({ categorical: false }, 'tabledap')).toBe('stats_tabledap')
    expect(statsTemplate({ categorical: true }, 'tabledap')).toBe('stats_tabledap')
    expect(statsTemplate({ categorical: false }, 'griddap')).toBe('stats_daily')
  })
  it('reads a long-format variable out of the value column, not a column of its own name', () => {
    const ds = toDataset(COLLECTION)
    expect(valueExpr(ds.variables[0], 's', ds.longFormat)).toBe('s."measurement_value"')
    expect(valueExpr(ds.variables[0], 's')).toBe('s."temperature"')
  })
  it('ignores a malformed long_format block', () => {
    expect(toLongFormat({ type_column: 'x' })).toBeUndefined()
    expect(toLongFormat(undefined)).toBeUndefined()
  })
})

describe('pointMask', () => {
  // a unit square with a bite out of it, as two polygon parts
  const PLACE: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
        coordinates: [[[-121, 33.5], [-120, 33.5], [-120, 34.5], [-121, 34.5], [-121, 33.5]]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
        coordinates: [[[-119.5, 34], [-119, 34], [-119, 34.4], [-119.5, 34.4], [-119.5, 34]]] } },
    ],
  }

  it('keeps the positions inside any part and drops the rest', () => {
    const out = pointMask(PLACE, [
      { lon: -120.5, lat: 34.0 },    // in part 1
      { lon: -119.2, lat: 34.2 },    // in part 2
      { lon: -119.8, lat: 34.2 },    // between the parts: out
      { lon: -100.0, lat: 34.0 },    // far away: out
    ])
    expect(out.cells.map((c) => [c.lon, c.lat])).toEqual([[-120.5, 34], [-119.2, 34.2]])
    expect(out.nInside).toBe(2)
  })
  it('gives every kept position weight 1 — a sample is in or out, never partly in', () => {
    const out = pointMask(PLACE, [{ lon: -120.5, lat: 34 }])
    expect(out.cells[0].weight).toBe(1)
  })
  it('collapses the repeats of one station (many casts, many depths)', () => {
    const rep = Array.from({ length: 50 }, () => ({ lon: -120.5, lat: 34.0 }))
    const out = pointMask(PLACE, [...rep, { lon: -120.6, lat: 34.1 }])
    expect(out.nCandidates).toBe(2)
    expect(out.cells).toHaveLength(2)
  })
  it('skips non-finite coordinates', () => {
    expect(pointMask(PLACE, [{ lon: NaN, lat: 34 }, { lon: -120.5, lat: 34 }]).cells).toHaveLength(1)
  })
})
