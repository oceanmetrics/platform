// CORS (oceanmetrics.io origins only), json responses, the request body, metering and the rate limits ----
import type { Deps, Env } from './env.js'

const ALWAYS = ['https://oceanmetrics.io', 'https://www.oceanmetrics.io']
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

/** whether a browser Origin may call the API: oceanmetrics.io, localhost on any port, and ALLOWED_ORIGINS */
export function originAllowed(origin: string, env: Pick<Env, 'ALLOWED_ORIGINS'>): boolean {
  const o = origin.toLowerCase()
  if (ALWAYS.includes(o) || LOCAL.test(o)) return true
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(o)
}

export function cors(h: Headers, origin: string | null): void {
  if (!origin) return
  h.set('access-control-allow-origin', origin)
  h.append('vary', 'Origin')
  h.set('access-control-allow-methods', 'POST, OPTIONS')
  h.set('access-control-allow-headers', 'content-type')
  h.set('access-control-expose-headers', 'x-om-turnstile, retry-after')
  h.set('access-control-max-age', '86400')
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers)
  h.set('content-type', 'application/json; charset=utf-8')
  h.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers: h })
}

export const fail = (status: number, error: string, message?: string, headers: HeadersInit = {}) =>
  json({ error, ...(message ? { message } : {}) }, status, headers)

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code) }
}

const MAX_BODY = 16_384

/** the JSON body (or a form body, for RFC 8058 one-click), at most 16 kB */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large', 'the body is over 16 kB')
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text))
  if (!text.trim()) return {}
  try {
    const v = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* falls through */ }
  throw new HttpError(400, 'bad_json', 'the body must be a JSON object')
}

// metering: one Analytics Engine point per route call, mail and cron run ----
// index1 route; blob1 route, blob2 outcome, blob3 provider, blob4 origin; double1 http status (0 for the cron), double2 count

export function meter(env: Env, route: string, outcome: string, status = 0, count = 1, origin = ''): void {
  try {
    env.EVENTS?.writeDataPoint({ indexes: [route], blobs: [route, outcome, env.PROVIDER ?? 'log', origin], doubles: [status, count] })
  } catch { /* metering never fails a request */ }
}

// rate limits: a KV counter per (route, hashed client ip, window); approximate, as KV is eventually consistent ----

export interface Limit { max: number; window: number }

export const LIMITS: Record<string, Limit> = {
  subscribe: { max: 5, window: 600 },
  confirm: { max: 20, window: 600 },
  manage: { max: 30, window: 600 },
  /** confirmation mails per address an hour, whatever the ip (no mail-bombing through many ips) */
  address: { max: 3, window: 3600 },
}

/** count one call; the seconds to wait when over the limit, else 0 */
export async function overLimit(env: Env, deps: Deps, route: string, who: string, limit = LIMITS[route]): Promise<number> {
  const now = Math.floor(deps.now().getTime() / 1000)
  const w = now - (now % limit.window)
  const key = `rl:${route}:${who}:${w}`
  const n = Number((await env.ALERTS.get(key)) ?? 0)
  if (n >= limit.max) return w + limit.window - now
  await env.ALERTS.put(key, String(n + 1), { expirationTtl: w + limit.window + 60 - now })
  return 0
}

export const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'unknown'
