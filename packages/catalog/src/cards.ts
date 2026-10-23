// the indicator cards of a place, one implementation for the indicators viewer and the places record page: which
// coverage rows a card shows, its words (value, period, status, caption, method, citation with the place clause), its
// deep link and its Reproduce block (values url, DuckDB snippet, config lines and hash); the three absences; the fold of
// the series without a status rule; and the rollups the Matrix opens on. pure functions over the manifest and the
// coverage rows (no fetch, no parquet: the readers are in indicators.ts). statuses are never computed here: the status,
// trend and sentence come from coverage.parquet, which the indicators repo builds with @oceanmetrics/status; the words
// come from that package too.
import { fmt, grainNoun, METHOD_NOTES, periodLabel, STATUS_WORDS, statusCaption } from '@oceanmetrics/status'
import type { Grain, MethodId, Status, Trend } from '@oceanmetrics/status'
import { DEFAULT_INDICATORS_BASE, ERDDAP_PLACES_APP, INDICATORS_APP } from './manifest.js'
import type { CoverageRow, IndicatorsManifest, ManifestIndicator } from './manifest.js'

export { ALL_COVERAGE_COLUMNS, COVERAGE_COLUMNS, DEFAULT_INDICATORS_BASE, ERDDAP_PLACES_APP, INDICATORS_APP } from './manifest.js'
export type * from './manifest.js'

/** a base url with its trailing slash */
export const slash = (b: string) => (b.endsWith('/') ? b : b + '/')

/** the coverage rows of one place */
export const coverageFor = <R extends Pick<CoverageRow, 'place_id'>>(rows: R[], placeId: string): R[] => rows.filter((r) => r.place_id === placeId)

// ---- links ----

/** ids keep their colons and pipes readable, as the indicators app writes them */
const enc = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ':').replace(/%7C/gi, '|')

/** the indicators app's Place view: `#view=place&place=<id>[&coll=<coll>][&ind=<indicator>]` (indicators viewer/src/lib/hash.ts) */
export function placeViewHref(placeId: string, coll?: string | null, indicator?: string | null, app = INDICATORS_APP): string {
  const parts = ['view=place', 'place=' + enc(placeId)]
  if (coll) parts.push('coll=' + enc(coll))
  if (indicator) parts.push('ind=' + enc(indicator))
  return `${slash(app)}#${parts.join('&')}`
}

/** erddap-places opened on a place, where it can be computed */
export const erddapPlacesHref = (placeId: string, app = ERDDAP_PLACES_APP) => `${slash(app)}#place=${placeId}`

// ---- the citation ----

/** the dataset's citation line; made from its producers, title and DOI when it has none; the indicator's own as the last resort */
export function datasetCitation(ind: Pick<ManifestIndicator, 'dataset' | 'citation'>): string {
  const d = ind.dataset
  if (d?.citation) return d.citation
  if (d?.title) {
    const who = (d.providers ?? []).filter((p) => p.roles.includes('producer') || p.roles.includes('licensor')).map((p) => p.name)
    return [who.join(', '), d.title, d.doi ?? ''].filter(Boolean).join('; ')
  }
  return ind.citation ?? ''
}

/**
 * the manifest's citation with the place added to its "Values:" clause, e.g. "... Values: Ocean Metrics Indicators,
 * manifest 2026.10.20, erddap:dhw_5km:CRW_SST:mean, place NMS:FKNMS, CC BY 4.0, https://oceanmetrics.io/indicators/".
 * a citation without the clause gets the clause appended (as the indicators viewer's place.ts does).
 */
export function placeCitation(ind: Pick<ManifestIndicator, 'id' | 'citation'>, placeId: string): string {
  const c = ind.citation?.trim() ?? ''
  const at = `${ind.id}, `
  if (c.includes('Values: ') && c.includes(at)) return c.replace(at, `${at}place ${placeId}, `)
  return `${c}${c ? ' ' : ''}Values: Ocean Metrics Indicators, ${ind.id}, place ${placeId}.`
}

// ---- reproduce ----

/** the values parquet of an indicator in a values collection, under the catalog base; null when the manifest lists none */
export function valuesUrl(base: string, ind: Pick<ManifestIndicator, 'collections'>, coll: string): string | null {
  const c = ind.collections?.find((x) => x.coll === coll)
  return c?.path ? slash(base) + c.path : null
}

const sqlQuote = (s: string) => `'${s.replaceAll("'", "''")}'`

/** a DuckDB one-liner that reads the place's rows straight from storage */
export function duckdbSnippet(url: string, placeId: string): string {
  return `SELECT time_grain, time, value, n FROM read_parquet(${sqlQuote(url)}) WHERE place_id = ${sqlQuote(placeId)} ORDER BY time_grain, time;`
}

/** the configuration of a value, canonical: what pins the number (place, indicator, status method and its options, manifest) */
export function configLines(ind: Pick<ManifestIndicator, 'id' | 'status_method' | 'status_grain' | 'recent' | 'min_periods'>, placeId: string, manifestVersion: string): string[] {
  return [
    `place_id: ${placeId}`,
    `indicator: ${ind.id}`,
    `status_method: ${ind.status_method}`,
    `status_grain: ${ind.status_grain}`,
    `recent: ${ind.recent}`,
    `min_periods: ${ind.min_periods}`,
    `manifest: ${manifestVersion}`,
  ]
}

/**
 * a short hash of the configuration (FNV-1a over the canonical lines, 48 bits as 12 hex digits). a stand-in for a
 * sha256 job id: stable and deterministic, not cryptographic. the same as the indicators viewer's delivery.ts.
 */
export function configHash(lines: string[]): string {
  const s = lines.join('\n')
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 ^ h1, 2246822519) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12)
}

/** how to get the number again: its values file, a DuckDB query for the place, and the configuration that pins it */
export interface Reproduce {
  valuesUrl: string | null
  /** null when the manifest lists no values file for the collection */
  snippet: string | null
  config: string[]
  hash: string
}

export function reproduceFor(ind: ManifestIndicator, placeId: string, coll: string, manifestVersion: string, base = DEFAULT_INDICATORS_BASE): Reproduce {
  const url = valuesUrl(base, ind, coll)
  const config = configLines(ind, placeId, manifestVersion)
  return { valuesUrl: url, snippet: url ? duckdbSnippet(url, placeId) : null, config, hash: configHash(config) }
}

// ---- the row, the period and the method ----

/** the grains tried for a card, in order (as the indicators Matrix picks a cell's row): the status grain, then year, month, decade, day, all */
export const grainOrder = (statusGrain: Grain): Grain[] => [...new Set<Grain>([statusGrain, 'year', 'month', 'decade', 'day', 'all'])]

/** the row a card shows: the first in grainOrder with a value; null when none has one */
export function pickRow<R extends Pick<CoverageRow, 'time_grain' | 'last_value'>>(rows: R[], ind: Pick<ManifestIndicator, 'status_grain'>): R | null {
  for (const g of grainOrder(ind.status_grain)) {
    const r = rows.find((x) => x.time_grain === g && x.last_value != null)
    if (r) return r
  }
  return null
}

/** the last period as a reader says it: "2025", "2025-07", "the 2020s", "all years" */
export function periodOf(row: Pick<CoverageRow, 'last_time' | 'time_grain'>): string {
  if (row.time_grain === 'all') return 'all years'
  return row.last_time ? periodLabel(row.last_time, row.time_grain) : ''
}

/** the status methods that give a status (given a long enough record) */
export const STATUS_RULES: ReadonlySet<string> = new Set(['iea-sd', 'names-pct'])
const IMPLEMENTED: ReadonlySet<string> = new Set(['iea-sd', 'names-pct', 'values'])

/** the method that runs: the manifest's, or 'values' for one not implemented yet (as the coverage builder does) */
export const methodOf = (ind: Pick<ManifestIndicator, 'status_method'>): MethodId =>
  IMPLEMENTED.has(ind.status_method) ? (ind.status_method as MethodId) : 'values'

/** the method by name, as a card's "Method" line says it */
export function methodLabel(ind: Pick<ManifestIndicator, 'status_method' | 'status_grain' | 'recent'>): string {
  const recent = ind.recent ?? 5
  switch (ind.status_method) {
    case 'iea-sd'   : return `iea-sd: the mean of the last ${recent} ${grainNoun(ind.status_grain, recent)} against 1 SD of the long-term mean (IEA)`
    case 'names-pct': return 'names-pct: the recent mean against the 10th and 90th percentiles of the record (NaMES)'
    case 'values'   : return 'values: the last value, with no status rule'
    default         : return ind.status_method
  }
}

/** the method in one sentence (@oceanmetrics/status METHOD_NOTES) */
export const methodNote = (ind: Pick<ManifestIndicator, 'status_method'>) => METHOD_NOTES[methodOf(ind)]

// ---- cards ----

export type StatusGlyph = 'st-above' | 'st-within' | 'st-below' | 'st-none'
export type TrendGlyph = 'tr-up' | 'tr-flat' | 'tr-down'

export interface IndicatorCard {
  id: string
  placeId: string
  title: string
  series: string
  seriesTitle: string
  lead: boolean
  /** the values collection the row was read from (the deep link's `coll`) */
  coll: string
  grain: Grain
  /** the last value as text, without the unit ("16.05"; "No Stress 82%" for a categorical one) */
  value: string
  unit: string
  /** the last period, by grain: "2025", "2025-07", "the 2020s", "all years" */
  period: string
  status: Status | null
  trend: Trend | null
  /** the status glyph's class (a glyph for 'no status' too) and the trend's, null without a trend */
  glyph: StatusGlyph
  trendGlyph: TrendGlyph | null
  /** the status in words, relative to the place's own record, or why there is none */
  statusWord: string
  /** the one-line caption under the value */
  caption: string
  /** the status method's deterministic sentence, from coverage.parquet */
  sentence: string
  /** the manifest's status method, its label and its note */
  method: string
  methodLabel: string
  methodNote: string
  /** the citation with the place in its "Values:" clause */
  citation: string
  /** the indicators app's Place view of this place, opened on this indicator */
  href: string
  reproduce: Reproduce
  /** the method is a status rule (iea-sd, names-pct): a status is possible, given a long enough record */
  hasRule: boolean
  /** an OBIS series (a count that tracks sampling effort: never a status) */
  obis: boolean
}

export interface CardsOptions {
  placeId: string
  /** the lead indicators only */
  leadsOnly?: boolean
  /** the catalog root the values urls are under */
  base?: string
  /** the indicators app the deep links open */
  appUrl?: string
}

function card(ind: ManifestIndicator, row: CoverageRow, placeId: string, version: string, base: string, appUrl: string): IndicatorCard {
  const categorical = ind.kind === 'categorical'
  const hasRule = STATUS_RULES.has(ind.status_method)
  const status = hasRule ? row.status : null
  const trend = hasRule ? row.trend : null
  const value = categorical
    ? `${ind.classes?.[row.last_class ?? ''] ?? row.last_class ?? ''} ${fmt((row.last_value ?? 0) * 100, 0)}%`.trim()
    : fmt(row.last_value, ind.decimals ?? 2)
  const statusWord = status ? STATUS_WORDS[status] : hasRule ? STATUS_WORDS.none : 'no status rule'
  let caption: string
  if (status) caption = statusCaption(status, trend)
  else if (categorical) caption = 'Categorical: shown as class shares, no status'
  else if (hasRule) caption = `No status: ${row.why ?? 'not enough record'}`
  else caption = 'No status rule: shown as a value'
  return {
    id: ind.id, placeId, title: ind.title, series: ind.series, seriesTitle: ind.series_title ?? ind.series, lead: ind.lead,
    coll: row.coll, grain: row.time_grain, value, unit: categorical ? '' : (ind.unit_label ?? ind.unit ?? ''), period: periodOf(row),
    status, trend, glyph: status ? `st-${status}` : 'st-none', trendGlyph: trend ? `tr-${trend}` : null,
    statusWord, caption, sentence: row.sentence ?? '',
    method: ind.status_method, methodLabel: methodLabel(ind), methodNote: methodNote(ind),
    citation: placeCitation({ id: ind.id, citation: ind.citation ?? datasetCitation(ind) }, placeId),
    href: placeViewHref(placeId, row.coll, ind.id, appUrl), reproduce: reproduceFor(ind, placeId, row.coll, version, base),
    hasRule, obis: ind.id.startsWith('obis:'),
  }
}

/** leads first, then by series, then by title */
const byLeadSeries = (a: IndicatorCard, b: IndicatorCard) =>
  Number(b.lead) - Number(a.lead) || a.series.localeCompare(b.series) || a.title.localeCompare(b.title)

/**
 * one card per indicator of the place with a value, leads first, then by series and title. `rows` may hold every
 * place (only `placeId`'s are read); an indicator the manifest does not list is left out.
 */
export function cardsFor(rows: CoverageRow[], manifest: IndicatorsManifest, opts: CardsOptions): IndicatorCard[] {
  const { placeId, leadsOnly = false, base = DEFAULT_INDICATORS_BASE, appUrl = INDICATORS_APP } = opts
  const byInd = new Map<string, CoverageRow[]>()
  for (const r of rows) if (r.place_id === placeId) byInd.set(r.indicator, [...(byInd.get(r.indicator) ?? []), r])
  const out: IndicatorCard[] = []
  for (const ind of manifest.indicators) {
    if (leadsOnly && !ind.lead) continue
    const rs = byInd.get(ind.id)
    const row = rs && pickRow(rs, ind)
    if (row) out.push(card(ind, row, placeId, manifest.version, base, appUrl))
  }
  return out.sort(byLeadSeries)
}

// ---- the three absences ----

export type AbsenceKind = 'nodata' | 'notcomputed' | 'nostatus'

export interface Absence {
  kind: AbsenceKind
  text: string
  /** where the reader goes next, and the link's words */
  href?: string
  linkText?: string
  /** further links after the first, in reading order */
  more?: { href: string; linkText: string }[]
}

/**
 * which absence a place shows instead of cards: "no data here" (it has coverage rows and every value is null), "not
 * computed yet" (it has no coverage rows: nobody computed it, whatever its collection), or null when it has cards.
 */
export function absenceFor(rows: CoverageRow[], manifest: IndicatorsManifest, placeId: string): 'nodata' | 'notcomputed' | null {
  const mine = coverageFor(rows, placeId)
  if (cardsFor(mine, manifest, { placeId }).length) return null
  return mine.length ? 'nodata' : 'notcomputed'
}

export interface AbsenceTextOptions {
  /** the place's layer, as the reader knows it ("no data here" names it) */
  layerTitle?: string | null
  /** a sentence added to "not computed yet", e.g. when indicators for every place arrive; the caller owns any date in it */
  note?: string | null
  /** "no status rule": the number of folded series, and how many of them are cards above the line */
  n?: number
  shown?: number
  appUrl?: string
  erddapUrl?: string
}

/** the words and links of each absence, kept distinct */
export function absenceText(kind: AbsenceKind, placeId: string, opts: AbsenceTextOptions = {}): Absence {
  const { layerTitle, note, n = 0, shown = 0, appUrl = INDICATORS_APP, erddapUrl = ERDDAP_PLACES_APP } = opts
  switch (kind) {
    case 'nodata':
      return { kind, text: `No data here: the indicators catalog covers ${layerTitle ?? "this place's layer"}, but none of its indicators has a value for this place.` }
    case 'notcomputed':
      return {
        kind, text: `Not computed yet. Nobody has computed indicators for this place: compute it in ERDDAP Places, or ask for it in Indicators.${note ? ` ${note}` : ''}`,
        href: erddapPlacesHref(placeId, erddapUrl), linkText: 'ERDDAP Places',
        more: [{ href: placeViewHref(placeId, null, null, appUrl), linkText: 'Indicators' }],
      }
    case 'nostatus':
      return {
        kind, text: `No status rule for ${n} OBIS series${shown ? `, ${shown} of them above` : ''}: counts of records and species track sampling effort, so they are shown as values, not as a status.`,
        href: placeViewHref(placeId, null, null, appUrl), linkText: `All ${n} in Indicators`,
      }
  }
}

// ---- the fold of the series without a status rule ----

export interface Fold {
  /** the cards that stay cards: everything but the folded series that are not leads */
  cards: IndicatorCard[]
  /** how many series fold into the line, and how many of them stay as (lead) cards above it */
  n: number
  shown: number
  /** the line, null when nothing folds */
  line: Absence | null
}

export interface FoldOptions { appUrl?: string; fold?: (c: IndicatorCard) => boolean }

/** OBIS series: counts of records and species, which track sampling effort and have no status rule */
export const isObisWithoutRule = (c: IndicatorCard) => c.obis && !c.hasRule

/** fold the series without a status rule (OBIS by default) into one line with their count; their leads stay as cards */
export function foldSeriesWithoutRule(cards: IndicatorCard[], opts: FoldOptions = {}): Fold {
  const fold = opts.fold ?? isObisWithoutRule
  const folded = cards.filter(fold)
  const shown = folded.filter((c) => c.lead).length
  const n = folded.length
  return {
    cards: cards.filter((c) => !(fold(c) && !c.lead)), n, shown,
    line: n ? absenceText('nostatus', cards[0].placeId, { n, shown, appUrl: opts.appUrl }) : null,
  }
}

// ---- the slot: what a place's indicators section shows ----

/** how many cards show before "Show all" when the place has no leads */
export const SHOWN_FIRST = 6

export interface SlotOptions extends Omit<CardsOptions, 'placeId'>, Pick<AbsenceTextOptions, 'layerTitle' | 'note' | 'erddapUrl'> {
  /** the cards shown first when there are no leads */
  shownFirst?: number
  fold?: FoldOptions['fold']
}

export interface Slot {
  /** the cards, leads first (the folded series that are not leads left out) */
  cards: IndicatorCard[]
  /** how many cards show before "Show all": the leads, or the first `shownFirst` when there are none */
  first: number
  /** the folded series, as one line; null when there are none */
  noStatus: Absence | null
  /** indicators of the place with a value (cards and folded series) */
  total: number
  /** no data here / not computed yet; null when there are cards */
  absence: Absence | null
}

/** a place's indicators section: its cards, the fold line, or the absence */
export function slotFor(rows: CoverageRow[], manifest: IndicatorsManifest, placeId: string, opts: SlotOptions = {}): Slot {
  const { shownFirst = SHOWN_FIRST, fold, layerTitle, note, erddapUrl, ...cardOpts } = opts
  const mine = coverageFor(rows, placeId)
  const all = cardsFor(mine, manifest, { ...cardOpts, placeId })
  const f = foldSeriesWithoutRule(all, { appUrl: cardOpts.appUrl, fold })
  const leads = f.cards.filter((c) => c.lead).length
  const absence = all.length ? null : absenceText(mine.length ? 'nodata' : 'notcomputed', placeId, { layerTitle, note, erddapUrl, appUrl: cardOpts.appUrl })
  return { cards: f.cards, first: Math.min(f.cards.length, leads || shownFirst), noStatus: f.line, total: all.length, absence }
}

/** the section's footer line */
export const footerLine = (n: number) =>
  `${n} indicator${n === 1 ? '' : 's'} · statuses are statistical, relative to each place's own record · from the Ocean Metrics indicators catalog`

// ---- rollups: the Matrix summary ----

export interface StatusCounts {
  above: number
  within: number
  below: number
  /** cells with a value and no status (no rule, or too short a record) */
  none: number
  /** cells with coverage rows and no value */
  nodata: number
  /** every cell: place x indicator pairs with coverage rows */
  cells: number
}

export interface Rollup extends StatusCounts {
  /** the place id or the indicator id */
  id: string
  /** the latest period among the cells with a value; null when none has one */
  latest: { time: string; grain: Grain; label: string } | null
}

export interface Rollups { places: Rollup[]; indicators: Rollup[]; total: StatusCounts }

const zero = (): StatusCounts => ({ above: 0, within: 0, below: 0, none: 0, nodata: 0, cells: 0 })

/**
 * the row that stands for a place x indicator cell: the one with a status method and a value (the status grain's), else
 * the first with a value, else the first
 */
function cellRow<R extends Pick<CoverageRow, 'status_method' | 'last_value'>>(rs: R[]): R {
  return rs.find((r) => r.status_method != null && r.last_value != null) ?? rs.find((r) => r.last_value != null) ?? rs[0]
}

/**
 * the counts of above, within, below, no status and no data per place and per indicator (one cell per place x
 * indicator, whatever its grains), and the latest period of each; places and indicators in the order they first appear.
 */
export function rollups(rows: Pick<CoverageRow, 'place_id' | 'indicator' | 'time_grain' | 'last_time' | 'last_value' | 'status_method' | 'status'>[]): Rollups {
  type R = (typeof rows)[number]
  const cells = new Map<string, R[]>()
  for (const r of rows) {
    const k = `${r.place_id}\u0000${r.indicator}`
    cells.set(k, [...(cells.get(k) ?? []), r])
  }
  const places = new Map<string, Rollup>()
  const indicators = new Map<string, Rollup>()
  const total = zero()
  const get = (m: Map<string, Rollup>, id: string) => m.get(id) ?? m.set(id, { id, ...zero(), latest: null }).get(id)!
  for (const rs of cells.values()) {
    const row = cellRow(rs)
    const bucket: keyof StatusCounts = row.last_value == null ? 'nodata' : (row.status ?? 'none')
    for (const c of [get(places, row.place_id), get(indicators, row.indicator), total]) {
      c[bucket]++
      c.cells++
      if (c !== total && row.last_value != null && (row.last_time || row.time_grain === 'all')) {
        const t = row.last_time ?? ''
        const r = c as Rollup
        if (!r.latest || t > r.latest.time) r.latest = { time: t, grain: row.time_grain, label: periodOf(row) }
      }
    }
  }
  return { places: [...places.values()], indicators: [...indicators.values()], total }
}
