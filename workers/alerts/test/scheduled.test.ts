import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutionContext, createScheduledController, env, reset, waitOnExecutionContext } from 'cloudflare:test'
import { hmacHex, keys } from '../src/crypto'
import type { Subscription } from '../src/env'
import worker from '../src/index'
import { runDigests } from '../src/scheduled'
import validate from './generated/alerts-subscription.mjs'
import { KEY, call, dump, latest, rig, subscribed } from './helpers'
import type { Rig } from './helpers'

afterEach(async () => {
  vi.restoreAllMocks()
  await reset()
})

/** latest.json as the build would have written it on `date` */
const latestUpTo = (date: string) => ({ ...latest, date, recent: latest.recent.filter((f) => f.date <= date) })
const digests = (r: Rig) => r.mails.filter((m) => m.subject.startsWith('Ocean Metrics:'))
const run = (r: Rig, at: string) => { r.clock.now = new Date(at); return runDigests(r.env, r.deps) }
const subOf = async (id: string) => JSON.parse((await env.ALERTS.get(`sub:${id}`))!) as Subscription

describe('the hourly digest', () => {
  it('the NMS:PMNM status change of 10-21: one mail for coll:places + status, none for a subscriber of only kind new', async () => {
    const r = rig({}, { latest: latestUpTo('2026-10-22') })
    const a = await subscribed(r, 'status@example.org', { params: { pi: 'coll:places' }, kinds: ['status'] })
    const b = await subscribed(r, 'new@example.org', { params: { pi: 'coll:places' }, kinds: ['new'] })
    const sum = await run(r, '2026-10-22T10:00:00Z')
    expect(sum).toMatchObject({ idle: false, date: '2026-10-22', addresses: 2, sent: 1, quiet: 1, failed: 0, pending: 0, rows: 1 })
    const d = digests(r)
    expect(d).toHaveLength(1)
    expect(d[0].to).toBe('status@example.org')
    expect(d[0].subject).toBe('Ocean Metrics: 1 change at Papahānaumokuākea Marine National Monument (2026-10-21)')
    expect(d[0].text).toContain('Sea surface temperature (CRW, 5 km) in Papahānaumokuākea Marine National Monument has its first status: above its own record (2025).')
    expect(d[0].text).toContain('https://oceanmetrics.io/places/p/NMS:PMNM/')
    expect(d[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const h = await hmacHex((await keys(KEY)).addr, 'status@example.org')
    expect(d[0].key).toBe(`digest:${h}:2026-10-22`)
    // both windows moved: the quiet subscriber's too, with no mail
    expect((await subOf(a.id)).last_sent).toBe('2026-10-22')
    expect((await subOf(b.id)).last_sent).toBe('2026-10-22')
    for (const [k, v] of Object.entries(await dump())) if (k.startsWith('sub:')) expect(validate(JSON.parse(v)), k).toBe(true)
  })

  it('a second run with nothing new is idle: one read of latest.json, no mail', async () => {
    const r = rig({}, { latest: latestUpTo('2026-10-22') })
    await subscribed(r, 'status@example.org', { kinds: ['status'] })
    await run(r, '2026-10-22T10:00:00Z')
    r.net.fetched.length = 0
    const sum = await run(r, '2026-10-22T11:00:00Z')
    expect(sum.idle).toBe(true)
    expect(r.net.fetched).toEqual(['https://data.example.org/indicators/changes/latest.json'])
    expect(digests(r)).toHaveLength(1)
  })

  it('the daily cap: a second change file on the same day waits for the next day', async () => {
    const r = rig({}, { latest: latestUpTo('2026-10-22') })
    await subscribed(r, 'reader@example.org')
    await run(r, '2026-10-23T01:00:00Z')
    expect(digests(r)).toHaveLength(1)
    r.net.latest = latestUpTo('2026-10-23')
    const later = await run(r, '2026-10-23T08:00:00Z')
    expect(later).toMatchObject({ sent: 0, pending: 1 })
    expect(digests(r)).toHaveLength(1)
    const next = await run(r, '2026-10-24T00:00:00Z')
    expect(next).toMatchObject({ sent: 1, pending: 0 })
    const d = digests(r)
    expect(d).toHaveLength(2)
    // the lead indicators only (`*`): the OBIS dominance row is not a series lead; the period row is not a default kind
    expect(d[1].subject).toBe('Ocean Metrics: 1 change at Flower Garden Banks National Marine Sanctuary (2026-10-23)')
    expect(d[1].text).toContain('is now above its own record (2025); it was within its own record.')
  })

  it('weekly: nothing on a Thursday, one mail on Monday with the week’s changes', async () => {
    const r = rig()
    await subscribed(r, 'weekly@example.org', { cadence: 'weekly' })
    const thu = await run(r, '2026-10-22T10:00:00Z')
    expect(thu).toMatchObject({ sent: 0, pending: 1 })
    expect((await run(r, '2026-10-23T10:00:00Z')).sent).toBe(0)
    const mon = await run(r, '2026-10-26T10:00:00Z')
    expect(mon).toMatchObject({ sent: 1, rows: 2, pending: 0 })
    expect(digests(r)[0].subject).toBe('Ocean Metrics: 2 changes at 2 places (2026-10-21 to 2026-10-23)')
  })

  it('a provider 5xx is retried next hour with the same idempotency key, and sent once', async () => {
    const r = rig({}, { latest: latestUpTo('2026-10-22') })
    const s = await subscribed(r, 'reader@example.org')
    r.net.resend = [503]
    const first = await run(r, '2026-10-22T10:00:00Z')
    expect(first).toMatchObject({ sent: 0, failed: 1, pending: 1 })
    expect((await subOf(s.id)).last_sent).toBeNull()
    const second = await run(r, '2026-10-22T11:00:00Z')
    expect(second).toMatchObject({ sent: 1, failed: 0 })
    expect(await run(r, '2026-10-22T12:00:00Z')).toMatchObject({ idle: true })
    const d = digests(r)
    expect(d).toHaveLength(1)
    const sends = r.net.fetched.filter((u) => u === 'https://api.resend.com/emails')
    expect(sends).toHaveLength(2 + 2)  // the confirm and welcome mails, then the failed and the retried digest
    expect((await subOf(s.id)).last_sent).toBe('2026-10-22')
  })

  it('a provider refusal (4xx) stops for the day without moving the window', async () => {
    const r = rig({}, { latest: latestUpTo('2026-10-22') })
    const s = await subscribed(r, 'reader@example.org')
    r.net.resend = [422]
    expect(await run(r, '2026-10-22T10:00:00Z')).toMatchObject({ sent: 0, failed: 1 })
    expect(await run(r, '2026-10-22T11:00:00Z')).toMatchObject({ sent: 0, failed: 0 })
    expect((await subOf(s.id)).last_sent).toBeNull()
    expect(await run(r, '2026-10-23T00:00:00Z')).toMatchObject({ sent: 1 })
  })

  it('the rules: a place watch, a report rule with series:…:* and an ix exclusion, a place set', async () => {
    const r = rig()
    const at = '2026-10-22T20:00:00Z'
    await subscribed(r, 'place@example.org', { place: 'NMS:CINMS', kinds: ['status', 'new', 'period'] }, at)
    await subscribed(r, 'report@example.org', { kinds: ['status', 'new', 'period'], rules: { places: { include: ['NMS:CINMS', 'NMS:FGBNMS'], exclude: [] }, indicators: { include: ['series:obis-all:*', 'erddap:dhw_5km:CRW_SST:mean'], exclude: ['obis:n'] } } }, at)
    await subscribed(r, 'except@example.org', { kinds: ['status', 'new', 'period'], params: { pi: 'NMS:CINMS,NMS:FGBNMS', ii: 'all', ix: 'series:obis-all:*' } }, at)
    await subscribed(r, 'set@example.org', { params: { pi: 'set:political' }, kinds: ['new'] }, at)
    await run(r, '2026-10-24T01:00:00Z')
    // each line's card link names its place and indicator
    const cells = (text: string) => text.split('\n').filter((l) => l.startsWith('    https://oceanmetrics.io/indicators/#'))
      .map((l) => { const q = new URLSearchParams(l.split('#')[1]); return `${q.get('place')} ${q.get('ind')}` })
    const by = Object.fromEntries(digests(r).map((m) => [m.to, cells(m.text)]))
    const SST = 'erddap:dhw_5km:CRW_SST:mean'
    expect(by['place@example.org']).toEqual([`NMS:CINMS ${SST}`])
    expect(by['report@example.org']).toEqual(['NMS:CINMS obis:bp', `NMS:CINMS ${SST}`, `NMS:FGBNMS ${SST}`])
    expect(by['except@example.org']).toEqual([`NMS:CINMS ${SST}`, `NMS:FGBNMS ${SST}`])
    // the set subscriber confirmed on 10-22: the mr_eez row of that day, nothing of 10-21
    expect(by['set@example.org']).toEqual(['MRGID:5670 erddap:IMERG_monthly_global_precip:precipitation:mean'])
  })

  it('one mail per address a day, whatever its number of subscriptions', async () => {
    const r = rig()
    await subscribed(r, 'two@example.org', { place: 'NMS:CINMS', kinds: ['period'], title: 'Channel Islands' })
    await subscribed(r, 'two@example.org', { place: 'NMS:FGBNMS', kinds: ['status'], title: 'Flower Garden Banks' }, '2026-10-20T11:00:00Z')
    await run(r, '2026-10-24T01:00:00Z')
    const d = digests(r)
    expect(d).toHaveLength(1)
    expect(d[0].subject).toBe('Ocean Metrics: 2 changes at 2 places (2026-10-23)')
    expect(d[0].text).toContain('alerts on: Channel Islands; Flower Garden Banks.')
  })

  it('an unsubscribed or unconfirmed address is never mailed', async () => {
    const r = rig()
    const s = await subscribed(r, 'gone@example.org')
    await call(r, '/v1/unsubscribe', { token: s.manage })
    await call(r, '/v1/subscribe', { email: 'pending@example.org' }, { ip: '192.0.2.50' })
    const n = r.mails.length
    const sum = await run(r, '2026-10-24T01:00:00Z')
    expect(sum).toMatchObject({ addresses: 0, sent: 0 })
    expect(r.mails).toHaveLength(n)
  })

  it('the rules context is read once per manifest version (KV), not on every run', async () => {
    const r = rig({}, { latest: latestUpTo('2026-10-22') })
    await subscribed(r, 'reader@example.org')
    await run(r, '2026-10-22T10:00:00Z')
    r.net.latest = latestUpTo('2026-10-23')
    r.net.fetched.length = 0
    await run(r, '2026-10-23T10:00:00Z')
    expect(r.net.fetched.filter((u) => u.endsWith('indicators.json'))).toEqual([])
  })

  it('the scheduled export runs the digest; with the log provider no log line holds an address', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')) })
    const r = rig({}, { latest: latestUpTo('2026-10-22') })
    await subscribed(r, 'logged@example.org', { kinds: ['status'] })
    r.env.PROVIDER = 'log'
    const sum = await run(r, '2026-10-22T10:00:00Z')
    expect(sum.sent).toBe(1)
    expect(lines.some((l) => l.includes('subject="Ocean Metrics: 1 change at Papahānaumokuākea'))).toBe(true)
    expect(lines.join('\n')).not.toContain('@')
    expect(JSON.stringify(r.points)).not.toContain('@')
    // the real export: with no ALERTS_KEY (a log-mode deploy before the secret) it waits quietly and says so in a metric;
    // a failing run (here a key too short) is caught and metered
    const points: unknown[] = []
    const ctx = createExecutionContext()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ev = { writeDataPoint: (p: unknown) => points.push(p) }
    await worker.scheduled(createScheduledController(), { ...r.env, ALERTS_KEY: undefined, EVENTS: ev } as never, ctx)
    await worker.scheduled(createScheduledController(), { ...r.env, ALERTS_KEY: btoa('too short'), EVENTS: ev } as never, ctx)
    await waitOnExecutionContext(ctx)
    expect(JSON.stringify(points)).toContain('"cron","not_configured"')
    expect(JSON.stringify(points)).toContain('"cron","failed"')
  })
})
