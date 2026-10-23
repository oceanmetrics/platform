// what changed between two builds of the indicators catalog, one implementation for the change files, the Atom feeds,
// the alert mails and the front page: diffCoverage (two coverage tables -> change rows), changeSentence (the one
// wording), atomFeed (RFC 4287, a string builder, no DOM) and feedsFor (which feed holds which rows). pure functions
// over coverage and change rows; the indicators repo reads and writes the files. the words come from
// @oceanmetrics/status and the cards: a status is relative to the place's own record, never better or worse.
import { fmt, STATUS_WORDS } from '@oceanmetrics/status'
import type { Grain, Status } from '@oceanmetrics/status'
import { periodOf, pickRow, placeViewHref, slash } from './cards.js'
import { DEFAULT_INDICATORS_BASE, INDICATORS_APP } from './manifest.js'
import type { CoverageRow, IndicatorsManifest, ManifestIndicator } from './manifest.js'
import type { PlaceSetLike } from './report.js'

// ---- the change row (schemas/changes-row.schema.json) ----

/** what changed at a place x indicator: its status word, a later period, or its first value */
export type ChangeKind = 'status' | 'new' | 'period'
export const CHANGE_KINDS: readonly ChangeKind[] = ['status', 'new', 'period']

/** one row of a change file: one place x indicator, read at the card's row (the status grain first, as pickRow) */
export interface ChangeRow {
  place_id: string
  place_name?: string | null
  /** the values collection the row was read from */
  coll: string
  /** the place's home collection (its group); readers use `place_coll ?? coll` */
  place_coll?: string | null
  indicator: string
  kind: ChangeKind
  time_grain: Grain
  from_status: Status | null
  to_status: Status | null
  /** the last period before and after (first day of the period); from_time is null for a `new` row */
  from_time: string | null
  to_time: string | null
  /** the last value after the change */
  value: number | null
  unit: string | null
  /** changeSentence: the one wording for a feed entry, a mail line and the front page */
  sentence: string
  /** the build date the change was seen, YYYY-MM-DD */
  seen: string
}

/** the coverage columns a diff reads */
export type DiffRow = Pick<CoverageRow, 'place_id' | 'coll' | 'indicator' | 'time_grain' | 'last_time' | 'last_value' | 'status_method' | 'status'>
  & { place_name?: string | null; place_coll?: string | null }

export interface DiffOptions {
  /** the build date written as `seen`; today (UTC) by default */
  seen?: string
  /** the new build's manifest: the card row's grain, and the titles, units and decimals of the sentences */
  manifest?: Pick<IndicatorsManifest, 'indicators'>
}

const key = (r: Pick<DiffRow, 'place_id' | 'coll' | 'indicator'>) => `${r.place_id}\u0000${r.coll}\u0000${r.indicator}`

function cells<R extends DiffRow>(rows: R[]): Map<string, R[]> {
  const out = new Map<string, R[]>()
  for (const r of rows) {
    const k = key(r)
    const rs = out.get(k)
    if (rs) rs.push(r)
    else out.set(k, [r])
  }
  return out
}

/** the card's row of a cell: pickRow at the manifest's status grain, else at the grain of the row with a status method */
function cardRow<R extends DiffRow>(rs: R[] | undefined, ind: Pick<ManifestIndicator, 'status_grain'> | undefined): R | null {
  if (!rs) return null
  const status_grain = ind?.status_grain ?? rs.find((r) => r.status_method != null)?.time_grain ?? 'year'
  return pickRow(rs, { status_grain })
}

/**
 * the changes from one coverage table to the next: one row per place x indicator (x values collection) whose card row
 * gained its first value (`new`), whose status word changed (`status`: a word to another, a first word, or a word
 * lost) or whose latest period advanced (`period`), in that order of precedence, so a cell gives at most one row. a
 * cell that lost its values gives none. rows in the order of `after`.
 */
export function diffCoverage(before: DiffRow[], after: DiffRow[], opts: DiffOptions = {}): ChangeRow[] {
  const seen = opts.seen ?? new Date().toISOString().slice(0, 10)
  const inds = new Map((opts.manifest?.indicators ?? []).map((i) => [i.id, i]))
  const prev = cells(before)
  const out: ChangeRow[] = []
  for (const [k, rs] of cells(after)) {
    const ind = inds.get(rs[0].indicator)
    const a = cardRow(rs, ind)
    if (!a) continue
    const b = cardRow(prev.get(k), ind)
    let kind: ChangeKind | null = null
    if (!b) kind = 'new'
    else if ((a.status ?? null) !== (b.status ?? null)) kind = 'status'
    else if (a.time_grain !== b.time_grain || (a.last_time ?? '') > (b.last_time ?? '')) kind = 'period'
    if (!kind) continue
    const row: Omit<ChangeRow, 'sentence'> = {
      place_id: a.place_id, place_name: a.place_name ?? null, coll: a.coll, place_coll: a.place_coll ?? null, indicator: a.indicator,
      kind, time_grain: a.time_grain, from_status: b?.status ?? null, to_status: a.status ?? null,
      from_time: b?.last_time ?? null, to_time: a.last_time ?? null, value: a.last_value ?? null,
      unit: ind ? (ind.unit_label ?? ind.unit ?? null) : null, seen,
    }
    out.push({ ...row, sentence: changeSentence(row, opts.manifest) })
  }
  return out
}

// ---- the words ----

const W = (s: Status) => STATUS_WORDS[s]

/**
 * the one wording of a change, for a feed entry, a mail line and the front page: the indicator, the place, what
 * changed and the period, in the card's words ("above its own record"). never better or worse.
 */
export function changeSentence(row: Omit<ChangeRow, 'sentence'>, manifest?: Pick<IndicatorsManifest, 'indicators'>): string {
  const ind = manifest?.indicators.find((i) => i.id === row.indicator)
  const what = `${ind?.title ?? row.indicator} in ${row.place_name || row.place_id}`
  const period = periodOf({ last_time: row.to_time, time_grain: row.time_grain })
  const unit = row.unit ?? (ind ? (ind.unit_label ?? ind.unit ?? '') : '')
  const value = row.value == null || ind?.kind === 'categorical' ? '' : `${fmt(row.value, ind?.decimals ?? 2)}${unit ? ` ${unit}` : ''}`
  switch (row.kind) {
    case 'new':
      return value ? `${what} has its first value: ${value} for ${period}.` : `${what} has its first value, for ${period}.`
    case 'period': {
      const was = row.from_time ? periodOf({ last_time: row.from_time, time_grain: row.time_grain }) : ''
      return `${what} has a value for ${period}${value ? `: ${value}` : ''}${was && was !== period ? `; the last was for ${was}` : ''}.`
    }
    case 'status':
      if (!row.from_status && row.to_status) return `${what} has its first status: ${W(row.to_status)} (${period}).`
      if (row.from_status && !row.to_status) return `${what} no longer has a status (${period}); it was ${W(row.from_status)}.`
      return `${what} is now ${W(row.to_status!)} (${period}); it was ${W(row.from_status!)}.`
  }
}

/** the rows of each kind */
export function countKinds(rows: Pick<ChangeRow, 'kind'>[]): Record<ChangeKind, number> {
  const out: Record<ChangeKind, number> = { status: 0, new: 0, period: 0 }
  for (const r of rows) out[r.kind]++
  return out
}

/** the identity of a change: its date, cell and kind */
export const changeKey = (r: Pick<ChangeRow, 'seen' | 'place_id' | 'coll' | 'indicator' | 'kind'>) => `${r.seen}\u0000${r.place_id}\u0000${r.coll}\u0000${r.indicator}\u0000${r.kind}`

/** two runs' rows as one, deduplicated by changeKey (the first kept: a re-run on the same day adds only what is new) */
export function mergeChanges(...lists: ChangeRow[][]): ChangeRow[] {
  const seen = new Set<string>()
  const out: ChangeRow[] = []
  for (const r of lists.flat()) {
    const k = changeKey(r)
    if (!seen.has(k)) { seen.add(k); out.push(r) }
  }
  return out
}

// ---- Atom (RFC 4287) ----

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
/** ids keep their colons readable (as the indicators app writes them) */
const enc = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ':')

/** the entry id of a change: stable across rebuilds of its feed, the same in every feed that holds it */
export const entryId = (r: Pick<ChangeRow, 'seen' | 'place_id' | 'coll' | 'indicator' | 'kind'>) =>
  `tag:oceanmetrics.io,2026:changes/${r.seen}/${enc(r.place_id)}/${enc(r.coll)}/${enc(r.indicator)}/${r.kind}`

export interface AtomOptions {
  title: string
  /** the feed's own id, an IRI (e.g. `tag:oceanmetrics.io,2026:feeds/all`) */
  id: string
  /** the feed's updated time, RFC 3339 */
  updated: string
  /** the page the feed is about (rel=alternate) */
  link: string
  /** the feed's own url (rel=self) */
  self?: string
  subtitle?: string
  /** the most entries, newest first (100) */
  max?: number
  /** the indicators app an entry links to */
  appUrl?: string
}

/** an Atom feed of change rows: one entry per change, newest first, each linking the place's view of its indicator */
export function atomFeed(rows: ChangeRow[], opts: AtomOptions): string {
  const { title, id, updated, link, self, subtitle, max = 100, appUrl = INDICATORS_APP } = opts
  const entries = rows.map((r, i) => [r, i] as const).sort((a, b) => b[0].seen.localeCompare(a[0].seen) || a[1] - b[1]).slice(0, max).map(([r]) => r)
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${esc(id)}</id>`,
    `  <title>${esc(title)}</title>`,
    ...(subtitle ? [`  <subtitle>${esc(subtitle)}</subtitle>`] : []),
    `  <updated>${esc(updated)}</updated>`,
    '  <author><name>Ocean Metrics</name><uri>https://oceanmetrics.io/</uri></author>',
    ...(self ? [`  <link rel="self" type="application/atom+xml" href="${esc(self)}"/>`] : []),
    `  <link rel="alternate" type="text/html" href="${esc(link)}"/>`,
  ]
  for (const r of entries) {
    out.push(
      '  <entry>',
      `    <id>${esc(entryId(r))}</id>`,
      `    <title>${esc(r.sentence)}</title>`,
      `    <updated>${r.seen}T00:00:00Z</updated>`,
      `    <link rel="alternate" type="text/html" href="${esc(placeViewHref(r.place_id, r.coll, r.indicator, appUrl))}"/>`,
      `    <category term="${r.kind}"/>`,
      `    <summary type="text">${esc(`${r.sentence} (${r.place_id}, ${r.indicator}, ${r.coll}, seen ${r.seen})`)}</summary>`,
      '  </entry>',
    )
  }
  out.push('</feed>', '')
  return out.join('\n')
}

// ---- which feeds ----

export type FeedKind = 'all' | 'coll' | 'set' | 'place'

/** the places the feeds are for, with their sets and collection titles */
export interface FeedsPlaces {
  /** every place with a feed (a place with no change yet gets an empty one, so a link never 404s) */
  places: { id: string; name?: string | null; coll: string }[]
  sets?: (PlaceSetLike & { title?: string })[]
  /** collection slug -> title */
  colls?: Record<string, string>
}

export interface FeedSpec {
  kind: FeedKind
  /** the place id, collection slug or set id; `all` for all */
  id: string
  /** the file under feeds/: `all.xml`, `coll=<slug>.xml`, `set=<id>.xml`, `place=<id>.xml` */
  file: string
  href: string
  /** the feed's id (tag:) */
  feedId: string
  title: string
  /** where the feed's alternate link points */
  link: string
  rows: ChangeRow[]
}

/** a feed's file name: the id with any character outside [A-Za-z0-9:._-] as `_` */
export const feedFile = (kind: FeedKind, id: string) => (kind === 'all' ? 'all.xml' : `${kind}=${id.replace(/[^A-Za-z0-9:._-]/g, '_')}.xml`)

export interface FeedsOptions {
  /** the catalog root the feeds are published under (`<base>feeds/<file>`) */
  base?: string
  appUrl?: string
}

/**
 * the feeds of the change rows: all, one per collection, one per place set and one per place of `index`, each with the
 * rows it holds (in their order). a row's group is its place's collection in the index, else `place_coll ?? coll`.
 */
export function feedsFor(rows: ChangeRow[], index: FeedsPlaces, opts: FeedsOptions = {}): FeedSpec[] {
  const base = slash(opts.base ?? DEFAULT_INDICATORS_BASE)
  const app = slash(opts.appUrl ?? INDICATORS_APP)
  const home = new Map(index.places.map((p) => [p.id, p.coll]))
  const group = (r: ChangeRow) => home.get(r.place_id) ?? r.place_coll ?? r.coll
  const spec = (kind: FeedKind, id: string, title: string, link: string, rs: ChangeRow[]): FeedSpec => {
    const file = feedFile(kind, id)
    return { kind, id, file, href: `${base}feeds/${file}`, feedId: `tag:oceanmetrics.io,2026:feeds/${file.replace(/\.xml$/, '')}`, title, link, rows: rs }
  }
  const T = (s: string) => `Ocean Metrics indicators: ${s}`
  const colls = [...new Set([...index.places.map((p) => p.coll), ...rows.map(group)])]
  const byPlace = new Map<string, ChangeRow[]>()
  for (const r of rows) byPlace.set(r.place_id, [...(byPlace.get(r.place_id) ?? []), r])
  return [
    spec('all', 'all', T('all changes'), app, rows),
    ...colls.map((c) => spec('coll', c, T(index.colls?.[c] ?? c), `${app}#pi=coll:${c}`, rows.filter((r) => group(r) === c))),
    ...(index.sets ?? []).map((s) => spec('set', s.id, T(s.title ?? s.id), `${app}#pi=set:${s.id}`, rows.filter((r) => s.groups.includes(group(r))))),
    ...index.places.map((p) => spec('place', p.id, T(p.name || p.id), placeViewHref(p.id, null, null, app), byPlace.get(p.id) ?? [])),
  ]
}

/** the feeds' index (schemas/feeds-index.schema.json): each feed's href, title and the time of its newest entry */
export function feedsIndex(feeds: FeedSpec[], updated: string) {
  return {
    updated,
    feeds: feeds.map((f) => {
      const last = f.rows.reduce<string | null>((m, r) => (m == null || r.seen > m ? r.seen : m), null)
      return { kind: f.kind, id: f.id, href: f.href, title: f.title, updated: last ? `${last}T00:00:00Z` : null, entries: Math.min(f.rows.length, 100) }
    }),
  }
}
