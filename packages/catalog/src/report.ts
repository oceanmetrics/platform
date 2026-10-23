// the selection rules of a report, a watch and an alert: which places and which indicators a rule picks. moved from
// oceanmetrics/indicators src/report/spec.ts (0.5.0) so the indicators viewer's Report view, its Node figure job and the
// alerts Worker read a rule the same way. pure functions, no DOM, no fetch.
// - selections are rules, never expanded lists. places: `*`, `coll:<slug>`, `set:<id>` (a place set: its groups) or a
//   place_id. indicators: `*` (each series' lead), `all` (every indicator), `cat:<term>`, `series:<id>` (its lead),
//   `series:<id>:*` (every member) or an id. each untick goes in `exclude`. a live report (or a subscription) picks up
//   what is published later.
// - in a URL the rules are the flat keys `pi`, `px`, `ii`, `ix` (comma lists); the defaults (`coll:places`, `*`) write
//   nothing. the report's other keys (layout, style, time) stay in the indicators repo's spec.

/** one axis of a selection: include rules, then exclude rules */
export interface RuleSet { include: string[]; exclude: string[] }

/** a selection: the places and indicators rules of a report spec, a watch or a subscription */
export interface Rules { places: RuleSet; indicators: RuleSet }

/** the default selection: the sanctuaries (`coll:places`) and each series' lead (`*`) */
export const DEFAULT_RULES: Rules = { places: { include: ['coll:places'], exclude: [] }, indicators: { include: ['*'], exclude: [] } }

export interface IndicatorLike {
  id: string
  series: string
  lead: boolean
  /** the vocabulary tags `cat:<term>` matches (onms, names, eov ...) */
  category?: Partial<Record<string, string>>
}

export interface PlaceLike {
  id: string
  /** the place's group: its home gazetteer collection */
  coll: string
  /** the values collections that hold rows of it (a place can be in two) */
  valuesColls?: string[]
}

/** a place set, as the rules need it: `set:<id>` stands for its groups */
export interface PlaceSetLike {
  id: string
  groups: readonly string[]
}

// ---- the URL form ----

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** the rules from the decoded keys `pi px ii ix` of a URL; an absent include is the default's */
export function rulesFromParams(kv: Map<string, string>, d: Rules = DEFAULT_RULES): Rules {
  const pi = list(kv.get('pi')), ii = list(kv.get('ii'))
  return {
    places: { include: pi.length ? pi : [...d.places.include], exclude: list(kv.get('px')) },
    indicators: { include: ii.length ? ii : [...d.indicators.include], exclude: list(kv.get('ix')) },
  }
}

/** the rules' keys for a URL, in the order `pi px ii ix`, defaults left out */
export function rulesParams(r: Rules, d: Rules = DEFAULT_RULES): [string, string][] {
  const out: [string, string][] = []
  if (!same(r.places.include, d.places.include)) out.push(['pi', r.places.include.join(',')])
  if (r.places.exclude.length) out.push(['px', r.places.exclude.join(',')])
  if (!same(r.indicators.include, d.indicators.include)) out.push(['ii', r.indicators.include.join(',')])
  if (r.indicators.exclude.length) out.push(['ix', r.indicators.exclude.join(',')])
  return out
}

// ---- expanding the rules ----

/** each series' lead (its first member when none is marked), keyed by series */
export function seriesLeads<T extends IndicatorLike>(indicators: T[]): Map<string, T> {
  const out = new Map<string, T>()
  for (const i of indicators) if (i.lead && !out.has(i.series)) out.set(i.series, i)
  for (const i of indicators) if (!out.has(i.series)) out.set(i.series, i)
  return out
}

/** the indicators one rule selects (in manifest order) */
export function matchIndicators<T extends IndicatorLike>(rule: string, indicators: T[]): T[] {
  const leads = new Set(seriesLeads(indicators).values())
  if (rule === 'all') return indicators
  if (rule === '*') return indicators.filter((i) => leads.has(i))
  if (rule.startsWith('cat:')) {
    const term = rule.slice(4)
    return indicators.filter((i) => leads.has(i) && Object.values(i.category ?? {}).includes(term))
  }
  if (rule.startsWith('series:')) {
    const all = rule.endsWith(':*')
    const id = all ? rule.slice(7, -2) : rule.slice(7)
    return indicators.filter((i) => i.series === id && (all || leads.has(i)))
  }
  return indicators.filter((i) => i.id === rule)
}

/** include rules, then exclude rules (which may also be rules: `series:x:*` drops a whole series), manifest order */
export function expandIndicators<T extends IndicatorLike>(sel: RuleSet, indicators: T[]): T[] {
  const inc = new Set(sel.include.flatMap((r) => matchIndicators(r, indicators)))
  const exc = new Set(sel.exclude.flatMap((r) => matchIndicators(r, indicators)))
  return indicators.filter((i) => inc.has(i) && !exc.has(i))
}

/**
 * the places one rule selects: `*`, `coll:<slug>`, `set:<id>` (the groups of the place set, from `sets`; an unknown set
 * selects nothing) or a place_id. `coll:<slug>` matches a place whose group (home gazetteer collection) is the slug; when no
 * place has that group, it matches the places any of whose values collections is the slug, so a link written when places
 * were grouped by their values file still selects the same places.
 */
export function matchPlaces<P extends PlaceLike>(rule: string, places: P[], sets: readonly PlaceSetLike[] = []): P[] {
  if (rule === '*') return places
  if (rule.startsWith('set:')) {
    const set = sets.find((s) => `set:${s.id}` === rule)
    return set ? places.filter((p) => set.groups.includes(p.coll)) : []
  }
  if (rule.startsWith('coll:')) {
    const slug = rule.slice(5)
    if (places.some((p) => p.coll === slug)) return places.filter((p) => p.coll === slug)
    return places.filter((p) => (p.valuesColls ?? []).includes(slug))
  }
  return places.filter((p) => p.id === rule)
}

/** include rules, then exclude rules, in the order of `places` (the caller sorts) */
export function expandPlaces<P extends PlaceLike>(sel: RuleSet, places: P[], sets: readonly PlaceSetLike[] = []): P[] {
  const inc = new Set(sel.include.flatMap((r) => matchPlaces(r, places, sets)))
  const exc = new Set(sel.exclude.flatMap((r) => matchPlaces(r, places, sets)))
  return places.filter((p) => inc.has(p) && !exc.has(p))
}

// ---- rows: what a watch picks from a change file or a coverage table ----

/** a row the rules can pick: a coverage row or a change row */
export interface RuleRow {
  place_id: string
  /** the values collection */
  coll: string
  /** the place's home collection, its group; the values `coll` when absent */
  place_coll?: string | null
  indicator: string
}

export interface RuleContext {
  /** the manifest's indicators (`*`, `cat:` and `series:` need their series, lead and tags) */
  indicators: IndicatorLike[]
  /** the manifest's place sets, for `set:<id>` */
  sets?: readonly PlaceSetLike[]
}

/**
 * the rows the rules select, in their order: the places of the rows (grouped by `place_coll ?? coll`, read from their
 * values `coll`) expanded as the Report view expands them, crossed with the indicators the rules expand to. an indicator
 * the manifest does not list is never selected.
 */
export function selectRows<R extends RuleRow>(rules: Rules, rows: R[], ctx: RuleContext): R[] {
  const places = new Map<string, PlaceLike & { valuesColls: string[] }>()
  for (const r of rows) {
    const p = places.get(r.place_id) ?? places.set(r.place_id, { id: r.place_id, coll: r.place_coll ?? r.coll, valuesColls: [] }).get(r.place_id)!
    if (!p.valuesColls.includes(r.coll)) p.valuesColls.push(r.coll)
  }
  const placeIds = new Set(expandPlaces(rules.places, [...places.values()], ctx.sets).map((p) => p.id))
  const indIds = new Set(expandIndicators(rules.indicators, ctx.indicators).map((i) => i.id))
  return rows.filter((r) => placeIds.has(r.place_id) && indIds.has(r.indicator))
}

/** whether the rules select one row (a `coll:` rule reads the row's own group, as `selectRows` on that row alone) */
export const matchesRules = (rules: Rules, row: RuleRow, ctx: RuleContext): boolean => selectRows(rules, [row], ctx).length > 0
