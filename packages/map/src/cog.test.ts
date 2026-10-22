import { describe, expect, it } from 'vitest'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import {
  assertWebMercator, bucketCounts, cogColorFunction, CogProjectionError, cogRange, cogSlot, cogUrl, legendFromStac,
  nodataValue, overviewHistogram, pickCogAssets, pointValue,
} from './cog.js'
import type { CogAsset } from './cog.js'

const COG = 'image/tiff; application=geotiff; profile=cloud-optimized'
// the 3857 copy of a synthetic score layer: band 1 statistics and a 4-bucket histogram as publish writes them
const ASSET_3857: CogAsset = {
  href: 'https://storage.oceanmetrics.io/atlas/score_3857.tif', type: COG, roles: ['data'], 'proj:code': 'EPSG:3857',
  'atlas:colormap': 'viridis',
  bands: [{ data_type: 'uint8', nodata: 255, unit: 'score', description: 'risk score',
    statistics: { minimum: 0, maximum: 88, mean: 2.957, stddev: 9.249, valid_percent: 62.69 },
    histogram: { count: 4, min: 0, max: 88, buckets: [900, 60, 30, 10] } }],
}
const ASSET_4326: CogAsset = { ...ASSET_3857, href: 'https://storage.oceanmetrics.io/atlas/score.tif', 'proj:code': 'EPSG:4326' }

// a 4x2 EPSG:4326 GeoTIFF over lon 0..4, lat 0..2 (1 degree pixels), float32, nodata -9999
function tiny4326(values: number[]): ArrayBuffer {
  return writeArrayBuffer(new Float32Array(values), {
    width: 4, height: 2, ModelPixelScale: [1, 1, 0], ModelTiepoint: [0, 0, 0, 0, 2, 0],
    GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1, GDAL_NODATA: '-9999', SampleFormat: [3], BitsPerSample: [32],
  } as never)
}

describe('the 3857 guard (spike 3 condition 3)', () => {
  it('refuses a 4326 asset or one without proj:code, naming the asset', () => {
    expect(() => assertWebMercator(ASSET_3857)).not.toThrow()
    expect(() => assertWebMercator(ASSET_4326, 'score')).toThrow(CogProjectionError)
    expect(() => assertWebMercator(ASSET_4326, 'score')).toThrow('cog asset "score" is EPSG:4326, not EPSG:3857')
    const bare = { href: 'https://x.test/a.tif' }
    expect(() => cogSlot({ kind: 'cog', id: 'a', variable: null }, bare)).toThrow('cog asset "https://x.test/a.tif" is without proj:code')
    expect(() => assertWebMercator(bare, 'a', 'EPSG:3857')).not.toThrow()
  })
  it('picks the 3857 asset to draw and the original for the numbers', () => {
    const p = pickCogAssets({ properties: { 'proj:code': 'EPSG:4326' }, assets: { data: { ...ASSET_4326, 'proj:code': undefined }, data_3857: ASSET_3857, thumb: { href: 't.png', roles: ['thumbnail'] } } })
    expect([p.draw?.key, p.values?.key]).toEqual(['data_3857', 'data'])
    expect(pickCogAssets({ assets: { data: ASSET_4326 } }).draw).toBeNull()
  })
})

describe('the legend from STAC (spike 3 condition 1)', () => {
  it('states STAC\'s statistics and histogram, the ramp over the statistics range', () => {
    expect(legendFromStac(ASSET_3857, { t: '2024-01-01' })).toEqual({
      title: 'risk score', t: '2024-01-01', via: 'COG, EPSG:3857 copy', problem: null, units: 'score',
      ramp: { min: 0, max: 88, colors: ['#440154', '#433a81', '#31688d', '#21908c', '#38b777', '#90d643', '#fde725'] },
      classes: null,
      histogram: { min: 0, max: 88, buckets: [900, 60, 30, 10] },
      stats: { minimum: 0, maximum: 88, mean: 2.957, stddev: 9.249, valid_percent: 62.69 },
    })
  })
  it('atlas:rescale overrides the colour domain, never the stated statistics; raster:bands is read too', () => {
    const a: CogAsset = { ...ASSET_3857, bands: undefined, 'raster:bands': ASSET_3857.bands, 'atlas:rescale': [0, 50] }
    expect(cogRange(a)).toEqual([0, 50])
    const l = legendFromStac(a)
    expect([l.ramp?.min, l.ramp?.max, l.stats?.maximum]).toEqual([0, 50, 88])
    expect(legendFromStac({ href: 'x.tif' }).problem).toBe('no statistics in the STAC asset')
  })
})

describe('the cog url and colour', () => {
  it('cog://<href>#color:[stops],min,max,c with the asset\'s colormap and range', () => {
    expect(cogUrl({ ...ASSET_3857, 'atlas:colormap': 'thermal_r', 'atlas:rescale': [5, 30] })).toBe('cog://https://storage.oceanmetrics.io/atlas/score_3857.tif#color:'
      + '["#e8fa5b","#f7cf45","#fca63c","#f2814d","#d66c6b","#b05f82","#8b538d","#684396","#40349f","#0f326b","#042333"],5,30,c')
  })
  it('the colour function draws the band on the ramp and masks STAC nodata, the file\'s noData and NaN', () => {
    const f = cogColorFunction({ band: 2, min: 0, max: 10, ramp: 'viridis', nodata: nodataValue(255) })
    const px = (a: number, b: number, md = {}) => { const c = new Uint8ClampedArray([9, 9, 9, 9]); f([a, b], c, md); return [...c] }
    expect(px(0, 0)).toEqual([68, 1, 84, 255])
    expect(px(0, 10)).toEqual([253, 231, 37, 255])
    expect(px(0, 255)[3]).toBe(0)
    expect(px(0, NaN)[3]).toBe(0)
    expect(px(0, -1, { noData: -1 })[3]).toBe(0)
    expect(nodataValue('nan')).toBeNaN()
    expect(nodataValue(null)).toBeNull()
  })
})

describe('reads with geotiff.js', () => {
  it('the histogram shape of the smallest overview, bucketed over the STAC range, nodata left out', async () => {
    const tiff = await fromArrayBuffer(tiny4326([0, 1, 2, 3, -9999, 10, 10, 9]))
    expect(await overviewHistogram(tiff, { buckets: 4, range: [0, 12] })).toEqual({ image: 0, width: 4, height: 2, min: 0, max: 12, buckets: [3, 1, 0, 3], valid: 7, pixels: 8 })
    expect((await overviewHistogram(tiff, { buckets: 2 })).buckets).toEqual([4, 3])
    expect(bucketCounts([0, 5, 100], null, 0, 10, 2)).toEqual([1, 2])
  })
  it('a point value reads the 4326 pixel under lon/lat; nodata is NaN, outside is null (spike 3 condition 2)', async () => {
    const tiff = await fromArrayBuffer(tiny4326([0, 1, 2, 3, -9999, 10, 10, 9]))
    expect(await pointValue(tiff, [2.5, 1.5])).toEqual([2])
    expect(await pointValue(tiff, [3.9, 0.1])).toEqual([9])
    expect((await pointValue(tiff, [0.5, 0.5]))![0]).toBeNaN()
    expect(await pointValue(tiff, [5, 1])).toBeNull()
  })
})
