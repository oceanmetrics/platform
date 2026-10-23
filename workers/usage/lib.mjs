// usage: the query builder, the collector and the Markdown renderer for the weekly usage numbers ----
// pure except `collect` (which takes a fetch function) so each is testable on a fixture. the Analytics Engine layouts
// follow the Workers' own comments: places/worker/src/meter.ts (om_gazetteer) and workers/alerts/src/http.ts (om_alerts).
//   om_gazetteer: index1 key id or `anon`; blob1 key id ('' keyless); blob2 app; blob3 class; blob4 origin; blob5 tier;
//                 blob6 method; blob7 object path; blob8 prefix; double1 bytes; double2 http status
//   om_alerts:    index1 route; blob1 route; blob2 outcome; blob3 provider; blob4 origin; double1 http status; double2 count

export const ACCOUNT_ID = 'af075785741eb60e6e4d482a71fa592d'
export const GAZETTEER_DATASET = 'om_gazetteer'
export const ALERTS_DATASET = 'om_alerts'

/** the catalogs, in the order the table lists them */
export const PREFIXES = ['gazetteer', 'indicators', 'atlas', 'obis-h3', 'basemap', 'marine-atlas']
/** the restricted bucket, reported apart from the catalogs */
export const UNLISTED = 'unlisted'
/** the windows, in days */
export const WINDOWS = { '7d': 7, '30d': 30 }
export const TOP_KEYS = 5

export const sqlUrl = (account = ACCOUNT_ID) => `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`

// escaping ----

/** a SQL string literal: backslash and single quote escaped, control characters and NUL refused */
export function lit(s) {
  const v = String(s)
  if (/[\u0000-\u001f]/.test(v)) throw new Error('control character in a SQL string')
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** a dataset name: letters, digits and underscore only (it is not quotable) */
export function ident(s) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`bad dataset name: ${s}`)
  return s
}

// windows ----

const pad = (n) => String(n).padStart(2, '0')

/** `YYYY-MM-DD HH:MM:SS` in UTC, the form `toDateTime()` takes */
export function dt(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** the half-open window [from, to) of the last `days` days ending at `now`, whole seconds, UTC */
export function windowOf(now, days) {
  const to = new Date(Math.floor(now.getTime() / 1000) * 1000)
  const from = new Date(to.getTime() - days * 86_400_000)
  return { from: dt(from), to: dt(to), days }
}

const where = (w, ...more) =>
  ['WHERE timestamp >= toDateTime(' + lit(w.from) + ')', 'timestamp < toDateTime(' + lit(w.to) + ')', ...more].join(' AND ')

// queries: om_gazetteer ----

/** one prefix: requests, bytes, the 200s, the 206s, the keyed requests */
export function prefixSummary(prefix, w, ds = GAZETTEER_DATASET) {
  return `SELECT SUM(_sample_interval) AS requests, SUM(_sample_interval * double1) AS bytes, ` +
    `SUM(IF(double2 = 200, _sample_interval, 0)) AS r200, SUM(IF(double2 = 206, _sample_interval, 0)) AS r206, ` +
    `SUM(IF(blob1 != '', _sample_interval, 0)) AS keyed ` +
    `FROM ${ident(ds)} ${where(w, 'blob8 = ' + lit(prefix))} FORMAT JSON`
}

/** one prefix: the keys with the most requests (keyless requests are the anonymous share, not a key) */
export function prefixTopKeys(prefix, w, limit = TOP_KEYS, ds = GAZETTEER_DATASET) {
  return `SELECT blob1 AS key, blob2 AS app, SUM(_sample_interval) AS requests, SUM(_sample_interval * double1) AS bytes ` +
    `FROM ${ident(ds)} ${where(w, 'blob8 = ' + lit(prefix), "blob1 != ''")} ` +
    `GROUP BY key, app ORDER BY requests DESC LIMIT ${Math.max(1, Math.floor(limit))} FORMAT JSON`
}

/** the errors (status 400 and over) by prefix and status, every prefix */
export function errorsByStatus(w, ds = GAZETTEER_DATASET) {
  return `SELECT blob8 AS prefix, double2 AS status, SUM(_sample_interval) AS requests ` +
    `FROM ${ident(ds)} ${where(w, 'double2 >= 400')} GROUP BY prefix, status ORDER BY requests DESC FORMAT JSON`
}

/** the prefixes that are neither a catalog nor `unlisted` (issues, atlas-restricted, root, backups probing) */
export function otherPrefixes(known, w, ds = GAZETTEER_DATASET) {
  const list = known.map(lit).join(', ')
  return `SELECT blob8 AS prefix, SUM(_sample_interval) AS requests, SUM(_sample_interval * double1) AS bytes ` +
    `FROM ${ident(ds)} ${where(w, `blob8 NOT IN (${list})`)} GROUP BY prefix ORDER BY requests DESC FORMAT JSON`
}

// queries: om_alerts ----

/** route and outcome counts: calls, and the summed `double2` (rows of a digest, subscriptions ended) */
export function alertRoutes(w, ds = ALERTS_DATASET) {
  return `SELECT blob1 AS route, blob2 AS outcome, SUM(_sample_interval) AS calls, SUM(_sample_interval * double2) AS total ` +
    `FROM ${ident(ds)} ${where(w)} GROUP BY route, outcome ORDER BY calls DESC FORMAT JSON`
}

/** the digests sent: route `send`, outcome `digest` (one point per mail; `double2` is its rows) */
export function digestsSent(w, ds = ALERTS_DATASET) {
  return `SELECT SUM(_sample_interval) AS mails, SUM(_sample_interval * double2) AS rows ` +
    `FROM ${ident(ds)} ${where(w, "blob1 = 'send'", "blob2 = 'digest'")} FORMAT JSON`
}

/**
 * every query of the report, labelled
 * @typedef {{ id: string, window: string, dataset: string, prefix?: string, sql: string }} Query
 * @param {Date} now
 * @param {{ prefixes?: string[], unlisted?: string, windows?: Record<string, number>, top?: number }} [opts]
 * @returns {Query[]}
 */
export function buildQueries(now, { prefixes = PREFIXES, unlisted = UNLISTED, windows = WINDOWS, top = TOP_KEYS } = {}) {
  /** @type {Query[]} */
  const out = []
  for (const [name, days] of Object.entries(windows)) {
    const w = windowOf(now, days)
    const base = { window: name }
    for (const p of [...prefixes, unlisted]) {
      out.push({ ...base, id: 'summary', dataset: GAZETTEER_DATASET, prefix: p, sql: prefixSummary(p, w) })
      if (p !== unlisted) out.push({ ...base, id: 'top_keys', dataset: GAZETTEER_DATASET, prefix: p, sql: prefixTopKeys(p, w, top) })
    }
    out.push({ ...base, id: 'errors', dataset: GAZETTEER_DATASET, sql: errorsByStatus(w) })
    out.push({ ...base, id: 'other', dataset: GAZETTEER_DATASET, sql: otherPrefixes([...prefixes, unlisted], w) })
    out.push({ ...base, id: 'alert_routes', dataset: ALERTS_DATASET, sql: alertRoutes(w) })
    out.push({ ...base, id: 'digests', dataset: ALERTS_DATASET, sql: digestsSent(w) })
  }
  return out
}

/** the value of `name` in an env file (`NAME=value`, optional `export ` and quotes); '' if absent */
export function envFileValue(text, name) {
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return ''
}

// the API ----

/** POST one query; the rows of `data`. the token goes in the header only and is never in an error */
export async function runSql(sql, { token, account = ACCOUNT_ID, fetchFn = fetch }) {
  const res = await fetchFn(sqlUrl(account), { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: sql })
  const text = await res.text()
  if (!res.ok) throw new Error(`analytics engine sql ${res.status}: ${text.slice(0, 300)}`)
  let body
  try { body = JSON.parse(text) } catch { throw new Error(`analytics engine sql: not JSON: ${text.slice(0, 100)}`) }
  return Array.isArray(body.data) ? body.data : []
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/**
 * run every query (one at a time) and fold the rows into the report
 * @param {Date} now
 * @param {{ token: string, account?: string, fetchFn?: typeof fetch, windows?: Record<string, number>, prefixes?: string[], unlisted?: string, top?: number }} opts
 */
export async function collect(now, opts) {
  const { token, account, fetchFn } = opts
  const report = { generated: now.toISOString(), account, windows: {}, gazetteer: {}, alerts: {} }
  for (const q of buildQueries(now, opts)) {
    const prefix = q.prefix ?? ''
    const rows = await runSql(q.sql, { token, account, fetchFn })
    report.windows[q.window] ??= windowOf(now, (opts.windows ?? WINDOWS)[q.window])
    const g = (report.gazetteer[q.window] ??= { prefixes: {}, errors: [], other: [] })
    const a = (report.alerts[q.window] ??= { routes: [], digests: { mails: 0, rows: 0 } })
    if (q.id === 'summary') {
      const r = rows[0] ?? {}
      const requests = num(r.requests)
      g.prefixes[prefix] = { ...(g.prefixes[prefix] ?? {}), requests, bytes: num(r.bytes), r200: num(r.r200), r206: num(r.r206),
        keyed: num(r.keyed), top_keys: g.prefixes[prefix]?.top_keys ?? [] }
    } else if (q.id === 'top_keys') {
      const top_keys = rows.map((r) => ({ key: String(r.key), app: String(r.app ?? ''), requests: num(r.requests), bytes: num(r.bytes) }))
      g.prefixes[prefix] = { ...(g.prefixes[prefix] ?? {}), top_keys }
    } else if (q.id === 'errors') {
      g.errors = rows.map((r) => ({ prefix: String(r.prefix), status: num(r.status), requests: num(r.requests) }))
    } else if (q.id === 'other') {
      g.other = rows.map((r) => ({ prefix: String(r.prefix), requests: num(r.requests), bytes: num(r.bytes) }))
    } else if (q.id === 'alert_routes') {
      a.routes = rows.map((r) => ({ route: String(r.route), outcome: String(r.outcome), calls: num(r.calls), total: num(r.total) }))
    } else if (q.id === 'digests') {
      a.digests = { mails: num(rows[0]?.mails), rows: num(rows[0]?.rows) }
    }
  }
  return report
}

// the Markdown table ----

/** bytes as KiB, MiB, GiB or TiB with one decimal */
export function fmtBytes(n) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = n, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${units[i]}`
}

/** a share as a percent with one decimal; `-` when there is nothing to divide */
export const pct = (part, whole) => (whole > 0 ? `${(100 * part / whole).toFixed(1)}%` : '-')

const int = (n) => Math.round(n).toLocaleString('en-US')
const row = (cells) => `| ${cells.join(' | ')} |`
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n')

/** the Markdown of a report: per window, the prefix table, the top keys, errors, other prefixes and the alerts */
/** @param {any} report @param {{ prefixes?: string[], unlisted?: string, only?: string }} [opts] */
export function renderMarkdown(report, { prefixes = PREFIXES, unlisted = UNLISTED, only } = {}) {
  const parts = [`# Ocean Metrics usage, generated ${report.generated}`]
  for (const name of Object.keys(report.windows)) {
    if (only && name !== only) continue
    const w = report.windows[name]
    const g = report.gazetteer[name], a = report.alerts[name]
    parts.push(`## Last ${w.days} days (${w.from} to ${w.to} UTC)`)
    const list = [...prefixes, unlisted]
    parts.push(table(
      ['prefix', 'requests', 'bytes', '206 share', 'keyed', 'anonymous'],
      list.map((p) => {
        const s = g.prefixes[p] ?? { requests: 0, bytes: 0, r200: 0, r206: 0, keyed: 0 }
        return [p === unlisted ? `${p} (restricted)` : p, int(s.requests), fmtBytes(s.bytes), pct(s.r206, s.r200 + s.r206),
          pct(s.keyed, s.requests), pct(s.requests - s.keyed, s.requests)]
      })))
    parts.push('206 share is 206 of (200 + 206); keyed and anonymous are shares of all requests.')
    const keys = prefixes.flatMap((p) => (g.prefixes[p]?.top_keys ?? []).map((k) => [p, `\`${k.key}\``, k.app || '-', int(k.requests), fmtBytes(k.bytes)]))
    parts.push(`### Top keys per prefix`, keys.length ? table(['prefix', 'key', 'app', 'requests', 'bytes'], keys) : 'No keyed requests.')
    parts.push(`### Errors by status`, g.errors.length
      ? table(['prefix', 'status', 'requests'], g.errors.map((e) => [e.prefix, String(e.status), int(e.requests)])) : 'No errors.')
    parts.push(`### Other prefixes`, g.other.length
      ? table(['prefix', 'requests', 'bytes'], g.other.map((o) => [o.prefix, int(o.requests), fmtBytes(o.bytes)])) : 'None.')
    parts.push(`### Alerts (om_alerts)`, a.routes.length
      ? table(['route', 'outcome', 'calls', 'count'], a.routes.map((r) => [r.route, r.outcome, int(r.calls), int(r.total)])) : 'No alerts traffic.',
      `Digests sent: ${int(a.digests.mails)} (${int(a.digests.rows)} change rows).`)
  }
  return parts.join('\n\n') + '\n'
}
