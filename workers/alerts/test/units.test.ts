import { describe, expect, it } from 'vitest'
import { b64url, decrypt, encrypt, hmacHex, keys, manageToken, normalise, readManageToken } from '../src/crypto'
import type { Env } from '../src/env'
import { verifySvix } from '../src/events'
import { originAllowed } from '../src/http'
import { digestMail } from '../src/mail'
import { redact } from '../src/providers/log'
import { readCadence, readKinds, readRules, readTitle, validEmail, watchWords } from '../src/validate'
import c21 from './fixtures/changes-2026-10-21.json'
import c23 from './fixtures/changes-2026-10-23.json'
import { KEY, OTHER_KEY } from './helpers'

const ENV = { SITE: 'https://oceanmetrics.io', API_BASE: 'https://alerts.example.org' } as Env

describe('the address at rest', () => {
  it('AES-GCM round trip with the key; a wrong key or a wrong hmac (the additional data) fails', async () => {
    const k = await keys(KEY)
    const enc = await encrypt(k, 'reader@example.org', 'aad1')
    expect(enc).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
    expect(enc).not.toContain('reader')
    expect(await decrypt(k, enc, 'aad1')).toBe('reader@example.org')
    await expect(decrypt(await keys(OTHER_KEY), enc, 'aad1')).rejects.toThrow()
    await expect(decrypt(k, enc, 'aad2')).rejects.toThrow()
  })

  it('two encryptions of one address differ (a random iv); its hmac is stable, 64 hex, and normalised first', async () => {
    const k = await keys(KEY)
    expect(await encrypt(k, 'a@example.org', 'x')).not.toBe(await encrypt(k, 'a@example.org', 'x'))
    const h = await hmacHex(k.addr, normalise('  Reader@Example.ORG '))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(await hmacHex(k.addr, 'reader@example.org'))
    expect(h).not.toBe(await hmacHex((await keys(OTHER_KEY)).addr, 'reader@example.org'))
  })

  it('a key shorter than 32 bytes, or none, is refused', async () => {
    await expect(keys(btoa('short'))).rejects.toThrow(/32 bytes/)
    expect(() => keys(undefined)).toThrow(/ALERTS_KEY/)
  })
})

describe('manage tokens', () => {
  it('round trip; a changed hmac, epoch or signature, or another key, is refused', async () => {
    const k = await keys(KEY)
    const h = 'a'.repeat(64)
    const t = await manageToken(k, h, 3)
    expect(await readManageToken(k, t)).toEqual({ hmac: h, epoch: 3 })
    expect(await readManageToken(k, t.replace('.3.', '.4.'))).toBeNull()
    expect(await readManageToken(k, t.replace(h, 'b'.repeat(64)))).toBeNull()
    expect(await readManageToken(k, t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA'))).toBeNull()
    expect(await readManageToken(await keys(OTHER_KEY), t)).toBeNull()
    expect(await readManageToken(k, 42)).toBeNull()
  })
})

describe('what a subscriber may ask for', () => {
  it('addresses', () => {
    for (const ok of ['a@example.org', 'first.last+tag@sub.example.com']) expect(validEmail(ok), ok).toBe(true)
    for (const bad of ['', 'a', 'a@b', 'a b@example.org', 'a@@example.org', `${'x'.repeat(250)}@example.org`, 42, null]) expect(validEmail(bad), String(bad)).toBe(false)
  })

  it('rules in three forms; the defaults when absent', () => {
    expect(readRules({})).toEqual({ places: { include: ['coll:places'], exclude: [] }, indicators: { include: ['*'], exclude: [] } })
    expect(readRules({ place: 'NMS:CINMS' })).toEqual({ places: { include: ['NMS:CINMS'], exclude: [] }, indicators: { include: ['*'], exclude: [] } })
    expect(readRules({ params: { pi: 'coll:mr_eez', ii: 'series:obis-all:*', ix: 'obis:bp' } }))
      .toEqual({ places: { include: ['coll:mr_eez'], exclude: [] }, indicators: { include: ['series:obis-all:*'], exclude: ['obis:bp'] } })
    expect(readRules({ rules: { places: { include: ['set:political'], exclude: ['MRGID:5670'] }, indicators: { include: [] } } }))
      .toEqual({ places: { include: ['set:political'], exclude: ['MRGID:5670'] }, indicators: { include: ['*'], exclude: [] } })
  })

  it('a rule with an @, a space or a comma, or too many rules, is refused', () => {
    expect(() => readRules({ place: 'a@example.org' })).toThrow(/without spaces/)
    expect(() => readRules({ rules: { places: { include: ['NMS:CINMS x'] } } })).toThrow()
    expect(() => readRules({ rules: { places: { include: Array.from({ length: 51 }, (_, i) => `p${i}`) } } })).toThrow()
  })

  it('kinds, cadence, title', () => {
    expect(readKinds(undefined)).toEqual(['status', 'new'])
    expect(readKinds(['new', 'status'])).toEqual(['status', 'new'])
    expect(() => readKinds(['worse'])).toThrow(/kinds/)
    expect(() => readKinds([])).toThrow()
    expect(readCadence(undefined)).toBe('daily')
    expect(readCadence('weekly')).toBe('weekly')
    expect(() => readCadence('hourly')).toThrow()
    expect(readTitle('CINMS condition')).toBe('CINMS condition')
    expect(() => readTitle('mail me at a@example.org')).toThrow(/no @/)
  })

  it('the watch in words', () => {
    expect(watchWords({ rules: readRules({}) })).toBe('each series’ lead indicator at the national marine sanctuaries')
    expect(watchWords({ title: 'Channel Islands', rules: readRules({}) })).toBe('Channel Islands')
  })
})

describe('CORS', () => {
  it('oceanmetrics.io and localhost only, plus ALLOWED_ORIGINS', () => {
    for (const ok of ['https://oceanmetrics.io', 'https://www.oceanmetrics.io', 'http://localhost:1313', 'http://127.0.0.1:5173', 'http://localhost'])
      expect(originAllowed(ok, {}), ok).toBe(true)
    for (const bad of ['https://evil.example.org', 'http://oceanmetrics.io', 'https://oceanmetrics.io.example.org', 'https://localhost:1313', 'null'])
      expect(originAllowed(bad, {}), bad).toBe(false)
    expect(originAllowed('https://preview.example.org', { ALLOWED_ORIGINS: 'https://preview.example.org' })).toBe(true)
  })
})

describe('the digest', () => {
  it('one place: the subject, the sentence, the Place page and the card links, the footer and the one-click headers', () => {
    const m = digestMail(ENV, { rows: c21 as never, watches: ['the sanctuaries'], manage: 'm1.tok', cadence: 'daily' })
    expect(m.subject).toBe('Ocean Metrics: 1 change at Papahānaumokuākea Marine National Monument (2026-10-21)')
    expect(m.text.split('\n')).toEqual([
      '1 change in the indicators you watch, seen 2026-10-21.',
      '',
      'Papahānaumokuākea Marine National Monument  https://oceanmetrics.io/places/p/NMS:PMNM/',
      '  - Sea surface temperature (CRW, 5 km) in Papahānaumokuākea Marine National Monument has its first status: above its own record (2025).',
      '    https://oceanmetrics.io/indicators/#view=place&place=NMS:PMNM&coll=places&ind=erddap:dhw_5km:CRW_SST:mean',
      '',
      'You get this because you asked for Ocean Metrics alerts on: the sanctuaries.',
      'Relative to its own record, not better or worse: the place’s recent years against its own earlier years.',
      'Manage: https://oceanmetrics.io/alerts/manage/#t=m1.tok',
      'Unsubscribe: https://oceanmetrics.io/alerts/manage/#t=m1.tok&u=all',
    ])
    expect(m.headers).toEqual({ 'List-Unsubscribe': '<https://alerts.example.org/v1/unsubscribe?t=m1.tok>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    expect(m.html).toContain('<a href="https://oceanmetrics.io/places/p/NMS:PMNM/">Papahānaumokuākea Marine National Monument</a>')
    expect(m.html).toContain('href="https://oceanmetrics.io/indicators/#view=place&amp;place=NMS:PMNM&amp;coll=places&amp;ind=erddap:dhw_5km:CRW_SST:mean"')
  })

  it('places in name order, a date range, never better or worse in the lines', () => {
    const m = digestMail(ENV, { rows: [...c23, ...c21] as never, watches: ['a', 'b'], manage: 't', cadence: 'weekly' })
    expect(m.subject).toBe('Ocean Metrics: 4 changes at 3 places (2026-10-21 to 2026-10-23)')
    const heads = m.text.split('\n').filter((l) => /^\S.*https:\/\/oceanmetrics\.io\/places\/p\//.test(l)).map((l) => l.split('  ')[0])
    expect(heads).toEqual(['Channel Islands National Marine Sanctuary', 'Flower Garden Banks National Marine Sanctuary', 'Papahānaumokuākea Marine National Monument'])
    const lines = m.text.split('\n').filter((l) => l.startsWith('  - ')).join('\n')
    expect(lines).not.toMatch(/better|worse|improv|deteriorat/i)
  })
})

describe('the log provider never writes an address', () => {
  it('redacts anything shaped like one', () => {
    expect(redact('to a.b+c@example.org, and <x@sub.example.com>')).toBe('to [address], and <[address]>')
  })
})

describe('Resend webhooks (Svix signatures)', () => {
  const secret = 'whsec_' + btoa('0123456789abcdef0123456789abcdef')
  const sign = async (id: string, ts: string, body: string) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('0123456789abcdef0123456789abcdef'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))))
  }
  it('a good signature passes; a changed body, an old timestamp or a wrong secret does not', async () => {
    const now = new Date('2026-10-22T09:00:00Z')
    const ts = String(now.getTime() / 1000)
    const body = '{"type":"email.bounced"}'
    const h = (sig: string, t = ts) => new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': `v1,${sig}` })
    const sig = await sign('msg_1', ts, body)
    expect(await verifySvix(secret, h(sig), body, now)).toBe(true)
    expect(await verifySvix(secret, h(`bogus v1,${sig}`.split(' ')[1].slice(3)), body, now)).toBe(true)
    expect(await verifySvix(secret, h(sig), body + ' ', now)).toBe(false)
    expect(await verifySvix(secret, h(await sign('msg_1', String(Number(ts) - 600), body), String(Number(ts) - 600)), body, now)).toBe(false)
    expect(await verifySvix('whsec_' + btoa('another secret of 32 bytes......'), h(sig), body, now)).toBe(false)
    expect(b64url(new Uint8Array([251, 255]))).toBe('-_8')
  })
})

describe('the module entry', () => {
  it('regression: exports only the default handlers (workerd refused a named VERSION export as an entrypoint)', async () => {
    const mod = await import('../src/index')
    expect(Object.keys(mod)).toEqual(['default'])
    expect(Object.keys(mod.default).sort()).toEqual(['fetch', 'scheduled'])
  })
})

describe('a long digest', () => {
  it('at most ten lines a place, then the count and a link to the place', () => {
    const base = (c21 as never as Record<string, unknown>[])[0]
    const rows = Array.from({ length: 13 }, (_, i) => ({ ...base, indicator: `ind:${i}`, sentence: `line ${i}.` }))
    const m = digestMail(ENV, { rows: rows as never, watches: ['w'], manage: 't', cadence: 'daily' })
    expect(m.subject).toBe('Ocean Metrics: 13 changes at Papahānaumokuākea Marine National Monument (2026-10-21)')
    const lines = m.text.split('\n').filter((l) => l.startsWith('  - '))
    expect(lines).toHaveLength(11)
    expect(lines.at(-1)).toBe('  - and 3 more changes at this place')
    expect(m.text).toContain('    https://oceanmetrics.io/indicators/#view=place&place=NMS:PMNM&coll=places\n')
    expect(m.html.match(/<li /g)).toHaveLength(11)
  })
})
