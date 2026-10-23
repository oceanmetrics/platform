import { describe, expect, it } from 'vitest'
import {
  ALERTS_DATASET, GAZETTEER_DATASET, PREFIXES, alertRoutes, buildQueries, collect, digestsSent, envFileValue, errorsByStatus, fmtBytes,
  ident, lit, otherPrefixes, pct, prefixSummary, prefixTopKeys, renderMarkdown, runSql, sqlUrl, windowOf,
} from '../lib.mjs'

const NOW = new Date('2026-10-23T14:05:09.800Z')

describe('date windows', () => {
  it('7 days and 30 days end at the whole second of now, in UTC', () => {
    expect(windowOf(NOW, 7)).toEqual({ from: '2026-10-16 14:05:09', to: '2026-10-23 14:05:09', days: 7 })
    expect(windowOf(NOW, 30)).toEqual({ from: '2026-09-23 14:05:09', to: '2026-10-23 14:05:09', days: 30 })
  })
  it('crosses a year end', () => {
    expect(windowOf(new Date('2027-01-03T00:00:00Z'), 7).from).toBe('2026-12-27 00:00:00')
  })
})

describe('escaping', () => {
  it('a quote and a backslash in a prefix cannot end the literal', () => {
    expect(lit("a'b")).toBe("'a\\'b'")
    expect(lit('a\\b')).toBe("'a\\\\b'")
    expect(lit("x' OR '1'='1")).toBe("'x\\' OR \\'1\\'=\\'1'")
  })
  it('the injected prefix stays inside one literal in the query', () => {
    const sql = prefixSummary("x' OR '1'='1", windowOf(NOW, 7))
    expect(sql).toContain("blob8 = 'x\\' OR \\'1\\'=\\'1'")
  })
  it('control characters and bad dataset names are refused', () => {
    expect(() => lit('a\nb')).toThrow(/control/)
    expect(() => ident('om_gazetteer; DROP')).toThrow(/dataset/)
    expect(ident('om_alerts')).toBe('om_alerts')
  })
})

describe('the SQL text', () => {
  const w = windowOf(NOW, 7)
  it('summary, one prefix', () => {
    expect(prefixSummary('obis-h3', w)).toBe(
      "SELECT SUM(_sample_interval) AS requests, SUM(_sample_interval * double1) AS bytes, " +
      "SUM(IF(double2 = 200, _sample_interval, 0)) AS r200, SUM(IF(double2 = 206, _sample_interval, 0)) AS r206, " +
      "SUM(IF(blob1 != '', _sample_interval, 0)) AS keyed " +
      "FROM om_gazetteer WHERE timestamp >= toDateTime('2026-10-16 14:05:09') AND timestamp < toDateTime('2026-10-23 14:05:09') " +
      "AND blob8 = 'obis-h3' FORMAT JSON")
  })
  it('top keys: keyed requests only, ordered, limited', () => {
    expect(prefixTopKeys('atlas', w, 3)).toBe(
      "SELECT blob1 AS key, blob2 AS app, SUM(_sample_interval) AS requests, SUM(_sample_interval * double1) AS bytes " +
      "FROM om_gazetteer WHERE timestamp >= toDateTime('2026-10-16 14:05:09') AND timestamp < toDateTime('2026-10-23 14:05:09') " +
      "AND blob8 = 'atlas' AND blob1 != '' GROUP BY key, app ORDER BY requests DESC LIMIT 3 FORMAT JSON")
  })
  it('errors by status and the other prefixes', () => {
    expect(errorsByStatus(w)).toContain('AND double2 >= 400 GROUP BY prefix, status')
    expect(otherPrefixes(['a', "b'c"], w)).toContain("blob8 NOT IN ('a', 'b\\'c')")
  })
  it('alerts: routes by outcome, and the digests are route send, outcome digest', () => {
    expect(alertRoutes(w)).toContain('FROM om_alerts WHERE')
    expect(alertRoutes(w)).toContain('GROUP BY route, outcome')
    expect(digestsSent(w)).toContain("AND blob1 = 'send' AND blob2 = 'digest'")
  })
  it('every query names a dataset and carries no address or token', () => {
    const qs = buildQueries(NOW)
    for (const q of qs) {
      expect(q.sql).toMatch(/FROM (om_gazetteer|om_alerts) /)
      expect(q.sql).not.toMatch(/@|Bearer/)
    }
  })
})

describe('buildQueries', () => {
  const qs = buildQueries(NOW)
  const of = (window, id) => qs.filter((q) => q.window === window && q.id === id)
  it('both windows, every catalog and the unlisted prefix', () => {
    for (const win of ['7d', '30d']) {
      expect(of(win, 'summary').map((q) => q.prefix)).toEqual([...PREFIXES, 'unlisted'])
      expect(of(win, 'top_keys').map((q) => q.prefix)).toEqual(PREFIXES)
      expect(of(win, 'errors')).toHaveLength(1)
      expect(of(win, 'other')[0].sql).toContain("NOT IN ('gazetteer', 'indicators', 'atlas', 'obis-h3', 'basemap', 'marine-atlas', 'unlisted')")
      expect(of(win, 'alert_routes')[0].dataset).toBe(ALERTS_DATASET)
      expect(of(win, 'digests')[0].dataset).toBe(ALERTS_DATASET)
    }
    expect(of('7d', 'summary')[0].sql).toContain("toDateTime('2026-10-16 14:05:09')")
    expect(of('30d', 'summary')[0].sql).toContain("toDateTime('2026-09-23 14:05:09')")
    expect(of('7d', 'summary')[0].dataset).toBe(GAZETTEER_DATASET)
  })
  it('the account url', () => {
    expect(sqlUrl()).toBe('https://api.cloudflare.com/client/v4/accounts/af075785741eb60e6e4d482a71fa592d/analytics_engine/sql')
  })
})

// a recorded-shaped fixture: Analytics Engine answers { meta, data, rows } and sends numbers as numbers or strings
const FIXTURE = {
  summary: {
    gazetteer: { requests: 1000, bytes: 5 * 1024 ** 3, r200: 600, r206: 300, keyed: 750 },
    indicators: { requests: 200, bytes: 2048, r200: 200, r206: 0, keyed: 0 },
    unlisted: { requests: '12', bytes: '1536', r200: '10', r206: '2', keyed: '12' },
  },
  top: { gazetteer: [{ key: 'k-places', app: 'places', requests: '500', bytes: 3 * 1024 ** 3 }, { key: 'k-ind', app: 'indicators', requests: 250, bytes: 1024 ** 3 }] },
  errors: [{ prefix: 'gazetteer', status: 429, requests: 40 }, { prefix: 'backups', status: 404, requests: '7' }],
  other: [{ prefix: 'backups', requests: 7, bytes: 0 }],
  routes: [{ route: 'subscribe', outcome: 'pending', calls: 5, total: 5 }, { route: 'send', outcome: 'digest', calls: 2, total: 9 }],
  digests: { mails: 2, rows: 9 },
}

/** a fake fetch that answers by the SQL it is given */
function fakeFetch(log = []) {
  return async (url, init) => {
    const sql = String(init.body)
    log.push({ url, auth: init.headers.authorization, sql })
    const prefix = /blob8 = '([^']*)'/.exec(sql)?.[1]
    let data = []
    if (sql.startsWith('SELECT SUM(_sample_interval) AS requests')) data = prefix && FIXTURE.summary[prefix] ? [FIXTURE.summary[prefix]] : [{}]
    else if (sql.startsWith('SELECT blob1 AS key')) data = FIXTURE.top[prefix] ?? []
    else if (sql.includes('double2 >= 400')) data = FIXTURE.errors
    else if (sql.includes('NOT IN')) data = FIXTURE.other
    else if (sql.includes('FROM om_alerts') && sql.includes("blob2 = 'digest'")) data = [FIXTURE.digests]
    else if (sql.includes('FROM om_alerts')) data = FIXTURE.routes
    return new Response(JSON.stringify({ meta: [], data, rows: data.length }), { status: 200 })
  }
}

describe('collect and the table', () => {
  it('sums a fixture response into the report', async () => {
    const log = []
    const report = await collect(NOW, { token: 'secret-token', fetchFn: fakeFetch(log) })
    expect(Object.keys(report.windows)).toEqual(['7d', '30d'])
    const g = report.gazetteer['7d']
    expect(g.prefixes.gazetteer).toMatchObject({ requests: 1000, r200: 600, r206: 300, keyed: 750 })
    expect(g.prefixes.gazetteer.top_keys).toEqual([
      { key: 'k-places', app: 'places', requests: 500, bytes: 3 * 1024 ** 3 }, { key: 'k-ind', app: 'indicators', requests: 250, bytes: 1024 ** 3 }])
    expect(g.prefixes.unlisted).toMatchObject({ requests: 12, bytes: 1536 })
    expect(g.prefixes.basemap).toMatchObject({ requests: 0, bytes: 0 })
    expect(g.errors[1]).toEqual({ prefix: 'backups', status: 404, requests: 7 })
    expect(report.alerts['7d'].digests).toEqual({ mails: 2, rows: 9 })
    // the token is in the header only
    expect(log.every((l) => l.auth === 'Bearer secret-token' && !l.sql.includes('secret-token'))).toBe(true)
    expect(JSON.stringify(report)).not.toContain('secret-token')
  })

  it('renders the Markdown for the 7-day window exactly', async () => {
    const report = await collect(NOW, { token: 't', fetchFn: fakeFetch() })
    const md = renderMarkdown(report, { only: '7d' })
    expect(md).toContain('## Last 7 days (2026-10-16 14:05:09 to 2026-10-23 14:05:09 UTC)')
    expect(md).toContain('| gazetteer | 1,000 | 5.0 GiB | 33.3% | 75.0% | 25.0% |')
    expect(md).toContain('| indicators | 200 | 2.0 KiB | 0.0% | 0.0% | 100.0% |')
    expect(md).toContain('| basemap | 0 | 0 B | - | - | - |')
    expect(md).toContain('| unlisted (restricted) | 12 | 1.5 KiB | 16.7% | 100.0% | 0.0% |')
    expect(md).toContain('| gazetteer | `k-places` | places | 500 | 3.0 GiB |')
    expect(md).toContain('| gazetteer | 429 | 40 |')
    expect(md).toContain('| backups | 7 | 0 B |')
    expect(md).toContain('| send | digest | 2 | 9 |')
    expect(md).toContain('Digests sent: 2 (9 change rows).')
    expect(md).not.toContain('## Last 30 days')
    expect(md).not.toMatch(/@/)
  })

  it('an empty account renders without dividing by zero', async () => {
    const empty = async () => new Response('{"data":[]}', { status: 200 })
    const md = renderMarkdown(await collect(NOW, { token: 't', fetchFn: empty }))
    expect(md).toContain('| gazetteer | 0 | 0 B | - | - | - |')
    expect(md).toContain('No keyed requests.')
    expect(md).toContain('No errors.')
    expect(md).toContain('No alerts traffic.')
  })
})

describe('the API call', () => {
  it('an error status is reported without the token', async () => {
    const f = async () => new Response('{"errors":[{"message":"authentication error"}]}', { status: 403 })
    await expect(runSql('SELECT 1', { token: 'secret-token', fetchFn: f })).rejects.toThrow(/403.*authentication error/)
    await runSql('SELECT 1', { token: 'secret-token', fetchFn: f }).catch((e) => expect(e.message).not.toContain('secret-token'))
  })
})

describe('helpers', () => {
  it('formats bytes and shares', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(1023)).toBe('1023 B')
    expect(fmtBytes(1536)).toBe('1.5 KiB')
    expect(pct(1, 3)).toBe('33.3%')
    expect(pct(0, 0)).toBe('-')
  })
  it('reads the token line of an env file, with export and quotes', () => {
    expect(envFileValue('# c\nCF_AE_TOKEN=abc\n', 'CF_AE_TOKEN')).toBe('abc')
    expect(envFileValue('export CF_AE_TOKEN="abc"\n', 'CF_AE_TOKEN')).toBe('abc')
    expect(envFileValue('R2_ACCOUNT_ID=x\n', 'CF_AE_TOKEN')).toBe('')
  })
})
