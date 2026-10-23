import { describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// scripts/storage-check.sh against a fake curl on PATH (scripts/storage-check/fake/curl): the scenario is a list of
// rules, the first match answers, anything else is a 404; each call is recorded, so a test asserts what was asked
const ROOT = new URL('../', import.meta.url).pathname
const SCRIPT = join(ROOT, 'scripts/storage-check.sh')
const FAKE = join(ROOT, 'scripts/storage-check/fake')
// the system bash is 3.2 on a Mac, the oldest the script supports; use it where it exists
// each run is ~25 calls of a fake curl
vi.setConfig({ testTimeout: 60_000 })
const BASH = existsSync('/bin/bash') ? '/bin/bash' : 'bash'

interface Rule { method?: string; match: string; range?: boolean; status: number; headers?: Record<string, string>; time?: number | number[]; fail?: boolean }
interface Call { method: string; url: string; sent: Record<string, string>; args: string[] }
const CORS = { 'access-control-allow-origin': '*' }
const RANGE = { 'content-range': 'bytes 0-16383/5259428', 'accept-ranges': 'bytes', ...CORS }

/** a host that answers everything right; rules are matched on the url, so a test prepends the rule it breaks */
function healthy(): Rule[] {
  const ok = (match: string, headers: Record<string, string>, extra: Partial<Rule> = {}): Rule => ({ match, status: 200, headers: { ...CORS, ...headers }, ...extra })
  const part = (match: string, type: string, extra: Partial<Rule> = {}): Rule => ({ match, status: 206, range: true, headers: { 'content-type': type, ...RANGE }, ...extra })
  return [
    { method: 'OPTIONS', match: '/gazetteer/index/places_index.parquet$', status: 204,
      headers: { ...CORS, 'access-control-allow-headers': 'range, if-match, if-none-match', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' } },
    ok('/gazetteer/index/layers.json$', { 'content-type': 'application/json' }),
    part('/gazetteer/index/places_index.parquet(\\?key=.*)?$', 'application/vnd.apache.parquet', { headers: { 'content-type': 'application/vnd.apache.parquet', ...RANGE, 'x-om-usage': 'used=1; cap=2; pct=0; state=ok' } }),
    part('/basemap/gebco/far.pmtiles$', 'application/vnd.pmtiles'),
    ok('/indicators/indicators.json$', { 'content-type': 'application/json' }),
    part('/indicators/coverage.parquet$', 'application/vnd.apache.parquet'),
    ok('/indicators/feeds/place=NMS:CINMS.xml$', { 'content-type': 'application/atom+xml' }),
    ok('/atlas/catalog.json$', { 'content-type': 'application/json' }),
    part('/atlas/aquamaps_eov/score_risk_3857.tif$', 'image/tiff'),
    ok('/obis-h3/collection.json$', { 'content-type': 'application/json' }),
    ok('/obis-h3/latest.json$', { 'content-type': 'application/json' }),
    ok('/marine-atlas/$', { 'content-type': 'text/html; charset=utf-8' }),
    ok('/marine-atlas/stac/catalog.json$', { 'content-type': 'application/json' }),
    part('/marine-atlas/tables/cog_3857.parquet$', 'application/vnd.apache.parquet'),
    { match: '/backups/', status: 404, headers: CORS },
    { match: '/atlas-restricted/x$', status: 403, headers: CORS },
    { match: '/unlisted/gazetteer/mr_eez/places.parquet$', status: 403, headers: CORS },
  ]
}

function run(args: string[], scenarios: Rule[] | Record<string, Rule[]> = healthy()) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-check-test-'))
  const log = join(dir, 'log')
  const sc = join(dir, 'scenario.json')
  writeFileSync(log, '')
  // one scenario for every host, or one per host (the key of a host's rules is matched as a prefix of the url)
  const rules: Rule[] = Array.isArray(scenarios) ? scenarios
    : Object.entries(scenarios).flatMap(([host, rs]) => rs.map(r => ({ ...r, match: `^${host}.*(${r.match})` })))
  const US = '\x1f'
  writeFileSync(sc, rules.map(r => [r.method ?? 'GET', r.match, r.range === undefined ? 'any' : r.range ? 'yes' : 'no', r.status,
    [r.time ?? 0.05].flat().map(t => t.toFixed(6)).join(' '), r.fail ? 1 : 0,
    ...Object.entries(r.headers ?? {}).map(([k, v]) => `${k}: ${v}`)].join(US)).join('\n') + '\n')
  const r = spawnSync(BASH, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${FAKE}:${process.env.PATH}`, OM_FAKE_LOG: log, OM_FAKE_SCENARIO: sc, TMPDIR: dir },
  })
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => {
    const [method, url, rest] = l.split('\t')
    const args = rest.split(US)
    const sent: Record<string, string> = {}
    args.forEach((a, i) => { if (args[i - 1] === '-H') sent[a.slice(0, a.indexOf(':')).toLowerCase()] = a.slice(a.indexOf(':') + 1).trim() })
    return { method, url, sent, args } as Call
  })
  return { code: r.status, out: r.stdout, err: r.stderr, calls }
}
const H = 'https://storage.example'
/** the table line of a row, e.g. row(out, '4c') */
const row = (out: string, id: string) => out.split('\n').find(l => l.startsWith(id + ' '))!
/** a healthy host with the rules in front of it */
const broken = (...front: Rule[]) => [...front, ...healthy()]

describe('storage-check.sh: a healthy host', () => {
  it('passes every row, prints the table and exits 0', () => {
    const r = run([H, '--key', 'k1'])
    expect(r.code).toBe(0)
    const ids = r.out.split('\n').map(l => l.split(/\s+/)[0]).filter(s => /^\d+[a-d]?$/.test(s))
    expect(ids).toEqual(['1', '2', '3', '4a', '4b', '4c', '5a', '5b', '6a', '6b', '7a', '7b', '7c', '8a', '8b', '8c', '8d', '9', '10', '11', '12'])
    expect(r.out).not.toContain('FAIL ')
    expect(r.out).toContain(`${H.slice(8)}: 21 PASS, 0 FAIL, 0 SKIP`)
  })
  it('asks for exactly the paths of the plan, with the ranges, and never follows a redirect', () => {
    const r = run([H + '/'])
    const gets = r.calls.filter(c => c.method === 'GET').map(c => c.url.replace(H + '/', ''))
    for (const p of ['gazetteer/index/layers.json', 'basemap/gebco/far.pmtiles', 'indicators/feeds/place=NMS:CINMS.xml', 'atlas/aquamaps_eov/score_risk_3857.tif',
      'obis-h3/latest.json', 'marine-atlas/', 'marine-atlas/tables/cog_3857.parquet', 'backups/', 'backups/msens_20260623.sql.gz', 'atlas-restricted/x',
      'unlisted/gazetteer/mr_eez/places.parquet']) expect(gets).toContain(p)
    expect(r.calls.filter(c => c.url.endsWith('places_index.parquet') && c.sent.range === 'bytes=0-16383').length).toBe(6)
    expect(r.calls.every(c => !c.args.includes('-L') && !c.args.includes('--location'))).toBe(true)
    expect(r.calls.every(c => c.method === 'GET' || c.method === 'OPTIONS')).toBe(true)
  })
})

describe('storage-check.sh: each rule fails alone', () => {
  it('1: json without Access-Control-Allow-Origin, or served as another type', () => {
    expect(row(run([H], broken({ match: 'layers.json$', status: 200, headers: { 'content-type': 'application/json' } })).out, '1')).toMatch(/FAIL no access-control-allow-origin/)
    expect(row(run([H], broken({ match: 'layers.json$', status: 200, headers: { ...CORS, 'content-type': 'text/plain' } })).out, '1')).toMatch(/FAIL content-type text\/plain/)
  })
  it('2: a 200 instead of 206, then a 206 without Content-Range or Accept-Ranges', () => {
    const idx = 'places_index.parquet$'
    const r200 = run([H], broken({ match: idx, status: 200, headers: CORS }))
    expect(row(r200.out, '2')).toMatch(/FAIL status 200 \(want 206\)/)
    const noCr = run([H], broken({ match: idx, status: 206, headers: { ...CORS, 'accept-ranges': 'bytes' } }))
    expect(row(noCr.out, '2')).toMatch(/FAIL no content-range/)
    const noAr = run([H], broken({ match: idx, status: 206, headers: { ...CORS, 'content-range': 'bytes 0-1/2' } }))
    expect(row(noAr.out, '2')).toMatch(/FAIL no accept-ranges/)
    expect(r200.code).toBe(1)
  })
  it('3: pmtiles served as octet-stream', () => {
    const r = run([H], broken({ match: 'far.pmtiles$', status: 206, headers: { ...RANGE, 'content-type': 'application/octet-stream' } }))
    expect(row(r.out, '3')).toMatch(/FAIL content-type application\/octet-stream/)
  })
  it('4c: the Atom feed with the wrong type; 4a and 4b a 404', () => {
    expect(row(run([H], broken({ match: 'NMS:CINMS.xml$', status: 200, headers: { 'content-type': 'text/xml' } })).out, '4c')).toMatch(/FAIL content-type text\/xml/)
    const r = run([H], broken({ match: 'indicators.json$', status: 404 }, { match: 'coverage.parquet$', status: 404 }))
    expect(row(r.out, '4a')).toMatch(/FAIL status 404 \(want 200\)/)
    expect(row(r.out, '4b')).toMatch(/FAIL status 404 \(want 206\)/)
  })
  it('5, 6: a missing catalog, COG, collection or latest.json is a FAIL of that row only', () => {
    const r = run([H], broken({ match: 'atlas/catalog.json$', status: 404 }, { match: 'score_risk_3857.tif$', status: 404 }, { match: 'obis-h3/latest.json$', status: 500 }))
    expect(row(r.out, '5a')).toContain('FAIL')
    expect(row(r.out, '5b')).toContain('FAIL')
    expect(row(r.out, '6a')).toContain('PASS')
    expect(row(r.out, '6b')).toMatch(/FAIL status 500/)
  })
  it('7: marine-atlas index not html; the parquet missing from the mirror (the first run against the preview)', () => {
    expect(row(run([H], broken({ match: 'marine-atlas/$', status: 200, headers: { 'content-type': 'application/json' } })).out, '7a')).toMatch(/FAIL content-type application\/json/)
    expect(row(run([H], broken({ match: 'cog_3857.parquet$', status: 404 })).out, '7c')).toMatch(/FAIL status 404 \(want 206\)/)
  })
  it('8: backups reachable, restricted and unlisted open without a key', () => {
    const r = run([H], broken({ match: '/backups/$', status: 200 }, { match: 'sql.gz$', status: 206 }, { match: 'atlas-restricted/x$', status: 200 }, { match: 'places.parquet$', status: 206 }))
    expect(row(r.out, '8a')).toMatch(/FAIL status 200 \(want 404\)/)
    expect(row(r.out, '8b')).toMatch(/FAIL status 206 \(want 404\)/)
    expect(row(r.out, '8c')).toMatch(/FAIL status 200 \(want 403\)/)
    expect(row(r.out, '8d')).toMatch(/FAIL status 206 \(want 403\)/)
  })
  it('9: the preflight sends Origin and Access-Control-Request-Headers: range, and needs 204/200 with the allow headers', () => {
    const r = run([H])
    const pre = r.calls.find(c => c.method === 'OPTIONS')!
    expect(pre.sent.origin).toBe('https://oceanmetrics.io')
    expect(pre.sent['access-control-request-headers']).toBe('range')
    expect(row(r.out, '9')).toMatch(/PASS 204/)
    expect(row(run([H], broken({ method: 'OPTIONS', match: '.', status: 200, headers: CORS })).out, '9')).toMatch(/FAIL allow-headers none lacks range/)
    expect(row(run([H], broken({ method: 'OPTIONS', match: '.', status: 200, headers: { 'access-control-allow-headers': 'range' } })).out, '9')).toMatch(/FAIL allow-origin none/)
    expect(row(run([H], broken({ method: 'OPTIONS', match: '.', status: 403 })).out, '9')).toMatch(/FAIL status 403 \(want 204 or 200\)/)
    expect(row(run([H], broken({ method: 'OPTIONS', match: '.', status: 200, headers: { 'access-control-allow-origin': 'https://oceanmetrics.io', 'access-control-allow-headers': 'Range' } })).out, '9')).toContain('PASS')
  })
})

describe('storage-check.sh: the Caddy before the cutover', () => {
  const redirect = { match: '.', status: 302, headers: { ...CORS, location: 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/x', server: 'Caddy' } }
  const caddy: Rule[] = [redirect, { ...redirect, method: 'OPTIONS' }]
  it('10: every request a 302 is a FAIL that counts them; nothing else passes', () => {
    const r = run([H], caddy)
    expect(r.code).toBe(1)
    expect(row(r.out, '10')).toMatch(/FAIL 23 of 23 \(302 x23\)/)
    expect(row(r.out, '1')).toMatch(/FAIL status 302 \(want 200\)/)
    expect(row(r.out, '8a')).toMatch(/FAIL status 302 \(want 404\)/)
    expect(row(r.out, '9')).toMatch(/FAIL status 302/)
    expect(row(r.out, '11')).toMatch(/FAIL status 302 \(want 206\)/)
  })
  it('10: one redirect among the 23 requests is enough, and a 301 counts too', () => {
    const r = run([H], broken({ match: 'obis-h3/latest.json$', status: 301 }))
    expect(row(r.out, '10')).toMatch(/FAIL 1 of 23 \(301 x1\)/)
  })
  it('no answer at all (connection refused) is status 000, not a crash', () => {
    const r = run([H], [{ match: '.', status: 0, fail: true }])
    expect(r.code).toBe(1)
    expect(row(r.out, '1')).toMatch(/FAIL status 000 \(want 200\)/)
  })
})

describe('storage-check.sh: 11, timing', () => {
  const timed = (times: number[], extra: string[] = []) => run([H, ...extra], broken({
    match: 'places_index.parquet$', range: true, status: 206, headers: { ...RANGE, 'x-om-usage': 'u' },
    // row 2 takes the first time, the five timed GETs the next five
    time: [0.001, ...times],
  }))
  it('is the median of the five, so one slow outlier passes and three slow fail', () => {
    const ok = timed([0.1, 0.2, 9, 0.15, 9])
    expect(row(ok.out, '11')).toMatch(/PASS 200 ms/)
    const slow = timed([9, 0.1, 9, 2, 0.2])
    expect(row(slow.out, '11')).toMatch(/FAIL 2000 ms \(limit 1500\)/)
    expect(slow.code).toBe(1)
  })
  it('the limit is 1,500 ms inclusive and --max-ms moves it', () => {
    expect(row(timed([1.5, 1.5, 1.5, 1.5, 1.5]).out, '11')).toMatch(/PASS 1500 ms/)
    expect(row(timed([1.6, 1.6, 1.6, 1.6, 1.6]).out, '11')).toMatch(/FAIL 1600 ms/)
    expect(row(timed([1.6, 1.6, 1.6, 1.6, 1.6], ['--max-ms', '2000']).out, '11')).toMatch(/PASS 1600 ms/)
  })
  it('five GETs, ranged', () => {
    const r = timed([0.1, 0.1, 0.1, 0.1, 0.1])
    expect(r.calls.filter(c => c.method === 'GET' && c.url.endsWith('places_index.parquet') && c.sent.range === 'bytes=0-16383').length).toBe(6) // row 2 and the five
  })
})

describe('storage-check.sh: 12, the keyed tier', () => {
  it('without --key the row is SKIP and does not fail the run', () => {
    const r = run([H])
    expect(row(r.out, '12')).toMatch(/SKIP no --key/)
    expect(r.code).toBe(0)
    expect(r.calls.some(c => c.url.includes('key='))).toBe(false)
  })
  it('with --key it sends ?key= on the ranged read, wants 206 and Content-Range, prints the usage header as information, and never prints the id', () => {
    const r = run([H, '--key', 'SECRETID123'])
    const keyed = r.calls.filter(c => c.url.includes('?key=SECRETID123'))
    expect(keyed.length).toBe(1)
    expect(keyed[0].sent.range).toBe('bytes=0-16383')
    expect(row(r.out, '12')).toMatch(/PASS usage header: present/)
    expect(r.out + r.err).not.toContain('SECRETID123')
  })
  it('x-om-usage absent (the Worker sends it only near the cap) is still a PASS, shown as absent', () => {
    const r = run([H, '--key', 'k'], broken({ match: '\\?key=k$', status: 206, headers: RANGE }))
    expect(row(r.out, '12')).toMatch(/PASS usage header: absent/)
    expect(r.code).toBe(0)
  })
  it('FAIL on a keyed read without Content-Range, and on a 403 for the key', () => {
    const keyed = (extra: Partial<Rule>) => run([H, '--key', 'k'], broken({ match: '\\?key=k$', status: 206, headers: RANGE, ...extra }))
    expect(row(keyed({ headers: CORS }).out, '12')).toMatch(/FAIL no content-range/)
    expect(row(keyed({ status: 403 }).out, '12')).toMatch(/FAIL status 403 \(want 206\)/)
  })
})

describe('storage-check.sh: --compare', () => {
  const A = 'https://new.example', B = 'https://old.example'
  it('prints both columns and exits 1 when either host fails', () => {
    const r = run([A, '--compare', B], {
      [A]: healthy(),
      [B]: [{ match: '.', status: 302, headers: CORS }],
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/check\s+new\.example\s+old\.example/)
    expect(row(r.out, '1')).toMatch(/PASS\s+FAIL status 302/)
    expect(r.out).toContain('https://new.example: 20 PASS, 0 FAIL, 1 SKIP')
    expect(r.out).toMatch(/https:\/\/old\.example: 0 PASS, 2\d FAIL, 1 SKIP|https:\/\/old\.example: \d PASS, \d+ FAIL, 1 SKIP/)
    expect(r.calls.some(c => c.url.startsWith(A))).toBe(true)
    expect(r.calls.some(c => c.url.startsWith(B))).toBe(true)
  })
  it('exits 0 when both are healthy', () => {
    const r = run([A, '--compare', B], { [A]: healthy(), [B]: healthy() })
    expect(r.code).toBe(0)
  })
})

describe('storage-check.sh: usage', () => {
  it('needs a host; refuses unknown options, two hosts, a missing value and a bad --max-ms (exit 2, no request)', () => {
    for (const a of [[], ['--nope', H], [H, 'https://b.example'], [H, '--key'], [H, '--compare'], [H, '--max-ms', 'x']]) {
      const r = run(a)
      expect(r.code).toBe(2)
      expect(r.calls).toEqual([])
    }
  })
  it('a host without a scheme is https, and a trailing slash is dropped', () => {
    const r = run(['storage.example/'])
    expect(r.calls[0].url).toBe('https://storage.example/gazetteer/index/layers.json')
  })
})
