// URL shape, the format rung and the csvp parse, offline. (erddap-places' live PacIOOS fetches stay in that repo: no
// network here.)
import { describe, expect, it } from 'vitest'
import { AXIS_TIMEOUT_MS, SLICE_TIMEOUT_MS, constraint, griddapSliceUrl, griddapUrl, griddapUrls, noonZ, parseCsvp, pickFormat } from './erddap.js'

const BASE = 'https://pae-paha.pacioos.hawaii.edu/erddap'

describe('griddapUrl', () => {
  it('encodes only the constraint brackets and honours a descending latitude axis', () => {
    const url = griddapUrl({
      base: BASE + '/', datasetId: 'dhw_5km', variable: 'CRW_SST',
      time: ['2026-08-01T12:00:00Z', '2026-08-30T12:00:00Z'],
      lat: [18.8, 22.4], lon: [-160.3, -154.5], latDescending: true,
    })
    expect(url).toBe(
      BASE + '/griddap/dhw_5km.parquet?CRW_SST' +
      '%5B(2026-08-01T12:00:00Z):1:(2026-08-30T12:00:00Z)%5D' +
      '%5B(22.4):1:(18.8)%5D' +
      '%5B(-160.3):1:(-154.5)%5D')
  })
  it('puts an ascending latitude axis the other way round', () => {
    const url = griddapUrl({ base: BASE, datasetId: 'd', variable: 'v', time: ['a', 'b'], lat: [1, 2], lon: [3, 4], latDescending: false })
    expect(url).toContain('%5B(1):1:(2)%5D%5B(3):1:(4)%5D')
  })
  it('slices a single depth level between time and latitude on a 4-D grid', () => {
    const url = griddapUrl({ base: BASE, datasetId: 'd', variable: 'chl', time: ['a', 'b'], lat: [1, 2], lon: [3, 4], latDescending: false, depth: 0.4940254 })
    expect(url).toBe(BASE + '/griddap/d.parquet?chl%5B(a):1:(b)%5D%5B(0.4940254):1:(0.4940254)%5D%5B(1):1:(2)%5D%5B(3):1:(4)%5D')
  })
  it('adds no depth constraint to a 3-D grid', () => {
    const url = griddapUrl({ base: BASE, datasetId: 'd', variable: 'v', time: ['a', 'b'], lat: [1, 2], lon: [3, 4], latDescending: false })
    expect(url.match(/%5B/g)).toHaveLength(3)
  })
  it('appends the jsonp callback and uses .json', () => {
    const url = griddapUrl({ base: BASE, datasetId: 'd', variable: 'v', time: ['a', 'b'], lat: [1, 2], lon: [3, 4], format: 'jsonp', callback: 'cb1' })
    expect(url).toContain('/griddap/d.json?')
    expect(url.endsWith('&.jsonp=cb1')).toBe(true)
  })
  it('gives one URL per lobe', () => {
    const u = griddapUrls({ base: BASE, datasetId: 'd', variable: 'v', time: ['a', 'b'] },
                          [[-180, 20, -175, 30], [175, 20, 180, 30]])
    expect(u).toHaveLength(2)
    expect(u[0]).toContain('(-180):1:(-175)')
    expect(u[1]).toContain('(175):1:(180)')
  })
  it('griddapSliceUrl asks for ONE time step and keeps the rest of the request', () => {
    const at = '2026-10-06T12:00:00Z'
    const url = griddapSliceUrl({ base: BASE + '/', datasetId: 'dhw_5km', variable: 'CRW_SST', at,
      lat: [18.8, 22.4], lon: [-160.3, -154.5], latDescending: true, format: 'parquetWMeta' })
    expect(url).toBe(BASE + '/griddap/dhw_5km.parquetWMeta?CRW_SST' +
      '%5B(2026-10-06T12:00:00Z):1:(2026-10-06T12:00:00Z)%5D%5B(22.4):1:(18.8)%5D%5B(-160.3):1:(-154.5)%5D')
    // a depth level still sits between time and latitude, and a jsonp rung still gets its callback
    expect(griddapSliceUrl({ base: BASE, datasetId: 'd', variable: 'chl', at: 'T', lat: [1, 2], lon: [3, 4], latDescending: false, depth: 0.49 }))
      .toBe(BASE + '/griddap/d.parquet?chl%5B(T):1:(T)%5D%5B(0.49):1:(0.49)%5D%5B(1):1:(2)%5D%5B(3):1:(4)%5D')
    expect(griddapSliceUrl({ base: BASE, datasetId: 'd', variable: 'v', at: 'T', lat: [1, 2], lon: [3, 4], format: 'jsonp', callback: 'cb0' }).endsWith('&.jsonp=cb0')).toBe(true)
  })
  it('constraint() and noonZ()', () => {
    expect(constraint(1, 2)).toBe('%5B(1):1:(2)%5D')
    expect(noonZ('2026-09-10')).toBe('2026-09-10T12:00:00Z')
    expect(noonZ(new Date('2026-09-10T03:00:00Z'))).toBe('2026-09-10T12:00:00Z')
  })
})

describe('timeouts outlast a busy server (regression, 2026-10-20)', () => {
  // PacIOOS was up but slow: dhw_5km latitude axes in 13–19 s and 45 days of one pixel in 27–31 s, so a 15 s axis
  // timeout failed every live run ("pae-paha.pacioos.hawaii.edu did not answer (no response within 15 s, 2 tries)")
  it('waits at least 30 s for an axis request and for the map slice', () => {
    expect(AXIS_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000)
    expect(SLICE_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000)
  })
})

describe('pickFormat: the fallback rung', () => {
  it('parquet when the server advertises it', () => {
    expect(pickFormat({ erddap: { cors: true, formats: ['.parquet', '.csvp', '.json'] } })).toBe('parquet')
  })
  it('csvp for an older CORS server', () => {
    expect(pickFormat({ erddap: { cors: true, formats: ['.csvp', '.json'] } })).toBe('csvp')
  })
  it('jsonp when CORS is off, whatever the formats', () => {
    expect(pickFormat({ erddap: { cors: false, formats: ['.parquet'] } })).toBe('jsonp')
  })
})

describe('parseCsvp', () => {
  it('strips the units suffix and numbers the values', () => {
    const rows = parseCsvp('time (UTC),latitude (degrees_north),CRW_SST (degree_C)\n2026-08-01T12:00:00Z,21.375,26.1\n')
    expect(rows[0]).toEqual({ time: '2026-08-01T12:00:00Z', latitude: 21.375, CRW_SST: 26.1 })
  })
})
