import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, reset } from 'cloudflare:test'
import { decrypt, hmacHex, keys } from '../src/crypto'
import type { Subscription } from '../src/env'
import validate from './generated/alerts-subscription.mjs'
import { API, KEY, OTHER_KEY, call, dump, rig, subscribed, tokenIn } from './helpers'

const EMAIL = 'reader@example.org'
const hmacOf = async (e: string) => hmacHex((await keys(KEY)).addr, e)

/** every `sub:` record in KV passes the alerts-subscription schema */
async function assertSchema(): Promise<number> {
  const kv = await dump()
  const subs = Object.entries(kv).filter(([k]) => k.startsWith('sub:'))
  for (const [k, v] of subs) {
    const ok = validate(JSON.parse(v))
    expect(ok, `${k}: ${JSON.stringify(validate.errors)}`).toBe(true)
  }
  return subs.length
}

afterEach(async () => {
  vi.restoreAllMocks()
  await reset()
})

describe('POST /v1/subscribe', () => {
  it('stores a pending record by HMAC; the raw KV holds no plaintext address and decrypts only with the key', async () => {
    const r = rig()
    const res = await call(r, '/v1/subscribe', { email: '  Reader@Example.org ', place: 'NMS:CINMS', title: 'Channel Islands', source: 'place' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, status: 'pending', expires_in: 172800 })
    const kv = await dump()
    const raw = JSON.stringify(kv)
    expect(raw.toLowerCase()).not.toContain('reader@example.org')
    expect(raw).not.toContain('example.org')
    const h = await hmacOf(EMAIL)
    const addr = JSON.parse(kv[`addr:${h}`])
    expect(Object.keys(addr).sort()).toEqual(['enc', 'epoch', 'subs'])
    expect(await decrypt(await keys(KEY), addr.enc, h)).toBe(EMAIL)
    await expect(decrypt(await keys(OTHER_KEY), addr.enc, h)).rejects.toThrow()
    const sub = JSON.parse(kv[`sub:${addr.subs[0]}`]) as Subscription
    expect(sub).toMatchObject({ hmac: h, kinds: ['status', 'new'], cadence: 'daily', confirmed_at: null, last_sent: null, title: 'Channel Islands', source: 'place',
      rules: { places: { include: ['NMS:CINMS'], exclude: [] }, indicators: { include: ['*'], exclude: [] } } })
    expect(Object.keys(kv).filter((k) => k.startsWith('tok:'))).toHaveLength(1)
    expect(await assertSchema()).toBe(1)
  })

  it('sends the confirmation through the provider: the link opens the static page, the token in the fragment', async () => {
    const r = rig()
    await call(r, '/v1/subscribe', { email: EMAIL })
    expect(r.mails).toHaveLength(1)
    const m = r.mails[0]
    expect(m.to).toBe(EMAIL)
    expect(m.from).toBe('Ocean Metrics alerts <alerts@oceanmetrics.io>')
    expect(m.subject).toBe('Confirm your Ocean Metrics alert')
    expect(m.text).toMatch(/https:\/\/oceanmetrics\.io\/alerts\/confirm\/#t=[A-Za-z0-9_-]{43}\n/)
    expect(m.text).toContain('each series’ lead indicator at the national marine sanctuaries')
    expect(m.html).toContain('opening this mail or its link alone confirms nothing')
    // only the token's hash is kept
    const t = tokenIn(m.text)
    expect(JSON.stringify(await dump())).not.toContain(t)
  })

  it('the Turnstile check is skipped when TURNSTILE_SECRET is unset, and the response says so', async () => {
    const res = await call(rig(), '/v1/subscribe', { email: EMAIL })
    expect(res.status).toBe(202)
    expect(res.headers.get('x-om-turnstile')).toBe('skipped')
    expect(res.headers.get('access-control-expose-headers')).toContain('x-om-turnstile')
  })

  it('with TURNSTILE_SECRET: a missing or failing token is 403 and stores nothing; a passing one subscribes', async () => {
    const r = rig({ TURNSTILE_SECRET: 'ts-secret' })
    const none = await call(r, '/v1/subscribe', { email: EMAIL })
    expect(none.status).toBe(403)
    expect((await none.json() as { error: string }).error).toBe('turnstile_failed')
    const bad = await call(r, '/v1/subscribe', { email: EMAIL, turnstile: 'fail' })
    expect(bad.status).toBe(403)
    expect(Object.keys(await dump()).filter((k) => !k.startsWith('rl:'))).toEqual([])
    const ok = await call(r, '/v1/subscribe', { email: EMAIL, turnstile: 'pass' })
    expect(ok.status).toBe(202)
    expect(ok.headers.get('x-om-turnstile')).toBeNull()
    expect(r.mails).toHaveLength(1)
  })

  it('validation: a bad address, kind, cadence or rule is 400, and nothing is stored', async () => {
    const r = rig()
    for (const [body, code] of [
      [{ email: 'nope' }, 'bad_email'], [{ email: EMAIL, kinds: ['worse'] }, 'bad_kinds'],
      [{ email: EMAIL, cadence: 'hourly' }, 'bad_cadence'], [{ email: EMAIL, place: 'a b' }, 'bad_rules'],
    ] as const) {
      const res = await call(r, '/v1/subscribe', body)
      expect(res.status, code).toBe(400)
      expect((await res.json() as { error: string }).error).toBe(code)
    }
    const raw = await call(r, '/v1/subscribe', undefined, { raw: '{"email":' })
    expect(raw.status).toBe(400)
    expect(Object.keys(await dump()).filter((k) => !k.startsWith('rl:'))).toEqual([])
  })

  it('a known address gets the same answer (no enumeration); a bounced one is never mailed again', async () => {
    const r = rig()
    await subscribed(r, EMAIL)
    const again = await call(r, '/v1/subscribe', { email: EMAIL, place: 'NMS:FGBNMS' }, { ip: '203.0.113.9' })
    expect(again.status).toBe(202)
    expect(await again.json()).toEqual({ ok: true, status: 'pending', expires_in: 172800 })
    await env.ALERTS.put(`supp:${await hmacOf('gone@example.org')}`, JSON.stringify({ reason: 'bounce', at: '2026-10-01T00:00:00Z', epoch: 1 }))
    const n = r.mails.length
    const supp = await call(r, '/v1/subscribe', { email: 'gone@example.org' }, { ip: '203.0.113.10' })
    expect(supp.status).toBe(202)
    expect(await supp.json()).toEqual({ ok: true, status: 'pending', expires_in: 172800 })
    expect(r.mails).toHaveLength(n)
  })

  it('the resend provider sends from env.FROM and replies to env.REPLY_TO, whatever they are set to', async () => {
    const r = rig({ FROM: 'Test Sender <sender@example.org>', REPLY_TO: 'reply@example.org' })
    await call(r, '/v1/subscribe', { email: EMAIL })
    expect(r.mails).toHaveLength(1)
    expect(r.mails[0].from).toBe('Test Sender <sender@example.org>')
    expect(r.mails[0].reply_to).toBe('reply@example.org')
    // no REPLY_TO, no reply_to; no FROM, the default sender at the root domain
    const d = rig()
    await call(d, '/v1/subscribe', { email: EMAIL })
    expect(d.mails[0].from).toBe('Ocean Metrics alerts <alerts@oceanmetrics.io>')
    expect(d.mails[0].reply_to).toBeUndefined()
  })

  it('a provider failure is a 502, so the page can say the mail did not go', async () => {
    const r = rig({}, { resend: [503] })
    const res = await call(r, '/v1/subscribe', { email: EMAIL })
    expect(res.status).toBe(502)
  })

  it('without ALERTS_KEY the routes answer 503 and store nothing', async () => {
    const res = await call(rig({ ALERTS_KEY: undefined }), '/v1/subscribe', { email: EMAIL })
    expect(res.status).toBe(503)
    expect(await dump()).toEqual({})
  })
})

describe('POST /v1/confirm', () => {
  it('confirms the pending record, mails the welcome with the manage link and the one-click headers', async () => {
    const r = rig()
    await call(r, '/v1/subscribe', { email: EMAIL })
    const res = await call(r, '/v1/confirm', { token: tokenIn(r.mails[0].text) })
    expect(res.status).toBe(200)
    const out = await res.json() as { status: string; already: boolean; manage: string; subscription: { status: string; confirmed_at: string } }
    expect(out).toMatchObject({ status: 'confirmed', already: false, subscription: { status: 'confirmed', confirmed_at: '2026-10-22T09:00:00Z' } })
    expect(out.manage).toMatch(/^m1\.[0-9a-f]{64}\.0\.[A-Za-z0-9_-]{43}$/)
    expect(out.subscription).not.toHaveProperty('hmac')
    const w = r.mails[1]
    expect(w.subject).toBe('Your Ocean Metrics alert is on')
    expect(w.text).toContain(`https://oceanmetrics.io/alerts/manage/#t=${out.manage}`)
    expect(w.headers).toEqual({ 'List-Unsubscribe': `<${API}/v1/unsubscribe?t=${out.manage}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    expect(await assertSchema()).toBe(1)
  })

  it('confirming twice is one subscription and one welcome mail', async () => {
    const r = rig()
    await call(r, '/v1/subscribe', { email: EMAIL })
    const token = tokenIn(r.mails[0].text)
    await call(r, '/v1/confirm', { token })
    const again = await call(r, '/v1/confirm', { token })
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ status: 'confirmed', already: true })
    expect(r.mails).toHaveLength(2)
    expect(Object.keys(await dump()).filter((k) => k.startsWith('sub:'))).toHaveLength(1)
  })

  it('the same watch subscribed and confirmed again stays one subscription', async () => {
    const r = rig()
    await subscribed(r, EMAIL)
    const s = await subscribed(r, EMAIL)
    const subs = Object.keys(await dump()).filter((k) => k.startsWith('sub:'))
    expect(subs).toEqual([`sub:${s.id}`])
  })

  it('an unknown or expired token is 404 (the pending record lives 48 h)', async () => {
    const r = rig()
    await call(r, '/v1/subscribe', { email: EMAIL })
    const token = tokenIn(r.mails[0].text)
    expect((await call(r, '/v1/confirm', { token: 'x'.repeat(43) })).status).toBe(404)
    r.clock.now = new Date(r.clock.now.getTime() + 48 * 3600_000 + 1000)
    const late = await call(r, '/v1/confirm', { token })
    expect(late.status).toBe(404)
    expect((await late.json() as { error: string }).error).toBe('invalid_or_expired')
    expect((await call(r, '/v1/confirm', { token: 'short' })).status).toBe(400)
  })

  it('pending records are written with the 48 h TTL', async () => {
    const r = rig()
    await call(r, '/v1/subscribe', { email: EMAIL })
    const list = await env.ALERTS.list()
    const exp = Object.fromEntries(list.keys.map((k) => [k.name.split(':')[0], k.expiration]))
    const now = Date.now() / 1000
    for (const p of ['sub', 'addr', 'tok']) expect(exp[p]! - now, p).toBeGreaterThan(48 * 3600 - 120)
    for (const p of ['sub', 'addr', 'tok']) expect(exp[p]! - now, p).toBeLessThanOrEqual(48 * 3600 + 5)
    await call(r, '/v1/confirm', { token: tokenIn(r.mails[0].text) })
    const after = Object.fromEntries((await env.ALERTS.list()).keys.map((k) => [k.name.split(':')[0], k.expiration]))
    expect(after.sub).toBeUndefined()
    expect(after.addr).toBeUndefined()
  })
})

describe('a GET never changes state', () => {
  it('GET on the POST routes is 405; GET /v1/unsubscribe redirects to the page with the button', async () => {
    const r = rig()
    const s = await subscribed(r, EMAIL)
    const before = await dump()
    for (const p of ['/v1/subscribe', '/v1/confirm', '/v1/manage']) expect((await call(r, p, undefined, { method: 'GET' })).status, p).toBe(405)
    const u = await call(r, `/v1/unsubscribe?t=${s.manage}`, undefined, { method: 'GET', origin: null })
    expect(u.status).toBe(303)
    expect(u.headers.get('location')).toBe(`https://oceanmetrics.io/alerts/manage/#t=${encodeURIComponent(s.manage)}&u=all`)
    const after = await dump()
    for (const k of Object.keys(after)) if (k.startsWith('rl:')) delete after[k]
    for (const k of Object.keys(before)) if (k.startsWith('rl:')) delete before[k]
    expect(after).toEqual(before)
  })

  it('GET /v1/health says the provider and whether Turnstile is on; unknown paths are 404', async () => {
    const h = await call(rig(), '/v1/health', undefined, { method: 'GET' })
    expect(await h.json()).toEqual({ ok: true, service: 'om-alerts', version: '0.1.0', provider: 'resend', turnstile: 'skipped', keyed: true })
    expect((await call(rig(), '/v2/nothing', {})).status).toBe(404)
  })
})

describe('POST /v1/manage', () => {
  it('lists, updates and deletes by the signed manage token', async () => {
    const r = rig()
    const a = await subscribed(r, EMAIL)
    const b = await subscribed(r, EMAIL, { place: 'NMS:FGBNMS' })
    const list = await call(r, '/v1/manage', { token: a.manage })
    const out = await list.json() as { subscriptions: { id: string }[] }
    expect(out.subscriptions.map((s) => s.id).sort()).toEqual([a.id, b.id].sort())
    const up = await call(r, '/v1/manage', { token: a.manage, action: 'update', id: b.id, kinds: ['status'], cadence: 'weekly', params: { pi: 'NMS:FGBNMS,NMS:CINMS' } })
    expect(up.status).toBe(200)
    const sub = JSON.parse((await env.ALERTS.get(`sub:${b.id}`))!) as Subscription
    expect(sub).toMatchObject({ kinds: ['status'], cadence: 'weekly', rules: { places: { include: ['NMS:FGBNMS', 'NMS:CINMS'] } } })
    expect(await assertSchema()).toBe(2)
    const del = await call(r, '/v1/manage', { token: a.manage, action: 'delete', id: b.id })
    expect((await del.json() as { subscriptions: unknown[] }).subscriptions).toHaveLength(1)
    expect(await env.ALERTS.get(`sub:${b.id}`)).toBeNull()
    expect((await call(r, '/v1/manage', { token: a.manage, action: 'update', id: 'nope', kinds: ['new'] })).status).toBe(404)
  })

  it('a forged or altered token is 403', async () => {
    const r = rig()
    const a = await subscribed(r, EMAIL)
    expect((await call(r, '/v1/manage', { token: a.manage.slice(0, -1) + (a.manage.endsWith('A') ? 'B' : 'A') })).status).toBe(403)
    expect((await call(r, '/v1/manage', { token: 'm1.x' })).status).toBe(403)
  })
})

describe('unsubscribe', () => {
  it('one-click (RFC 8058): the mail client POSTs List-Unsubscribe=One-Click to the header URL, with no Origin', async () => {
    const r = rig()
    const s = await subscribed(r, EMAIL)
    const url = r.mails.at(-1)!.headers['List-Unsubscribe'].slice(1, -1)
    expect(url.startsWith(`${API}/v1/unsubscribe?t=`)).toBe(true)
    const res = await call(r, url.slice(API.length), undefined, { origin: null, raw: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'unsubscribed' })
    const kv = await dump()
    const h = await hmacOf(EMAIL)
    expect(Object.keys(kv).filter((k) => /^(sub|addr):/.test(k))).toEqual([])
    expect(JSON.parse(kv[`supp:${h}`])).toMatchObject({ reason: 'unsubscribed', epoch: 1 })
    expect(r.points.some((p) => p.blobs[0] === 'unsubscribe' && p.blobs[1] === 'one_click')).toBe(true)
    // a second click answers the same; the old manage link is dead
    expect((await call(r, url.slice(API.length), undefined, { origin: null, raw: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(200)
    expect((await call(r, '/v1/manage', { token: s.manage })).status).toBe(404)
  })

  it('a re-subscription after an unsubscribe works, and the old link cannot end it', async () => {
    const r = rig()
    const old = await subscribed(r, EMAIL)
    await call(r, '/v1/unsubscribe', { token: old.manage })
    const now = await subscribed(r, EMAIL)
    expect(now.manage).not.toBe(old.manage)
    await call(r, '/v1/unsubscribe', { token: old.manage })
    expect(await env.ALERTS.get(`sub:${now.id}`)).not.toBeNull()
  })

  it('a bad token is 403', async () => {
    expect((await call(rig(), '/v1/unsubscribe?t=nope', undefined, { origin: null, raw: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(403)
  })
})

describe('CORS', () => {
  it('a preflight from oceanmetrics.io is allowed; from another site it is refused without CORS headers', async () => {
    const ok = await call(rig(), '/v1/subscribe', undefined, { method: 'OPTIONS' })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://oceanmetrics.io')
    expect(ok.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(ok.headers.get('vary')).toContain('Origin')
    const bad = await call(rig(), '/v1/subscribe', undefined, { method: 'OPTIONS', origin: 'https://evil.example.org' })
    expect(bad.status).toBe(403)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('a POST from another site is refused before anything is stored or sent', async () => {
    const r = rig()
    const res = await call(r, '/v1/subscribe', { email: EMAIL }, { origin: 'https://evil.example.org' })
    expect(res.status).toBe(403)
    expect((await res.json() as { error: string }).error).toBe('origin_not_allowed')
    expect(await dump()).toEqual({})
    expect(r.mails).toEqual([])
  })

  it('localhost on any port is allowed for development', async () => {
    const res = await call(rig(), '/v1/subscribe', { email: EMAIL }, { origin: 'http://localhost:1313' })
    expect(res.status).toBe(202)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:1313')
  })
})

describe('rate limits (KV counters per hashed ip)', () => {
  it('the sixth subscribe from one ip in ten minutes is 429 with Retry-After; another ip is not limited', async () => {
    const r = rig()
    for (let i = 0; i < 5; i++) expect((await call(r, '/v1/subscribe', { email: `r${i}@example.org` })).status).toBe(202)
    const sixth = await call(r, '/v1/subscribe', { email: 'r6@example.org' })
    expect(sixth.status).toBe(429)
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await call(r, '/v1/subscribe', { email: 'r7@example.org' }, { ip: '192.0.2.1' })).status).toBe(202)
    // the window passes
    r.clock.now = new Date(r.clock.now.getTime() + 600_000)
    expect((await call(r, '/v1/subscribe', { email: 'r8@example.org' })).status).toBe(202)
    // no ip in KV, only its hmac
    expect(Object.keys(await dump()).filter((k) => k.startsWith('rl:')).join(' ')).not.toContain('203.0.113.7')
  })

  it('an address gets three confirmation mails an hour at most, whatever the ip', async () => {
    const r = rig()
    for (let i = 0; i < 5; i++) await call(r, '/v1/subscribe', { email: EMAIL }, { ip: `192.0.2.${i + 10}` })
    expect(r.mails).toHaveLength(3)
  })
})

describe('POST /v1/provider-events', () => {
  const SECRET = 'whsec_' + btoa('0123456789abcdef0123456789abcdef')
  async function signed(body: string, at: Date) {
    const ts = String(Math.floor(at.getTime() / 1000))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('0123456789abcdef0123456789abcdef'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`msg_1.${ts}.${body}`)))))
    return { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` }
  }

  it('a bad signature is refused; a hard bounce ends the subscriptions and suppresses the address', async () => {
    const r = rig({ RESEND_WEBHOOK_SECRET: SECRET })
    await subscribed(r, EMAIL)
    const body = JSON.stringify({ type: 'email.bounced', data: { to: [EMAIL], bounce: { type: 'Permanent' } } })
    const bad = await call(r, '/v1/provider-events', undefined, { origin: null, raw: body, headers: { 'svix-id': 'msg_1', 'svix-timestamp': '1', 'svix-signature': 'v1,AAAA' } })
    expect(bad.status).toBe(401)
    expect(Object.keys(await dump()).some((k) => k.startsWith('sub:'))).toBe(true)
    const ok = await call(r, '/v1/provider-events', undefined, { origin: null, raw: body, headers: await signed(body, r.clock.now) })
    expect(await ok.json()).toEqual({ ok: true, action: 'suppressed', count: 1 })
    const kv = await dump()
    expect(Object.keys(kv).some((k) => /^(sub|addr):/.test(k))).toBe(false)
    expect(JSON.parse(kv[`supp:${await hmacOf(EMAIL)}`]).reason).toBe('bounce')
    const n = r.mails.length
    await call(r, '/v1/subscribe', { email: EMAIL }, { ip: '192.0.2.99' })
    expect(r.mails).toHaveLength(n)
  })

  it('a soft bounce changes nothing; without the secret the route is 503', async () => {
    const r = rig({ RESEND_WEBHOOK_SECRET: SECRET })
    await subscribed(r, EMAIL)
    const body = JSON.stringify({ type: 'email.bounced', data: { to: [EMAIL], bounce: { type: 'Transient' } } })
    const res = await call(r, '/v1/provider-events', undefined, { origin: null, raw: body, headers: await signed(body, r.clock.now) })
    expect(await res.json()).toEqual({ ok: true, action: 'none' })
    expect((await call(rig(), '/v1/provider-events', {}, { origin: null })).status).toBe(503)
  })
})

describe('no address in a metric or a log line', () => {
  it('the whole path with the log provider: points and console lines hold no @', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')) })
    const r = rig({ PROVIDER: 'log' })
    const res = await call(r, '/v1/subscribe', { email: EMAIL })
    expect(res.status).toBe(202)
    const token = /#t=([A-Za-z0-9_-]{43})/.exec(lines.join('\n'))![1]
    expect((await call(r, '/v1/confirm', { token })).status).toBe(200)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.join('\n')).not.toContain('@')
    expect(JSON.stringify(r.points)).not.toContain('@')
    expect(r.points.map((p) => `${p.blobs[0]}:${p.blobs[1]}`)).toEqual(['send:logged', 'send:confirm_mail', 'subscribe:pending', 'send:logged', 'send:welcome_mail', 'confirm:confirmed'])
  })
})
