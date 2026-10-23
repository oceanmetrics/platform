import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { atomFeed, changeSentence, countKinds, diffCoverage, entryId, feedFile, feedsFor, feedsIndex, mergeChanges } from './changes.js'
import type { ChangeRow, DiffRow } from './changes.js'
import type { IndicatorsManifest, ManifestIndicator } from './manifest.js'
import { validate } from './validate.js'

// ---- a synthetic pair ----

const ind = (id: string, more: Partial<ManifestIndicator> = {}): ManifestIndicator =>
  ({ id, title: id.toUpperCase(), kind: 'continuous', series: id, lead: true, status_grain: 'year', status_method: 'iea-sd', unit_label: '°C', decimals: 1, ...more })
const MANIFEST: Pick<IndicatorsManifest, 'indicators'> = {
  indicators: [ind('erddap:sst:mean'), ind('erddap:chl:mean', { unit_label: 'mg m-3', decimals: 2 }), ind('obis:records', { status_method: 'values', unit_label: 'records', decimals: 0 }), ind('erddap:habitat:share', { kind: 'categorical' })],
}
const row = (place_id: string, indicator: string, time_grain: DiffRow['time_grain'], last_time: string | null, last_value: number | null, status: DiffRow['status'] = null, status_method: string | null = null): DiffRow =>
  ({ place_id, place_name: place_id === 'NMS:A' ? 'Alpha Sanctuary' : null, coll: 'places', place_coll: 'places', indicator, time_grain, last_time, last_value, status_method, status })

const BEFORE: DiffRow[] = [
  row('NMS:A', 'erddap:sst:mean', 'year', '2024-01-01', 15.2, 'within', 'iea-sd'),
  row('NMS:A', 'erddap:sst:mean', 'month', '2024-12-01', 14.9),
  row('NMS:A', 'erddap:chl:mean', 'year', '2024-01-01', 0.4, null, 'iea-sd'),
  row('NMS:A', 'obis:records', 'year', '2023-01-01', 100, null, 'values'),
  row('NMS:A', 'obis:records', 'all', null, 900),
  row('NMS:B', 'erddap:sst:mean', 'year', '2024-01-01', 20.1, 'above', 'iea-sd'),
  row('NMS:B', 'erddap:chl:mean', 'year', null, null, null, 'iea-sd'),          // a cell with rows and no value
  row('NMS:B', 'obis:records', 'year', '2024-01-01', 5, null, 'values'),       // gone after
]
const AFTER: DiffRow[] = [
  row('NMS:A', 'erddap:sst:mean', 'year', '2025-01-01', 16.05, 'above', 'iea-sd'),   // status within -> above (and a period)
  row('NMS:A', 'erddap:sst:mean', 'month', '2025-12-01', 15.0),
  row('NMS:A', 'erddap:chl:mean', 'year', '2024-01-01', 0.41, 'below', 'iea-sd'),    // a first status, same period (revised value)
  row('NMS:A', 'obis:records', 'year', '2024-01-01', 120, null, 'values'),           // a later period
  row('NMS:A', 'obis:records', 'all', null, 1020),
  row('NMS:B', 'erddap:sst:mean', 'year', '2024-01-01', 20.3, null, 'iea-sd'),       // a status lost
  row('NMS:B', 'erddap:chl:mean', 'year', '2025-01-01', 0.3, null, 'iea-sd'),        // a first value
  row('NMS:C', 'erddap:habitat:share', 'year', '2025-01-01', 0.82),                 // a new place, categorical
  row('NMS:C', 'erddap:sst:mean', 'year', null, null, null, 'iea-sd'),               // rows and no value: nothing
]
const diff = () => diffCoverage(BEFORE, AFTER, { seen: '2026-10-23', manifest: MANIFEST })
const brief = (rs: ChangeRow[]) => rs.map((r) => `${r.place_id} ${r.indicator} ${r.kind}`)

describe('diffCoverage', () => {
  it('one row per place x indicator: new before status before period; no value and no change give none; a lost cell none', () => {
    expect(brief(diff())).toEqual([
      'NMS:A erddap:sst:mean status',
      'NMS:A erddap:chl:mean status',
      'NMS:A obis:records period',
      'NMS:B erddap:sst:mean status',
      'NMS:B erddap:chl:mean new',
      'NMS:C erddap:habitat:share new',
    ])
  })
  it('reads the card row: the status grain first, as pickRow', () => {
    const a = diff()[0]
    expect(a).toEqual({
      place_id: 'NMS:A', place_name: 'Alpha Sanctuary', coll: 'places', place_coll: 'places', indicator: 'erddap:sst:mean', kind: 'status',
      time_grain: 'year', from_status: 'within', to_status: 'above', from_time: '2024-01-01', to_time: '2025-01-01', value: 16.05, unit: '°C',
      sentence: 'ERDDAP:SST:MEAN in Alpha Sanctuary is now above its own record (2025); it was within its own record.', seen: '2026-10-23',
    })
  })
  it('a null -> word status is a status row, worded as a first status; word -> null as a lost one', () => {
    const [, chl, , lost] = diff()
    expect(chl.sentence).toBe('ERDDAP:CHL:MEAN in Alpha Sanctuary has its first status: below its own record (2024).')
    expect(lost.sentence).toBe('ERDDAP:SST:MEAN in NMS:B no longer has a status (2024); it was above its own record.')
  })
  it('a revised value at the same period with the same status is no change', () => {
    const b = [row('NMS:A', 'erddap:sst:mean', 'year', '2024-01-01', 15.2, 'within', 'iea-sd')]
    const a = [row('NMS:A', 'erddap:sst:mean', 'year', '2024-01-01', 15.3, 'within', 'iea-sd')]
    expect(diffCoverage(b, a, { seen: '2026-10-23' })).toEqual([])
  })
  it('regression (PMNM, 2026-10-21): a card row that moves from month to year is no period; a first status there is a status', () => {
    const b = [
      row('NMS:P', 'erddap:sst:mean', 'year', null, null, null, 'iea-sd'), row('NMS:P', 'erddap:sst:mean', 'month', '2026-09-01', 26.1),
      row('NMS:P', 'erddap:habitat:share', 'year', null, null), row('NMS:P', 'erddap:habitat:share', 'month', '2026-09-01', 0.4),
    ]
    const a = [
      row('NMS:P', 'erddap:sst:mean', 'year', '2025-01-01', 25.4, 'above', 'iea-sd'), row('NMS:P', 'erddap:sst:mean', 'month', '2026-09-01', 26.1),
      row('NMS:P', 'erddap:habitat:share', 'year', '2025-01-01', 0.67), row('NMS:P', 'erddap:habitat:share', 'month', '2026-09-01', 0.4),
    ]
    const rs = diffCoverage(b, a, { seen: '2026-10-21', manifest: MANIFEST })
    expect(rs.map((r) => [r.indicator, r.kind, r.from_status, r.to_status])).toEqual([['erddap:sst:mean', 'status', null, 'above']])
    expect(rs[0].sentence).toBe('ERDDAP:SST:MEAN in NMS:P has its first status: above its own record (2025).')
  })
  it('a re-run on the published table finds nothing; without a manifest the grain comes from the status method row', () => {
    expect(diffCoverage(AFTER, AFTER, { seen: '2026-10-23' })).toEqual([])
    const r = diffCoverage([], [row('NMS:A', 'x:y', 'month', '2025-12-01', 1), row('NMS:A', 'x:y', 'decade', '2020-01-01', 2, null, 'iea-sd')], { seen: '2026-10-23' })
    expect(r.map((x) => [x.time_grain, x.unit, x.sentence])).toEqual([['decade', null, 'x:y in Alpha Sanctuary has its first value: 2.00 for the 2020s.']])
  })
  it('the period and new words: the value with its unit and decimals; a categorical share without a number', () => {
    const rs = diff()
    expect(rs[2].sentence).toBe('OBIS:RECORDS in Alpha Sanctuary has a value for 2024: 120 records; the last was for 2023.')
    expect(rs[4].sentence).toBe('ERDDAP:CHL:MEAN in NMS:B has its first value: 0.30 mg m-3 for 2025.')
    expect(rs[5].sentence).toBe('ERDDAP:HABITAT:SHARE in NMS:C has its first value, for 2025.')
  })
  it('every row it writes validates against changes-row', () => {
    for (const r of diff()) expect(validate('changes-row', r).errors).toEqual([])
  })
  it('regression: no generated text says better, worse, improving or deteriorating', () => {
    const texts = [...diff().map((r) => r.sentence), atomFeed(diff(), { title: 't', id: 'tag:x,2026:t', updated: '2026-10-23T08:00:00Z', link: 'https://example.org/' })]
    for (const t of texts) expect(t).not.toMatch(/better|worse|improv|deteriorat/i)
  })
  it('changeSentence is the one wording: the row a diff wrote reads the same again', () => {
    for (const r of diff()) expect(changeSentence(r, MANIFEST)).toBe(r.sentence)
  })
})

describe('counting and merging', () => {
  it('counts per kind', () => expect(countKinds(diff())).toEqual({ status: 3, new: 2, period: 1 }))
  it('a same-day re-run adds only what is new (by date, cell and kind)', () => {
    const rs = diff()
    expect(mergeChanges(rs.slice(0, 4), rs.slice(2))).toEqual(rs)
    expect(mergeChanges(rs, [{ ...rs[0], seen: '2026-10-24' }])).toHaveLength(rs.length + 1)
  })
})

// ---- the real pair: the 10-23 OBIS place_exact build (public coverage rows of two sanctuaries) ----

describe('the real diff of 2026-10-23 00:51 -> 01:05 (OBIS place_exact for the sanctuaries)', () => {
  const fx = JSON.parse(readFileSync(new URL('../fixtures/changes-diff/coverage-2026-10-23.json', import.meta.url), 'utf8')) as { before: DiffRow[]; after: DiffRow[] }
  const rs = diffCoverage(fx.before, fx.after, { seen: '2026-10-23' })
  it('gives 96 new card rows at CINMS and FGBNMS, no status change and no period (2,664 coverage rows and 868 cells over the 18)', () => {
    expect(fx.before).toHaveLength(174)
    expect(fx.after).toHaveLength(471)
    expect(countKinds(rs)).toEqual({ status: 0, new: 96, period: 0 })
    expect(new Set(rs.map((r) => r.place_id))).toEqual(new Set(['NMS:CINMS', 'NMS:FGBNMS']))
    expect(rs.every((r) => r.indicator.startsWith('obis:'))).toBe(true)
  })
  it('each validates, and the place clause names the sanctuary', () => {
    for (const r of rs) expect(validate('changes-row', r).errors).toEqual([])
    expect(rs.find((r) => r.place_id === 'NMS:CINMS')!.sentence).toMatch(/^obis:\S+ in Channel Islands National Marine Sanctuary has its first value/)
  })
})

// ---- Atom ----

/** a tiny Atom reader: enough of RFC 4287 to check the required elements (no DOM in the package's tests) */
function parseAtom(xml: string) {
  expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true)
  expect(xml.trimEnd().endsWith('</feed>')).toBe(true)
  // well formed: every element closes in order
  const stack: string[] = []
  for (const m of xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([a-z]+)\b[^>]*?(\/?)>/g)) {
    if (m[3]) continue
    if (m[1]) expect(stack.pop()).toBe(m[2])
    else stack.push(m[2])
  }
  expect(stack).toEqual([])
  // no raw ampersand outside an entity
  expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/)
  const text = (s: string, tag: string) => [...s.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1])
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const links = (s: string) => [...s.matchAll(/<link rel="([^"]+)"[^>]*href="([^"]+)"\/>/g)].map((m) => [m[1], unesc(m[2])])
  const [head, ...rest] = xml.split('<entry>')
  const entries = rest.map((e) => ({ id: text(e, 'id')[0], title: text(e, 'title')[0], updated: text(e, 'updated')[0], links: links(e) }))
  return { id: text(head, 'id')[0], title: text(head, 'title')[0], updated: text(head, 'updated')[0], author: text(head, 'name')[0], links: links(head), entries }
}

describe('atomFeed', () => {
  const opts = { title: 'Ocean Metrics indicators: Alpha & co', id: 'tag:oceanmetrics.io,2026:feeds/place=NMS:A', updated: '2026-10-23T08:21:40Z', link: 'https://oceanmetrics.io/indicators/', self: 'https://storage.oceanmetrics.io/indicators/feeds/place=NMS:A.xml' }
  it('has the feed id, title, updated, author and the self link; one entry per change, each with id, title, updated and a link', () => {
    const f = parseAtom(atomFeed(diff(), opts))
    expect(f).toMatchObject({ id: opts.id, title: 'Ocean Metrics indicators: Alpha &amp; co', updated: opts.updated, author: 'Ocean Metrics' })
    expect(f.links).toEqual([['self', opts.self], ['alternate', opts.link]])
    expect(f.entries).toHaveLength(6)
    for (const e of f.entries) {
      expect(e.id).toMatch(/^tag:oceanmetrics\.io,2026:changes\/2026-10-23\//)
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.updated).toBe('2026-10-23T00:00:00Z')
      expect(e.links[0][0]).toBe('alternate')
    }
    expect(f.entries[0].links[0][1]).toBe('https://oceanmetrics.io/indicators/#view=place&place=NMS:A&coll=places&ind=erddap:sst:mean')
  })
  it('entry ids are stable: the same change has the same id in every feed and every rebuild, and ids are unique', () => {
    const rs = diff()
    expect(entryId(rs[0])).toBe('tag:oceanmetrics.io,2026:changes/2026-10-23/NMS:A/places/erddap:sst:mean/status')
    expect(new Set(rs.map(entryId)).size).toBe(rs.length)
    expect(atomFeed(rs, opts)).toBe(atomFeed(structuredClone(rs), opts))
  })
  it('newest first, at most max entries; an empty feed is still a valid feed', () => {
    const rs = [...diff(), { ...diff()[0], seen: '2026-10-24' }]
    const f = parseAtom(atomFeed(rs, { ...opts, max: 2 }))
    expect(f.entries.map((e) => e.updated)).toEqual(['2026-10-24T00:00:00Z', '2026-10-23T00:00:00Z'])
    expect(parseAtom(atomFeed([], opts)).entries).toEqual([])
  })
  it('seeded fault: the tiny parser fails a feed missing its closing tag', () => {
    expect(() => parseAtom(atomFeed([], opts).replace('</feed>', ''))).toThrow()
  })
})

describe('feedsFor', () => {
  const index = {
    places: [{ id: 'NMS:A', name: 'Alpha Sanctuary', coll: 'places' }, { id: 'NMS:B', coll: 'places' }, { id: 'NMS:C', coll: 'places' }, { id: 'MRGID:1', name: 'Eez One', coll: 'mr_eez' }, { id: 'X:a b', coll: 'mr_eez' }],
    sets: [{ id: 'political', title: 'Political boundaries', groups: ['mr_eez', 'fao_high_seas'] }],
    colls: { places: 'National Marine Sanctuaries' },
  }
  const feeds = feedsFor(diff(), index)
  it('names all, each collection, each set and each place, with their rows', () => {
    expect(feeds.map((f) => [f.file, f.rows.length])).toEqual([
      ['all.xml', 6], ['coll=places.xml', 6], ['coll=mr_eez.xml', 0], ['set=political.xml', 0],
      ['place=NMS:A.xml', 3], ['place=NMS:B.xml', 2], ['place=NMS:C.xml', 1], ['place=MRGID:1.xml', 0], ['place=X:a_b.xml', 0],
    ])
    expect(feeds[1]).toMatchObject({ kind: 'coll', id: 'places', title: 'Ocean Metrics indicators: National Marine Sanctuaries', href: 'https://storage.oceanmetrics.io/indicators/feeds/coll=places.xml', feedId: 'tag:oceanmetrics.io,2026:feeds/coll=places' })
    expect(feeds[4].title).toBe('Ocean Metrics indicators: Alpha Sanctuary')
    expect(feedFile('place', 'NMS:CINMS')).toBe('place=NMS:CINMS.xml')
  })
  it('a place with no change yet still has a valid feed', () => {
    const f = feeds.find((x) => x.id === 'MRGID:1')!
    expect(parseAtom(atomFeed(f.rows, { title: f.title, id: f.feedId, updated: '2026-10-23T08:00:00Z', link: f.link, self: f.href })).entries).toEqual([])
  })
  it('the index validates against feeds-index', () => {
    const idx = feedsIndex(feeds, '2026-10-23T08:21:40Z')
    expect(validate('feeds-index', idx).errors).toEqual([])
    expect(idx.feeds[0]).toEqual({ kind: 'all', id: 'all', href: 'https://storage.oceanmetrics.io/indicators/feeds/all.xml', title: 'Ocean Metrics indicators: all changes', updated: '2026-10-23T00:00:00Z', entries: 6 })
    expect(idx.feeds[2].updated).toBeNull()
  })
})
