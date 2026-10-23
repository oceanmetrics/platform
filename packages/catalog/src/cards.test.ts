// the card rules: one test per rule, on the synthetic fixtures in fixtures/indicators/ (ported from the places page's
// indicators tests) and small rows written here. no network.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  absenceFor, absenceText, cardsFor, configHash, configLines, coverageFor, datasetCitation, duckdbSnippet, footerLine,
  foldSeriesWithoutRule, methodLabel, methodNote, periodOf, pickRow, placeCitation, placeViewHref, reproduceFor, rollups,
  slotFor, valuesUrl,
} from './cards.js'
import type { CoverageRow, IndicatorsManifest } from './cards.js'
import { loadCoverage } from './indicators.js'

const fx = (name: string) => new URL(`../fixtures/indicators/${name}`, import.meta.url)
const MANIFEST = JSON.parse(readFileSync(fx('indicators.json'), 'utf8')) as IndicatorsManifest
const PARQUET = readFileSync(fx('coverage.parquet'))
const serve = (async () => new Response(new Uint8Array(PARQUET), { status: 200 })) as unknown as typeof fetch

let ROWS: CoverageRow[] = []
const load = async () => (ROWS.length ? ROWS : (ROWS = await loadCoverage('https://x.test/ind/', { fetch: serve })))
const ind = (id: string) => MANIFEST.indicators.find((i) => i.id === id)!
const BASE = 'https://storage.oceanmetrics.io/indicators/'

describe('the row and the period of a card', () => {
  it('takes the status grain first, else the next grain with a value', async () => {
    const rows = coverageFor(await load(), 'MRGID:1')
    expect(pickRow(rows.filter((r) => r.indicator === 'obis:species'), { status_grain: 'year' })?.time_grain).toBe('year')
    expect(pickRow(rows.filter((r) => r.indicator === 'obis:density:fish'), { status_grain: 'year' })?.time_grain).toBe('decade')
    expect(pickRow([], { status_grain: 'year' })).toBeNull()
  })

  it('formats the period by grain', () => {
    expect(periodOf({ last_time: '2025-01-01', time_grain: 'year' })).toBe('2025')
    expect(periodOf({ last_time: '2025-07-01', time_grain: 'month' })).toBe('2025-07')
    expect(periodOf({ last_time: '2020-01-01', time_grain: 'decade' })).toBe('the 2020s')
    expect(periodOf({ last_time: null, time_grain: 'all' })).toBe('all years')
  })

  it('labels the method and gives its note; a method not implemented yet is noted as values', () => {
    expect(methodLabel({ status_method: 'iea-sd', status_grain: 'year', recent: 5 })).toBe('iea-sd: the mean of the last 5 years against 1 SD of the long-term mean (IEA)')
    expect(methodLabel({ status_method: 'names-pct', status_grain: 'year' })).toBe('names-pct: the recent mean against the 10th and 90th percentiles of the record (NaMES)')
    expect(methodLabel({ status_method: 'values', status_grain: 'year' })).toBe('values: the last value, with no status rule')
    expect(methodNote({ status_method: 'iea-sd' })).toBe('The recent mean against the long-term mean ± 1 SD of the place’s own record (CCIEA).')
    expect(methodNote({ status_method: 'anomaly' })).toBe('The values as they are, with no status.')
  })
})

describe('the deep link', () => {
  it('opens the indicators Place view on the place, its values collection and the indicator', () => {
    expect(placeViewHref('NMS:CINMS', 'places', 'erddap:dhw_5km:CRW_SST:mean'))
      .toBe('https://oceanmetrics.io/indicators/#view=place&place=NMS:CINMS&coll=places&ind=erddap:dhw_5km:CRW_SST:mean')
    expect(placeViewHref('MRGID:8439')).toBe('https://oceanmetrics.io/indicators/#view=place&place=MRGID:8439')
    expect(placeViewHref('X:a b/c', 'mr_eez')).toBe('https://oceanmetrics.io/indicators/#view=place&place=X:a%20b%2Fc&coll=mr_eez')
    expect(placeViewHref('NMS:A', null, null, 'http://localhost:5181')).toBe('http://localhost:5181/#view=place&place=NMS:A')
  })
})

describe('the citation with the place clause', () => {
  it('puts the place after the indicator id in the manifest\'s "Values:" clause', () => {
    expect(placeCitation(ind('erddap:sst'), 'NMS:FKNMS')).toBe(
      'NOAA Coral Reef Watch. 2018, updated daily. Daily Global 5km Satellite Coral Bleaching Heat Stress Monitoring. Values: Ocean Metrics Indicators, manifest 2026.10.22, erddap:sst, place NMS:FKNMS, CC BY 4.0, https://oceanmetrics.io/indicators/')
  })

  it('appends the clause to a citation without one, and stands alone without a citation', () => {
    expect(placeCitation({ id: 'erddap:baa', citation: "only the indicator's own citation" }, 'NMS:A'))
      .toBe("only the indicator's own citation Values: Ocean Metrics Indicators, erddap:baa, place NMS:A.")
    expect(placeCitation({ id: 'erddap:short' }, 'NMS:A')).toBe('Values: Ocean Metrics Indicators, erddap:short, place NMS:A.')
  })

  it('a dataset citation is made from its producers, title and DOI when it has none', () => {
    expect(datasetCitation(ind('cmems:chl'))).toBe('Copernicus Marine Service; Global Ocean Biogeochemistry Hindcast; https://doi.org/10.48670/moi-00019')
    expect(datasetCitation(ind('erddap:sst'))).toBe('NOAA Coral Reef Watch. 2018, updated daily. Daily Global 5km Satellite Coral Bleaching Heat Stress Monitoring.')
    expect(datasetCitation(ind('erddap:short'))).toBe('')
  })
})

describe('Reproduce', () => {
  it('the values url is the collection path under the base; null when the manifest lists no file', () => {
    expect(valuesUrl('https://x.test/ind', ind('erddap:sst'), 'places')).toBe('https://x.test/ind/values/indicator=erddap:sst/coll=places/data.parquet')
    expect(valuesUrl(BASE, ind('erddap:sst'), 'mr_eez')).toBeNull()
    expect(valuesUrl(BASE, ind('erddap:short'), 'places')).toBeNull()
  })

  it('the DuckDB snippet reads the place\'s rows from the values file, quotes escaped', () => {
    expect(duckdbSnippet('https://x.test/v.parquet', 'NMS:A')).toBe(
      "SELECT time_grain, time, value, n FROM read_parquet('https://x.test/v.parquet') WHERE place_id = 'NMS:A' ORDER BY time_grain, time;")
    expect(duckdbSnippet('https://x.test/v.parquet', "X:o'hare")).toContain("WHERE place_id = 'X:o''hare'")
  })

  it('the config lines pin place, indicator, method and its options, and the manifest', () => {
    expect(configLines(ind('erddap:sst'), 'NMS:A', '2026.10.22')).toEqual([
      'place_id: NMS:A', 'indicator: erddap:sst', 'status_method: iea-sd', 'status_grain: year', 'recent: 5', 'min_periods: 10', 'manifest: 2026.10.22',
    ])
  })

  it('the config hash is stable for the same inputs and differs for another place or manifest', () => {
    const a = configHash(configLines(ind('erddap:sst'), 'NMS:A', '2026.10.22'))
    expect(a).toMatch(/^[0-9a-f]{12}$/)
    expect(configHash(configLines(ind('erddap:sst'), 'NMS:A', '2026.10.22'))).toBe(a)
    expect(configHash(configLines(ind('erddap:sst'), 'NMS:B', '2026.10.22'))).not.toBe(a)
    expect(configHash(configLines(ind('erddap:sst'), 'NMS:A', '2026.10.23'))).not.toBe(a)
  })

  it('regression: the hash of fixed lines never changes (the indicators viewer\'s delivery.ts gives the same)', () => {
    expect(configHash(['place_id: NMS:A', 'indicator: erddap:sst'])).toBe(HASH_AB)
    expect(configHash(configLines(ind('erddap:sst'), 'NMS:A', '2026.10.22'))).toBe(HASH_SST_A)
  })

  it('the block: url, snippet, lines and hash together; no snippet without a url', () => {
    const r = reproduceFor(ind('erddap:sst'), 'NMS:A', 'places', '2026.10.22', 'https://x.test/ind/')
    expect(r).toEqual({
      valuesUrl: 'https://x.test/ind/values/indicator=erddap:sst/coll=places/data.parquet',
      snippet: "SELECT time_grain, time, value, n FROM read_parquet('https://x.test/ind/values/indicator=erddap:sst/coll=places/data.parquet') WHERE place_id = 'NMS:A' ORDER BY time_grain, time;",
      config: configLines(ind('erddap:sst'), 'NMS:A', '2026.10.22'), hash: HASH_SST_A,
    })
    expect(reproduceFor(ind('erddap:short'), 'NMS:A', 'places', '2026.10.22')).toMatchObject({ valuesUrl: null, snippet: null })
  })
})

describe('cards', () => {
  it('a sanctuary: leads first, then by series; an indicator the manifest lacks is left out', async () => {
    expect(cardsFor(await load(), MANIFEST, { placeId: 'NMS:A' }).map((c) => c.id)).toEqual(['erddap:baa', 'erddap:sst', 'cmems:chl', 'erddap:short'])
  })

  it('leadsOnly keeps the leads', async () => {
    expect(cardsFor(await load(), MANIFEST, { placeId: 'NMS:A', leadsOnly: true }).map((c) => c.id)).toEqual(['erddap:baa', 'erddap:sst'])
  })

  it('a status card: every field', async () => {
    const sst = cardsFor(await load(), MANIFEST, { placeId: 'NMS:A' }).find((c) => c.id === 'erddap:sst')
    expect(sst).toEqual({
      id: 'erddap:sst', placeId: 'NMS:A', title: 'Sea surface temperature', series: 'sst', seriesTitle: 'Sea surface temperature', lead: true,
      coll: 'places', grain: 'year', value: '15.66', unit: '°C', period: '2025',
      status: 'within', trend: 'flat', glyph: 'st-within', trendGlyph: 'tr-flat',
      statusWord: 'within its own record', caption: 'Within its own record · trend flat',
      sentence: 'SST in A over the last 5 years (2021–2025) was within 1 SD of its 1996–2025 mean, and changed by less than 1 SD.',
      method: 'iea-sd', methodLabel: 'iea-sd: the mean of the last 5 years against 1 SD of the long-term mean (IEA)',
      methodNote: 'The recent mean against the long-term mean ± 1 SD of the place’s own record (CCIEA).',
      citation: 'NOAA Coral Reef Watch. 2018, updated daily. Daily Global 5km Satellite Coral Bleaching Heat Stress Monitoring. Values: Ocean Metrics Indicators, manifest 2026.10.22, erddap:sst, place NMS:A, CC BY 4.0, https://oceanmetrics.io/indicators/',
      href: 'https://oceanmetrics.io/indicators/#view=place&place=NMS:A&coll=places&ind=erddap:sst',
      reproduce: reproduceFor(ind('erddap:sst'), 'NMS:A', 'places', '2026.10.22', BASE),
      hasRule: true, obis: false,
    })
  })

  it('above with a trend; the dataset citation with the place clause appended', async () => {
    const chl = cardsFor(await load(), MANIFEST, { placeId: 'NMS:A' }).find((c) => c.id === 'cmems:chl')!
    expect([chl.value, chl.unit, chl.glyph, chl.trendGlyph, chl.caption]).toEqual(['1.27', 'mg m⁻³', 'st-above', 'tr-up', 'Above its own record · trend up'])
    expect(chl.citation).toBe('Copernicus Marine Service; Global Ocean Biogeochemistry Hindcast; https://doi.org/10.48670/moi-00019 Values: Ocean Metrics Indicators, cmems:chl, place NMS:A.')
  })

  it('a rule with too short a record says why there is no status', async () => {
    const c = cardsFor(await load(), MANIFEST, { placeId: 'NMS:A' }).find((x) => x.id === 'erddap:short')!
    expect([c.value, c.period, c.status, c.glyph, c.trendGlyph, c.statusWord, c.caption, c.citation])
      .toEqual(['9.24', '2023', null, 'st-none', null, 'no status', 'No status: 1 year of record, fewer than the 10 a status needs', 'Values: Ocean Metrics Indicators, erddap:short, place NMS:A.'])
  })

  it('a categorical card: the largest class and its share, no unit, no status', async () => {
    const c = cardsFor(await load(), MANIFEST, { placeId: 'NMS:A' }).find((x) => x.id === 'erddap:baa')!
    expect([c.value, c.unit, c.glyph, c.statusWord, c.caption, c.hasRule, c.methodNote])
      .toEqual(['No Stress 82%', '', 'st-none', 'no status rule', 'Categorical: shown as class shares, no status', false, 'The values as they are, with no status.'])
  })

  it('an EEZ: OBIS and SDG values, and a decade period when the status grain is empty', async () => {
    const cards = cardsFor(await load(), MANIFEST, { placeId: 'MRGID:1' })
    expect(cards.map((c) => [c.id, c.value, c.unit, c.period, c.caption, c.obis])).toEqual([
      ['obis:species', '1234', 'species', '2024', 'No status rule: shown as a value', true],
      ['sdg:mpa', '12.3', '%', '2023', 'No status rule: shown as a value', false],
      ['obis:es50', '45.3', 'species', '2024', 'No status rule: shown as a value', true],
      ['obis:density:fish', '0.50', 'records km⁻²', 'the 2020s', 'No status rule: shown as a value', true],
    ])
    expect(cards[3].href).toBe('https://oceanmetrics.io/indicators/#view=place&place=MRGID:1&coll=mr_eez&ind=obis:density:fish')
  })

  it('the base and the app url are the caller\'s', async () => {
    const c = cardsFor(await load(), MANIFEST, { placeId: 'NMS:A', base: 'http://127.0.0.1:8080/catalog', appUrl: 'http://localhost:5181/' })[1]
    expect([c.href, c.reproduce.valuesUrl]).toEqual([
      'http://localhost:5181/#view=place&place=NMS:A&coll=places&ind=erddap:sst', 'http://127.0.0.1:8080/catalog/values/indicator=erddap:sst/coll=places/data.parquet'])
  })
})

describe('the three absences', () => {
  it('absenceFor: null with cards, nodata with rows and no value, notcomputed with no rows', async () => {
    const rows = await load()
    expect(absenceFor(rows, MANIFEST, 'NMS:A')).toBeNull()
    expect(absenceFor(rows, MANIFEST, 'NMS:EMPTY')).toBe('nodata')
    expect(absenceFor(rows, MANIFEST, 'NMS:NEW')).toBe('notcomputed')
  })

  it('three distinct texts', () => {
    const nodata = absenceText('nodata', 'NMS:A', { layerTitle: 'National Marine Sanctuaries' })
    const notcomputed = absenceText('notcomputed', 'BOEM:OCS-A 0486')
    const nostatus = absenceText('nostatus', 'MRGID:8439', { n: 63 })
    expect(nodata).toEqual({ kind: 'nodata', text: 'No data here: the indicators catalog covers National Marine Sanctuaries, but none of its indicators has a value for this place.' })
    expect(notcomputed).toEqual({
      kind: 'notcomputed',
      text: 'Not computed yet. Nobody has computed indicators for this place: compute it in ERDDAP Places, or ask for it in Indicators.',
      href: 'https://oceanmetrics.io/erddap-places/#place=BOEM:OCS-A 0486', linkText: 'ERDDAP Places',
      more: [{ href: 'https://oceanmetrics.io/indicators/#view=place&place=BOEM:OCS-A%200486', linkText: 'Indicators' }],
    })
    expect(nostatus).toEqual({
      kind: 'nostatus',
      text: 'No status rule for 63 OBIS series: counts of records and species track sampling effort, so they are shown as values, not as a status.',
      href: 'https://oceanmetrics.io/indicators/#view=place&place=MRGID:8439', linkText: 'All 63 in Indicators',
    })
    expect(new Set([nodata.text, notcomputed.text, nostatus.text]).size).toBe(3)
  })

  it('regression: the dated sentence of "not computed yet" is the caller\'s note, never a constant of the package', () => {
    expect(absenceText('notcomputed', 'NMS:NEW').text).not.toMatch(/week|20\d\d/)
    expect(absenceText('notcomputed', 'NMS:NEW', { note: 'Indicators for every gazetteer place arrive in build week 3, 2026-11-13 to 11-19.' }).text)
      .toBe('Not computed yet. Nobody has computed indicators for this place: compute it in ERDDAP Places, or ask for it in Indicators. Indicators for every gazetteer place arrive in build week 3, 2026-11-13 to 11-19.')
  })
})

describe('the fold of the series without a status rule', () => {
  it('OBIS series fold into one line with their count and how many stay above as leads', async () => {
    const f = foldSeriesWithoutRule(cardsFor(await load(), MANIFEST, { placeId: 'MRGID:1' }))
    expect(f.cards.map((c) => c.id)).toEqual(['obis:species', 'sdg:mpa'])
    expect([f.n, f.shown]).toEqual([3, 1])
    expect(f.line).toEqual(absenceText('nostatus', 'MRGID:1', { n: 3, shown: 1 }))
    expect(f.line?.text).toBe('No status rule for 3 OBIS series, 1 of them above: counts of records and species track sampling effort, so they are shown as values, not as a status.')
  })

  it('nothing to fold: every card stays and there is no line', async () => {
    const cards = cardsFor(await load(), MANIFEST, { placeId: 'NMS:A' })
    expect(foldSeriesWithoutRule(cards)).toEqual({ cards, n: 0, shown: 0, line: null })
    expect(foldSeriesWithoutRule([])).toEqual({ cards: [], n: 0, shown: 0, line: null })
  })

  it('the fold rule is a parameter', async () => {
    const f = foldSeriesWithoutRule(cardsFor(await load(), MANIFEST, { placeId: 'NMS:A' }), { fold: (c) => !c.hasRule })
    expect([f.cards.map((c) => c.id), f.n, f.shown]).toEqual([['erddap:baa', 'erddap:sst', 'cmems:chl', 'erddap:short'], 1, 1])
  })
})

describe('the slot', () => {
  it('a sanctuary: four cards, the two leads first, no fold line', async () => {
    const s = slotFor(await load(), MANIFEST, 'NMS:A')
    expect([s.cards.length, s.first, s.total, s.noStatus, s.absence]).toEqual([4, 2, 4, null, null])
  })

  it('an EEZ: the OBIS series that are not leads fold', async () => {
    const s = slotFor(await load(), MANIFEST, 'MRGID:1')
    expect([s.cards.map((c) => c.id), s.first, s.total, s.absence]).toEqual([['obis:species', 'sdg:mpa'], 2, 4, null])
    expect(s.noStatus).toEqual(absenceText('nostatus', 'MRGID:1', { n: 3, shown: 1 }))
  })

  it('with no leads, the first SHOWN_FIRST show, and shownFirst is a parameter', async () => {
    const noLeads = { ...MANIFEST, indicators: MANIFEST.indicators.map((i) => ({ ...i, lead: false })) }
    expect(slotFor(await load(), noLeads, 'NMS:A').first).toBe(4)
    expect(slotFor(await load(), noLeads, 'NMS:A', { shownFirst: 2 }).first).toBe(2)
  })

  it('regression: no data here is a place with coverage rows whose values are all null', async () => {
    const s = slotFor(await load(), MANIFEST, 'NMS:EMPTY', { layerTitle: 'Sanctuaries' })
    expect([s.absence?.kind, s.cards]).toEqual(['nodata', []])
  })

  it('regression: not computed yet is a place with no coverage rows, the caller\'s note added', () => {
    const note = 'Indicators for every place arrive later.'
    expect(slotFor([], MANIFEST, 'BOEM:X', { note })).toEqual({
      cards: [], first: 0, noStatus: null, total: 0, absence: absenceText('notcomputed', 'BOEM:X', { note }),
    })
  })

  it('the footer line', () => {
    expect(footerLine(44)).toBe("44 indicators · statuses are statistical, relative to each place's own record · from the Ocean Metrics indicators catalog")
    expect(footerLine(1)).toBe("1 indicator · statuses are statistical, relative to each place's own record · from the Ocean Metrics indicators catalog")
  })
})

describe('rollups', () => {
  // 3 places x 3 indicators with known statuses; P3 x i3 has rows and no value; i3 at P1 has a month row too
  const r = (place_id: string, indicator: string, status: CoverageRow['status'], last_time: string | null = '2025-01-01', extra: Partial<CoverageRow> = {}) =>
    ({ place_id, indicator, time_grain: 'year', last_time, last_value: last_time ? 1 : null, status_method: 'iea-sd', status, ...extra }) as CoverageRow
  const ROWS3 = [
    r('P1', 'i1', 'above'), r('P1', 'i2', 'within'), r('P1', 'i3', 'below', '2024-01-01'),
    r('P1', 'i3', null, '2025-08-01', { time_grain: 'month', status_method: null }),
    r('P2', 'i1', 'above', '2023-01-01'), r('P2', 'i2', 'above', '2023-01-01'), r('P2', 'i3', null, '2022-01-01'),
    r('P3', 'i1', 'within', '2025-01-01'), r('P3', 'i2', null, '2024-01-01', { status_method: 'values' }), r('P3', 'i3', null, null),
  ]

  it('counts per place: one cell per place x indicator, at the row with the status', () => {
    const { places } = rollups(ROWS3)
    expect(places.map(({ id, above, within, below, none, nodata, cells }) => [id, above, within, below, none, nodata, cells])).toEqual([
      ['P1', 1, 1, 1, 0, 0, 3],
      ['P2', 2, 0, 0, 1, 0, 3],
      ['P3', 0, 1, 0, 1, 1, 3],
    ])
  })

  it('counts per indicator, and the total', () => {
    const { indicators, total } = rollups(ROWS3)
    expect(indicators.map(({ id, above, within, below, none, nodata }) => [id, above, within, below, none, nodata])).toEqual([
      ['i1', 2, 1, 0, 0, 0],
      ['i2', 1, 1, 0, 1, 0],
      ['i3', 0, 0, 1, 1, 1],
    ])
    expect(total).toEqual({ above: 3, within: 2, below: 1, none: 2, nodata: 1, cells: 9 })
  })

  it('the latest period of a place and of an indicator, among the cells with a value', () => {
    const { places, indicators } = rollups(ROWS3)
    expect(places.map((p) => p.latest?.label)).toEqual(['2025', '2023', '2025'])
    expect(indicators.map((i) => i.latest)).toEqual([
      { time: '2025-01-01', grain: 'year', label: '2025' },
      { time: '2025-01-01', grain: 'year', label: '2025' },
      { time: '2024-01-01', grain: 'year', label: '2024' },
    ])
    expect(rollups([r('P9', 'i9', null, null)]).places[0].latest).toBeNull()
  })

  it('on the coverage fixture', async () => {
    const { total, places } = rollups(await load())
    expect(total).toEqual({ above: 1, within: 1, below: 0, none: 7, nodata: 1, cells: 10 })
    expect(places.map((p) => [p.id, p.cells, p.latest?.label])).toEqual([['NMS:A', 5, '2025'], ['MRGID:1', 4, '2024'], ['NMS:EMPTY', 1, undefined]])
  })
})

// computed once with this package's configHash, checked against the indicators viewer's delivery.ts on 2026-10-23
const HASH_AB = 'b195ca2a85ab'
const HASH_SST_A = '3889c27c6041'
