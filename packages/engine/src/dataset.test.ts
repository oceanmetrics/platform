// the STAC Collections -> Dataset mapping, against copies of the published collections (fixtures/stac, from
// erddap-places catalog/gazetteer/erddap/<id>/collection.json, 2026-10-23).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCategorical, lobeLonSpan, resolveDataset, statsTemplate, toDataset, toDatasetLon, valueExpr, valueLabel, type CubeVariable } from './dataset.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const collection = (id: string) =>
  JSON.parse(fs.readFileSync(path.resolve(DIR, `../fixtures/stac/${id}.json`), 'utf8'))

describe('toDataset', () => {
  it('reads the erddap:* fields and cube:variables of dhw_5km', () => {
    const d = toDataset(collection('dhw_5km'))
    expect(d.datasetId).toBe('dhw_5km')
    expect(d.baseUrl).toMatch(/pacioos/)
    expect(d.latDescending).toBe(true)
    expect(d.format).toBe('parquet')          // CORS on, parquet offered
    expect(d.variables.map((v) => v.name)).toContain('CRW_SST')
    expect(d.timeStep).toBe('P1D')
  })

  it('falls back to jsonp when the server has no CORS', () => {
    const c = { ...collection('dhw_5km'), 'erddap:cors': false }
    expect(toDataset(c).format).toBe('jsonp')
  })

  it('reads the re-served MUR collection', () => {
    const d = toDataset(collection('jplMURSST41'))
    expect(d.baseUrl).toBe('https://erddap.oceanmetrics.io/erddap')
    expect(d.latDescending).toBe(false)
    expect(d.variables.map((v) => v.name)).toContain('analysed_sst')
  })
})

describe('lobeLonSpan', () => {
  it('clamps a lobe running to 180 to a grid ending at 179.75 (PMNM on CMEMS 0.25°)', () => {
    expect(lobeLonSpan([177.84, 25, 180, 30], [-180, 179.75])).toEqual([177.84, 179.75])
  })
  it('leaves a lobe inside the grid alone, and shifts into a 0..360 frame', () => {
    expect(lobeLonSpan([-81, 31, -80, 32], [-180, 180])).toEqual([-81, -80])
    expect(lobeLonSpan([-81, 31, -80, 32], [0, 360])).toEqual([279, 280])
  })
})

describe('erddap-places:depth / erddap-places:status', () => {
  it('reads the surface depth of a 4-D CMEMS grid and none on a 3-D one', () => {
    expect(toDataset(collection('cmems_biogeochem_nutrients')).depth).toBeCloseTo(0.494, 3)
    expect(toDataset(collection('moda_npp_mo_glob')).depth).toBeUndefined()
  })
  it('flags the not-yet-served MUR products as pending, and live ones not', () => {
    expect(toDataset(collection('jplMURSST41mday')).status).toBe('pending')
    expect(toDataset(collection('jplMURSST41anom1day')).status).toBe('pending')
    expect(toDataset(collection('cmems_biogeochem_phyto')).status).toBeUndefined()
  })
  it('reads the descending latitude of the NASA / OSU grids', () => {
    expect(toDataset(collection('IMERG_monthly_global_precip')).latDescending).toBe(true)
    expect(toDataset(collection('cmems_salinity')).latDescending).toBe(false)
  })
})

describe('erddap-places:categorical -> the categorical path', () => {
  it('flags CRW_BAA in dhw_5km and CLASS in Seascapes, and only those', () => {
    for (const [id, name] of [['dhw_5km', 'CRW_BAA'], ['noaa_aoml_seascapes_8day', 'CLASS']] as const) {
      const vars = toDataset(collection(id)).variables
      expect(vars.find((v) => v.name === name)!.categorical).toBe(true)
      expect(vars.filter((v) => v.categorical).map((v) => v.name)).toEqual([name])
    }
  })
  it('a flagged variable maps to the categorical SQL template, an unflagged one to stats_daily', () => {
    const vars = toDataset(collection('dhw_5km')).variables
    expect(statsTemplate(vars.find((v) => v.name === 'CRW_BAA'))).toBe('stats_categorical')
    expect(statsTemplate(vars.find((v) => v.name === 'CRW_SST'))).toBe('stats_daily')
    expect(statsTemplate(null)).toBe('stats_daily')
  })
  it('reads the flag whether it is published as a boolean or a string', () => {
    expect(isCategorical({ 'erddap-places:categorical': true })).toBe(true)
    expect(isCategorical({ 'erddap-places:categorical': 'true' })).toBe(true)
    expect(isCategorical({ 'erddap-places:categorical': false })).toBe(false)
    expect(isCategorical({})).toBe(false)
  })
})

describe('valueExpr / valueLabel', () => {
  const v = (unit: string | null): CubeVariable => ({ name: 'analysed_sst', unit, description: '', categorical: false })
  it('converts Kelvin to Celsius in SQL and labels the axis', () => {
    expect(valueExpr(v('K'))).toBe('(s."analysed_sst" - 273.15)')
    expect(valueLabel(v('kelvin'))).toBe('°C')
  })
  it('leaves an already-Celsius variable alone', () => {
    expect(valueExpr(v('degree_C'))).toBe('s."analysed_sst"')
    expect(valueLabel(v('Celsius'))).toBe('°C')
  })
  it('falls back to the variable name for unitless variables', () => {
    expect(valueLabel(v('1'))).toBe('analysed_sst')
    expect(valueLabel(v(null))).toBe('analysed_sst')
  })
})

describe('toDatasetLon', () => {
  it('shifts into a 0..360 dataset and back into a -180..180 one', () => {
    expect(toDatasetLon(-160, [0, 360])).toBe(200)
    expect(toDatasetLon(200, [-180, 180])).toBe(-160)
    expect(toDatasetLon(-160, [-180, 180])).toBe(-160)
  })
})

describe('resolveDataset: the dataset a link names', () => {
  const all = ['dhw_5km', 'noaa_aoml_seascapes_8day', 'IMERG_monthly_global_precip', 'jplMURSST41mday'].map((id) => toDataset(collection(id)))
  const id = (w: string) => resolveDataset(all, w)?.id ?? null
  it('takes the collection id the app writes', () => {
    expect(id('erddap/dhw_5km')).toBe('erddap/dhw_5km')
    expect(id('erddap/noaa_aoml_seascapes_8day')).toBe('erddap/noaa_aoml_seascapes_8day')
  })
  // the indicators viewer's "Compute it now" link wrote ERDDAP's dataset id, and every dataset but the default fell
  // back to CRW SST without a word (Channel Islands x Seascapes, Albania x IMERG, 2026-10-20)
  it('takes ERDDAP\'s own dataset id without erddap/ (the indicators link, 2026-10-20)', () => {
    expect(id('noaa_aoml_seascapes_8day')).toBe('erddap/noaa_aoml_seascapes_8day')
    expect(id('dhw_5km')).toBe('erddap/dhw_5km')
  })
  it('ignores case: the IMERG collection id is lower case, its dataset id is not', () => {
    expect(all.find((d) => d.datasetId === 'IMERG_monthly_global_precip')!.id).toBe('erddap/imerg_monthly_global_precip')
    expect(id('IMERG_monthly_global_precip')).toBe('erddap/imerg_monthly_global_precip')
    expect(id('erddap/IMERG_monthly_global_precip')).toBe('erddap/imerg_monthly_global_precip')
  })
  it('never picks a pending dataset, and says null for an unknown one', () => {
    expect(id('erddap/jplMURSST41mday')).toBeNull()
    expect(id('jplMURSST41mday')).toBeNull()
    expect(id('no_such_dataset')).toBeNull()
    expect(id('')).toBeNull()
  })
})
