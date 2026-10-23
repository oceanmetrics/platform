// moved from oceanmetrics/indicators src/report/spec.test.ts ("expanding the rules") with the rules, plus the URL keys
// and the row selection the alerts Worker filters change files by
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES, expandIndicators, expandPlaces, matchesRules, matchIndicators, matchPlaces, rulesFromParams, rulesParams,
  selectRows, seriesLeads,
} from './report.js'
import type { Rules } from './report.js'

const IND = [
  { id: 'erddap:sst:mean', series: 'sst', lead: true, category: { onms: 'water-quality', names: 'physical-chemical', eov: 'sea-surface-temperature' } },
  { id: 'erddap:oisst:mean', series: 'sst', lead: false, category: { onms: 'water-quality', names: 'physical-chemical', eov: 'sea-surface-temperature' } },
  { id: 'erddap:npp:mean', series: 'npp', lead: true, category: { onms: 'living-resources', names: 'biological', eov: 'phytoplankton' } },
  { id: 'obis:species', series: 'obis-all', lead: true, category: { onms: 'living-resources', names: 'biological' } },
  { id: 'obis:records', series: 'obis-all', lead: false, category: { onms: 'living-resources', names: 'biological' } },
  { id: 'sdg:x', series: 'sdg', lead: false, category: { onms: 'response' } },
]
const ids = (xs: { id: string }[]) => xs.map((x) => x.id)
const PLACES = [
  { id: 'NMS:CINMS', coll: 'places' }, { id: 'NMS:FKNMS', coll: 'places' }, { id: 'NMS:TBNMS', coll: 'places' },
  { id: 'MRGID:8456', coll: 'mr_eez' }, { id: 'MRGID:8371', coll: 'mr_eez' },
]
const kv = (s: string) => new Map(s.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)] as [string, string] }))

describe('expanding the rules', () => {
  it('a series lead is the marked one, else its first member', () => {
    expect([...seriesLeads(IND)].map(([s, i]) => `${s}=${i.id}`)).toEqual(['sst=erddap:sst:mean', 'npp=erddap:npp:mean', 'obis-all=obis:species', 'sdg=sdg:x'])
  })
  it('* is every series lead; cat: is the leads tagged with the term in any vocabulary', () => {
    expect(ids(matchIndicators('*', IND))).toEqual(['erddap:sst:mean', 'erddap:npp:mean', 'obis:species', 'sdg:x'])
    expect(ids(matchIndicators('cat:living-resources', IND))).toEqual(['erddap:npp:mean', 'obis:species'])
    expect(ids(matchIndicators('cat:sea-surface-temperature', IND))).toEqual(['erddap:sst:mean'])
  })
  it('an indicator without tags is never picked by cat:', () => {
    expect(matchIndicators('cat:biological', [{ id: 'x:y', series: 'x', lead: true }])).toEqual([])
  })
  it('all is every indicator, leads or not; an exclude still takes from it', () => {
    expect(ids(matchIndicators('all', IND))).toEqual(ids(IND))
    expect(ids(expandIndicators({ include: ['all'], exclude: ['series:obis-all:*', 'sdg:x'] }, IND))).toEqual(['erddap:sst:mean', 'erddap:oisst:mean', 'erddap:npp:mean'])
  })
  it('series: is its lead, series:…:* every member, an id itself, an unknown rule nothing', () => {
    expect(ids(matchIndicators('series:sst', IND))).toEqual(['erddap:sst:mean'])
    expect(ids(matchIndicators('series:sst:*', IND))).toEqual(['erddap:sst:mean', 'erddap:oisst:mean'])
    expect(ids(matchIndicators('erddap:oisst:mean', IND))).toEqual(['erddap:oisst:mean'])
    expect(matchIndicators('cat:nope', IND)).toEqual([])
  })
  it('include then exclude, in manifest order; an exclude may be a rule', () => {
    expect(ids(expandIndicators({ include: ['cat:living-resources', 'erddap:oisst:mean'], exclude: ['obis:species'] }, IND)))
      .toEqual(['erddap:oisst:mean', 'erddap:npp:mean'])
    expect(ids(expandIndicators({ include: ['*'], exclude: ['series:obis-all:*'] }, IND))).toEqual(['erddap:sst:mean', 'erddap:npp:mean', 'sdg:x'])
  })
  it('places: *, coll:, an id; then the excludes', () => {
    expect(ids(expandPlaces({ include: ['coll:places'], exclude: ['NMS:TBNMS'] }, PLACES))).toEqual(['NMS:CINMS', 'NMS:FKNMS'])
    expect(ids(expandPlaces({ include: ['NMS:CINMS', 'MRGID:8371'], exclude: [] }, PLACES))).toEqual(['NMS:CINMS', 'MRGID:8371'])
    expect(expandPlaces({ include: ['*'], exclude: ['coll:mr_eez'] }, PLACES)).toHaveLength(3)
  })
  it('coll:<slug> matches a place by its group (home collection) or by a values collection that holds it', () => {
    const pl = [
      { id: 'NERRS:WEL', coll: 'noaa_nerrs', valuesColls: ['noaa_nerrs'] },
      { id: 'MRGID:8439', coll: 'mr_eez', valuesColls: ['mr_eez', 'places'] },
      { id: 'NMS:A', coll: 'noaa_sanctuaries', valuesColls: ['places'] },
      { id: 'NMS:B', coll: 'noaa_sanctuaries' },
    ]
    expect(ids(matchPlaces('coll:noaa_sanctuaries', pl))).toEqual(['NMS:A', 'NMS:B'])   // by group
    expect(ids(matchPlaces('coll:places', pl))).toEqual(['MRGID:8439', 'NMS:A'])        // an old link (pi=coll:places): by values collection
    expect(ids(matchPlaces('coll:mr_eez', pl))).toEqual(['MRGID:8439'])
    expect(ids(matchPlaces('coll:nope', pl))).toEqual([])
    expect(ids(matchPlaces('NMS:B', pl))).toEqual(['NMS:B'])
  })
  it('coll:<slug> is strict when a place has the slug as its group: a place only read from that values collection is not in it', () => {
    const pl = [
      { id: 'NMS:A', coll: 'places', valuesColls: ['places'] },
      { id: 'MRGID:8439', coll: 'mr_eez', valuesColls: ['mr_eez', 'places'] },
    ]
    expect(ids(matchPlaces('coll:places', pl))).toEqual(['NMS:A'])
    expect(ids(expandPlaces(DEFAULT_RULES.places, pl))).toEqual(['NMS:A'])
  })
  it('set:<id> is the places of the groups of the place set; an unknown set selects nothing', () => {
    const sets = [{ id: 'political', groups: ['mr_eez', 'fao_high_seas'] }]
    const pl = [{ id: 'MRGID:1', coll: 'mr_eez' }, { id: 'FAO:HS1', coll: 'fao_high_seas' }, { id: 'NMS:A', coll: 'places' }]
    expect(ids(matchPlaces('set:political', pl, sets))).toEqual(['MRGID:1', 'FAO:HS1'])
    expect(ids(expandPlaces({ include: ['set:political'], exclude: ['MRGID:1'] }, pl, sets))).toEqual(['FAO:HS1'])
    expect(matchPlaces('set:political', pl)).toEqual([])
    expect(matchPlaces('set:nope', pl, sets)).toEqual([])
  })
})

describe('the rules in a URL', () => {
  it('the default rules write no keys, and no keys read back the default', () => {
    expect(DEFAULT_RULES).toEqual({ places: { include: ['coll:places'], exclude: [] }, indicators: { include: ['*'], exclude: [] } })
    expect(rulesParams(DEFAULT_RULES)).toEqual([])
    expect(rulesFromParams(new Map())).toEqual(DEFAULT_RULES)
  })
  it('writes pi px ii ix, only what differs, and round-trips', () => {
    const r: Rules = { places: { include: ['coll:mr_eez'], exclude: ['NMS:TBNMS'] }, indicators: { include: ['cat:water-quality', 'series:obis-all:*'], exclude: ['obis:simpson'] } }
    expect(rulesParams(r)).toEqual([['pi', 'coll:mr_eez'], ['px', 'NMS:TBNMS'], ['ii', 'cat:water-quality,series:obis-all:*'], ['ix', 'obis:simpson']])
    expect(rulesFromParams(new Map(rulesParams(r)))).toEqual(r)
    expect(rulesFromParams(kv('pi=NMS:CINMS, NMS:FKNMS,&ix='))).toEqual({ places: { include: ['NMS:CINMS', 'NMS:FKNMS'], exclude: [] }, indicators: DEFAULT_RULES.indicators })
  })
  it('a reader never shares the default arrays with the rules it returns', () => {
    const r = rulesFromParams(new Map())
    r.places.include.push('x')
    expect(DEFAULT_RULES.places.include).toEqual(['coll:places'])
  })
})

describe('selecting rows (a watch over a change file)', () => {
  const rows = [
    { place_id: 'NMS:CINMS', coll: 'places', place_coll: 'places', indicator: 'erddap:sst:mean' },
    { place_id: 'NMS:CINMS', coll: 'places', place_coll: 'places', indicator: 'obis:records' },
    { place_id: 'NMS:FKNMS', coll: 'places', place_coll: 'places', indicator: 'obis:species' },
    { place_id: 'MRGID:8456', coll: 'mr_eez', place_coll: 'mr_eez', indicator: 'erddap:npp:mean' },
    { place_id: 'NMS:CINMS', coll: 'places', place_coll: 'places', indicator: 'unknown:x' },
  ]
  const ctx = { indicators: IND, sets: [{ id: 'political', groups: ['mr_eez'] }] }
  const pick = (r: Rules) => selectRows(r, rows, ctx).map((x) => `${x.place_id} ${x.indicator}`)
  it('a place watch: the leads of that place, an indicator outside the manifest never', () => {
    expect(pick({ places: { include: ['NMS:CINMS'], exclude: [] }, indicators: { include: ['*'], exclude: [] } })).toEqual(['NMS:CINMS erddap:sst:mean'])
    expect(pick({ places: { include: ['NMS:CINMS'], exclude: [] }, indicators: { include: ['all'], exclude: [] } })).toEqual(['NMS:CINMS erddap:sst:mean', 'NMS:CINMS obis:records'])
  })
  it('coll:places with a series:…:* rule and an ix exclusion', () => {
    expect(pick({ places: { include: ['coll:places'], exclude: [] }, indicators: { include: ['series:obis-all:*'], exclude: ['obis:species'] } }))
      .toEqual(['NMS:CINMS obis:records'])
  })
  it('a set: rule and a px exclusion', () => {
    expect(pick({ places: { include: ['set:political'], exclude: [] }, indicators: { include: ['all'], exclude: [] } })).toEqual(['MRGID:8456 erddap:npp:mean'])
    expect(pick({ places: { include: ['*'], exclude: ['coll:places'] }, indicators: { include: ['all'], exclude: [] } })).toEqual(['MRGID:8456 erddap:npp:mean'])
  })
  it('a row without place_coll is grouped by its values coll', () => {
    expect(matchesRules(DEFAULT_RULES, { place_id: 'NMS:A', coll: 'places', indicator: 'erddap:sst:mean' }, ctx)).toBe(true)
    expect(matchesRules(DEFAULT_RULES, { place_id: 'MRGID:1', coll: 'mr_eez', indicator: 'erddap:sst:mean' }, ctx)).toBe(false)
  })
})
