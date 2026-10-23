// POST /v1/confirm {token}: the double opt-in. the link in the mail opens a static page on oceanmetrics.io whose button
// POSTs here, so a link scanner that opens the mail confirms nothing. confirming twice is one subscription ----
import { decrypt, hmacHex, keys, manageToken, sha256Hex } from './crypto.js'
import type { Deps, Env, Subscription, TokenRecord } from './env.js'
import { clientIp, fail, json, meter, overLimit, readBody } from './http.js'
import { welcomeMail } from './mail.js'
import { provider } from './providers/index.js'
import { getAddr, getSub, putAddr, putSub, subsOf, view } from './store.js'
import { watchWords } from './validate.js'

const TOKEN = /^[A-Za-z0-9_-]{43}$/

const sameWatch = (a: Subscription, b: Subscription) =>
  a.cadence === b.cadence && JSON.stringify(a.kinds) === JSON.stringify(b.kinds) && JSON.stringify(a.rules) === JSON.stringify(b.rules)

export async function confirm(req: Request, env: Env, deps: Deps, origin: string): Promise<Response> {
  const k = await keys(env.ALERTS_KEY)
  const wait = await overLimit(env, deps, 'confirm', (await hmacHex(k.ip, clientIp(req))).slice(0, 16))
  if (wait) {
    meter(env, 'confirm', 'rate_limited', 429, 1, origin)
    return fail(429, 'rate_limited', 'too many requests; try again later', { 'retry-after': String(wait) })
  }
  const body = await readBody(req)
  const token = body.token
  if (typeof token !== 'string' || !TOKEN.test(token)) return fail(400, 'bad_token', 'token: the t= value of the confirmation link')
  const tokKey = `tok:${await sha256Hex(token)}`
  const tok = (await env.ALERTS.get(tokKey, 'json')) as TokenRecord | null
  const now = deps.now()
  if (!tok || tok.exp * 1000 < now.getTime()) {
    meter(env, 'confirm', 'expired', 404, 1, origin)
    return fail(404, 'invalid_or_expired', 'this confirmation link is unknown or older than 48 hours; subscribe again')
  }
  const addr = await getAddr(env, tok.hmac)
  const sub = await getSub(env, tok.id)
  if (!addr || !sub) {
    meter(env, 'confirm', 'expired', 404, 1, origin)
    return fail(404, 'invalid_or_expired', 'this subscription has ended; subscribe again')
  }
  const manage = await manageToken(k, tok.hmac, addr.epoch)
  if (tok.used || sub.confirmed_at) {
    meter(env, 'confirm', 'again', 200, 1, origin)
    return json({ ok: true, status: 'confirmed', already: true, manage, subscription: view(sub) })
  }

  // the same watch confirmed before: keep that one, drop this
  const others = (await subsOf(env, addr)).filter((s) => s.id !== sub.id && s.confirmed_at)
  const twin = others.find((s) => sameWatch(s, sub))
  let kept = sub
  if (twin) {
    await env.ALERTS.delete(`sub:${sub.id}`)
    addr.subs = addr.subs.filter((id) => id !== sub.id)
    kept = twin
  } else {
    sub.confirmed_at = now.toISOString().replace(/\.\d+Z$/, 'Z')
    await putSub(env, sub)
    // the next cron reads the change files again, so today's file reaches the new subscription
    await env.ALERTS.delete('cursor')
  }
  await putAddr(env, tok.hmac, addr, true)
  const ttl = Math.max(60, tok.exp - Math.floor(now.getTime() / 1000))
  await env.ALERTS.put(tokKey, JSON.stringify({ ...tok, used: true } satisfies TokenRecord), { expirationTtl: ttl })

  if (!twin) {
    const to = await decrypt(k, addr.enc, tok.hmac)
    const sent = await provider(env, deps)({ to, ...welcomeMail(env, manage, watchWords(sub), sub.cadence), idempotencyKey: `welcome:${sub.id}` })
    meter(env, 'send', sent.ok ? 'welcome_mail' : 'welcome_mail_failed', sent.status)
  }
  meter(env, 'confirm', twin ? 'duplicate' : 'confirmed', 200, 1, origin)
  return json({ ok: true, status: 'confirmed', already: !!twin, manage, subscription: view(kept) })
}
