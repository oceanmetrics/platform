// a Worker env over the real (miniflare) KV with a fake network, a fixed clock and a fake Analytics Engine ----
import { env } from 'cloudflare:test'
import type { Deps, Env } from '../src/env'
import { handle } from '../src/app'
import { RESEND_URL } from '../src/providers/resend'
import { SITEVERIFY } from '../src/turnstile'
import c21 from './fixtures/changes-2026-10-21.json'
import c22 from './fixtures/changes-2026-10-22.json'
import c23 from './fixtures/changes-2026-10-23.json'
import indicators from './fixtures/indicators.json'
import latest from './fixtures/latest.json'

/** test keys only (bytes 0..31 and 32..63): the real ALERTS_KEY is a secret on the mini */
export const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)))
export const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 32)))
export const BASE = 'https://data.example.org/indicators/'
export const SITE = 'https://oceanmetrics.io'
export const API = 'https://alerts.example.org'
export const ORIGIN = 'https://oceanmetrics.io'

export const FILES: Record<string, unknown[]> = { '2026-10-21': c21, '2026-10-22': c22, '2026-10-23': c23 }
export { indicators, latest }

export interface Point { indexes: string[]; blobs: string[]; doubles: number[] }
export interface SentMail { to: string; from: string; subject: string; text: string; html: string; headers: Record<string, string>; key: string | null; reply_to?: string }

export interface Net {
  latest: unknown
  files: Record<string, unknown[]>
  /** the status Resend answers, one per call (200 when empty) */
  resend: number[]
  fetched: string[]
}

export interface Rig { env: Env; deps: Deps; points: Point[]; mails: SentMail[]; net: Net; clock: { now: Date } }

export function rig(over: Partial<Env> = {}, net: Partial<Net> = {}): Rig {
  const points: Point[] = []
  const mails: SentMail[] = []
  const n: Net = { latest, files: FILES, resend: [], fetched: [], ...net }
  const clock = { now: new Date('2026-10-22T09:00:00Z') }
  const e = {
    ALERTS: env.ALERTS,
    EVENTS: { writeDataPoint: (p: Point) => { points.push(p) } },
    PROVIDER: 'resend', RESEND_KEY: 'test-resend-key', SITE, API_BASE: API, CHANGES_BASE: BASE, ALERTS_KEY: KEY,
    ...over,
  } as unknown as Env
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    n.fetched.push(url)
    if (url === RESEND_URL) {
      const b = JSON.parse(String(init?.body))
      const h = new Headers(init?.headers)
      const status = n.resend.shift() ?? 200
      if (status === 200) mails.push({ to: b.to[0], from: b.from, subject: b.subject, text: b.text, html: b.html, headers: b.headers ?? {}, key: h.get('idempotency-key'), reply_to: b.reply_to })
      return Response.json(status === 200 ? { id: `re_${mails.length}` } : { name: 'error' }, { status })
    }
    if (url === SITEVERIFY) {
      const form = init?.body as FormData
      return Response.json({ success: form.get('response') === 'pass' && form.get('secret') === 'ts-secret' })
    }
    if (url === `${BASE}changes/latest.json`) return Response.json(n.latest)
    if (url === `${BASE}indicators.json`) return Response.json(indicators)
    const m = /changes\/(\d{4}-\d{2}-\d{2})\.json$/.exec(url)
    if (m && n.files[m[1]]) return Response.json(n.files[m[1]])
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { env: e, deps: { fetch: fetcher, now: () => clock.now }, points, mails, net: n, clock }
}

export interface CallOpts { origin?: string | null; ip?: string; headers?: Record<string, string>; method?: string; raw?: string }

export function call(r: Rig, path: string, body?: unknown, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': o.ip ?? '203.0.113.7', ...o.headers }
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN
  const method = o.method ?? 'POST'
  const init: RequestInit = { method, headers }
  if (method === 'POST') init.body = o.raw ?? JSON.stringify(body ?? {})
  return handle(new Request(`${API}${path}`, init), r.env, r.deps)
}

/** the token of a link `#t=...` in a mail */
export const tokenIn = (text: string, page = 'confirm') => {
  const m = new RegExp(`/alerts/${page}/#t=([A-Za-z0-9._-]+)`).exec(text)
  if (!m) throw new Error(`no ${page} link in the mail`)
  return m[1]
}

/** subscribe and confirm through the routes, as the pages do; the clock at `at` */
export async function subscribed(r: Rig, email: string, body: Record<string, unknown> = {}, at = '2026-10-20T10:00:00Z') {
  const was = r.clock.now
  r.clock.now = new Date(at)
  const s = await call(r, '/v1/subscribe', { email, ...body }, { ip: `198.51.100.${r.mails.length % 250}` })
  if (s.status !== 202) throw new Error(`subscribe: ${s.status} ${await s.text()}`)
  const token = tokenIn(r.mails.at(-1)!.text)
  const c = await call(r, '/v1/confirm', { token })
  if (c.status !== 200) throw new Error(`confirm: ${c.status} ${await c.text()}`)
  const out = (await c.json()) as { manage: string; subscription: { id: string } }
  r.clock.now = was
  return { token, manage: out.manage, id: out.subscription.id }
}

/** every key in the KV namespace and its raw value */
export async function dump(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const list = await env.ALERTS.list()
  for (const k of list.keys) out[k.name] = (await env.ALERTS.get(k.name)) ?? ''
  return out
}
