// what a subscriber may ask for: an address, the report's rules, kinds, a cadence, a title ----
import { DEFAULT_RULES, rulesFromParams } from '@oceanmetrics/catalog/report'
import { DEFAULT_KINDS, KINDS } from './env.js'
import type { Cadence, Kind, Rules, Source } from './env.js'
import { HttpError } from './http.js'

/** an address: one @, a dot in the domain, no spaces, 254 characters at most (RFC 5321) */
export function validEmail(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length <= 254 && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(v.trim())
}

const RULE = /^[^@,\s]{1,120}$/
const MAX_RULES = 50

function ruleList(v: unknown, what: string): string[] {
  if (v == null) return []
  const list = typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v
  if (!Array.isArray(list) || list.length > MAX_RULES || !list.every((r) => typeof r === 'string' && RULE.test(r)))
    throw new HttpError(400, 'bad_rules', `${what}: up to ${MAX_RULES} rules, each without spaces, commas or @`)
  return [...new Set(list as string[])]
}

/**
 * the rules of a subscribe or manage call, in one of three forms: `rules` (`{places:{include,exclude},
 * indicators:{include,exclude}}`), `params` (the report's URL keys `pi px ii ix`, as the alerts page reads them from
 * its query) or `place` (one place id, from a Place page). absent: the default rules (the sanctuaries, each series' lead).
 */
export function readRules(body: Record<string, unknown>): Rules {
  if (body.rules != null) {
    const r = body.rules as Partial<Record<'places' | 'indicators', Partial<Record<'include' | 'exclude', unknown>>>>
    if (typeof r !== 'object') throw new HttpError(400, 'bad_rules', 'rules must be an object')
    const out: Rules = {
      places: { include: ruleList(r.places?.include, 'places.include'), exclude: ruleList(r.places?.exclude, 'places.exclude') },
      indicators: { include: ruleList(r.indicators?.include, 'indicators.include'), exclude: ruleList(r.indicators?.exclude, 'indicators.exclude') },
    }
    if (!out.places.include.length) out.places.include = [...DEFAULT_RULES.places.include]
    if (!out.indicators.include.length) out.indicators.include = [...DEFAULT_RULES.indicators.include]
    return out
  }
  if (body.params != null) {
    const p = body.params as Record<string, unknown>
    if (typeof p !== 'object') throw new HttpError(400, 'bad_rules', 'params must be an object of pi, px, ii, ix')
    const kv = new Map<string, string>()
    for (const k of ['pi', 'px', 'ii', 'ix']) {
      if (p[k] == null) continue
      kv.set(k, ruleList(p[k], k).join(','))
    }
    return rulesFromParams(kv)
  }
  if (body.place != null) {
    const place = ruleList(body.place, 'place')
    if (place.length !== 1) throw new HttpError(400, 'bad_rules', 'place is one place id')
    return { places: { include: place, exclude: [] }, indicators: { include: [...DEFAULT_RULES.indicators.include], exclude: [] } }
  }
  return { places: { include: [...DEFAULT_RULES.places.include], exclude: [] }, indicators: { include: [...DEFAULT_RULES.indicators.include], exclude: [] } }
}

export function readKinds(v: unknown): Kind[] {
  if (v == null) return [...DEFAULT_KINDS]
  if (!Array.isArray(v) || !v.length || !v.every((k) => (KINDS as readonly string[]).includes(k)))
    throw new HttpError(400, 'bad_kinds', `kinds: one or more of ${KINDS.join(', ')}`)
  return KINDS.filter((k) => v.includes(k))
}

export function readCadence(v: unknown): Cadence {
  if (v == null) return 'daily'
  if (v !== 'daily' && v !== 'weekly') throw new HttpError(400, 'bad_cadence', 'cadence: daily or weekly')
  return v
}

export function readTitle(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || v.length > 200 || v.includes('@')) throw new HttpError(400, 'bad_title', 'title: 200 characters at most, no @')
  return v.trim() || null
}

export function readSource(v: unknown): Source {
  if (v == null) return 'alerts'
  if (v !== 'place' && v !== 'report' && v !== 'alerts') throw new HttpError(400, 'bad_source', 'source: place, report or alerts')
  return v
}

/** the watch in words, for the mails: the title, else the rules */
export function watchWords(s: { title?: string | null; rules: Rules }): string {
  if (s.title) return s.title
  const p = s.rules.places, i = s.rules.indicators
  const places = p.include.map((r) => (r === 'coll:places' ? 'the national marine sanctuaries' : r === '*' ? 'every place' : r.replace(/^coll:/, 'collection ').replace(/^set:/, 'place set '))).join(', ')
  const inds = i.include.map((r) => (r === '*' ? 'each series’ lead indicator' : r === 'all' ? 'every indicator' : r)).join(', ')
  const ex = [...p.exclude, ...i.exclude]
  return `${inds} at ${places}${ex.length ? ` (except ${ex.join(', ')})` : ''}`
}
