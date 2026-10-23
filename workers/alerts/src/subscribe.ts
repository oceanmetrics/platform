// POST /v1/subscribe {email, rules | params | place, kinds, cadence, title, source, turnstile} -> a pending record and
// the confirmation mail. the answer is the same whether the address is new, known or suppressed (no enumeration) ----
import { encrypt, hmacHex, keys, normalise, randomToken, sha256Hex } from './crypto.js'
import { TTL } from './env.js'
import type { AddressRecord, Deps, Env, Subscription, TokenRecord } from './env.js'
import { clientIp, fail, json, meter, overLimit, readBody } from './http.js'
import { confirmMail } from './mail.js'
import { provider } from './providers/index.js'
import { getAddr, getSupp, putAddr, putSub, subsOf } from './store.js'
import { turnstile } from './turnstile.js'
import { readCadence, readKinds, readRules, readSource, readTitle, validEmail, watchWords } from './validate.js'

/** the most subscriptions one address may hold */
export const MAX_SUBS = 20

export async function subscribe(req: Request, env: Env, deps: Deps, origin: string): Promise<Response> {
  const k = await keys(env.ALERTS_KEY)
  const ip = clientIp(req)
  const ipHash = (await hmacHex(k.ip, ip)).slice(0, 16)
  const wait = await overLimit(env, deps, 'subscribe', ipHash)
  if (wait) {
    meter(env, 'subscribe', 'rate_limited', 429, 1, origin)
    return fail(429, 'rate_limited', 'too many requests; try again later', { 'retry-after': String(wait) })
  }
  const body = await readBody(req)
  if (!validEmail(body.email)) {
    meter(env, 'subscribe', 'bad_email', 400, 1, origin)
    return fail(400, 'bad_email', 'email: one address')
  }
  const rules = readRules(body), kinds = readKinds(body.kinds), cadence = readCadence(body.cadence)
  const title = readTitle(body.title), source = readSource(body.source)

  const ts = await turnstile(env, deps, body.turnstile, ip)
  const headers: Record<string, string> = ts === 'skipped' ? { 'x-om-turnstile': 'skipped' } : {}
  if (ts === 'failed') {
    meter(env, 'subscribe', 'turnstile_failed', 403, 1, origin)
    return fail(403, 'turnstile_failed', 'the anti-robot check did not pass; reload the page and try again')
  }
  const accepted = () => json({ ok: true, status: 'pending', expires_in: TTL.pending }, 202, headers)

  const email = normalise(body.email)
  const hmac = await hmacHex(k.addr, email)
  const supp = await getSupp(env, hmac)
  if (supp && supp.reason !== 'unsubscribed') {
    // a bounce or a complaint: never mail it again
    meter(env, 'subscribe', 'suppressed', 202, 1, origin)
    return accepted()
  }
  if (await overLimit(env, deps, 'address', hmac.slice(0, 16))) {
    meter(env, 'subscribe', 'address_limited', 202, 1, origin)
    return accepted()
  }
  const prev = await getAddr(env, hmac)
  const subs = prev ? await subsOf(env, prev) : []
  if (subs.length >= MAX_SUBS) {
    meter(env, 'subscribe', 'too_many', 202, 1, origin)
    return accepted()
  }

  const now = deps.now()
  const sub: Subscription = {
    id: randomToken(18), hmac, kinds, cadence, rules, title, source,
    confirmed_at: null, created_at: now.toISOString().replace(/\.\d+Z$/, 'Z'), last_sent: null,
  }
  const addr: AddressRecord = {
    enc: prev?.enc ?? (await encrypt(k, email, hmac)),
    subs: [...subs.map((s) => s.id), sub.id],
    epoch: prev?.epoch ?? supp?.epoch ?? 0,
  }
  const token = randomToken(32)
  const tok: TokenRecord = { id: sub.id, hmac, exp: Math.floor(now.getTime() / 1000) + TTL.pending }
  await putSub(env, sub)
  await putAddr(env, hmac, addr, subs.some((s) => s.confirmed_at))
  await env.ALERTS.put(`tok:${await sha256Hex(token)}`, JSON.stringify(tok), { expirationTtl: TTL.pending })

  const sent = await provider(env, deps)({ to: email, ...confirmMail(env, token, watchWords(sub)), idempotencyKey: `confirm:${sub.id}` })
  meter(env, 'send', sent.ok ? 'confirm_mail' : 'confirm_mail_failed', sent.status)
  if (!sent.ok) {
    meter(env, 'subscribe', 'send_failed', 502, 1, origin)
    return fail(502, 'send_failed', 'the confirmation mail could not be sent; try again later', headers)
  }
  meter(env, 'subscribe', 'pending', 202, 1, origin)
  return accepted()
}
