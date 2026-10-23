// POST /v1/manage {token, action, id, rules | params | place, kinds, cadence, title}: list and change the subscriptions
// of an address by its signed manage token. POST /v1/unsubscribe: the RFC 8058 one-click target, and the page's button ----
import { hmacHex, keys, readManageToken } from './crypto.js'
import type { Deps, Env } from './env.js'
import { clientIp, fail, json, meter, overLimit, readBody } from './http.js'
import { endAddress, getAddr, putAddr, putSub, subsOf, view } from './store.js'
import { readCadence, readKinds, readRules, readTitle } from './validate.js'

const stamp = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z')

export async function manage(req: Request, env: Env, deps: Deps, origin: string): Promise<Response> {
  const k = await keys(env.ALERTS_KEY)
  const wait = await overLimit(env, deps, 'manage', (await hmacHex(k.ip, clientIp(req))).slice(0, 16))
  if (wait) {
    meter(env, 'manage', 'rate_limited', 429, 1, origin)
    return fail(429, 'rate_limited', 'too many requests; try again later', { 'retry-after': String(wait) })
  }
  const body = await readBody(req)
  const who = await readManageToken(k, body.token)
  if (!who) return fail(403, 'bad_token', 'token: the t= value of a manage link')
  const addr = await getAddr(env, who.hmac)
  if (!addr || addr.epoch !== who.epoch) {
    meter(env, 'manage', 'gone', 404, 1, origin)
    return fail(404, 'not_found', 'no subscription for this link (it may have been unsubscribed)')
  }
  let subs = await subsOf(env, addr)
  const action = body.action ?? 'list'
  const find = () => {
    const s = subs.find((x) => x.id === body.id)
    if (!s) throw Object.assign(new Error('no such subscription'), { http: 404 })
    return s
  }
  try {
    if (action === 'update') {
      const s = find()
      if (body.rules != null || body.params != null || body.place != null) s.rules = readRules(body)
      if (body.kinds != null) s.kinds = readKinds(body.kinds)
      if (body.cadence != null) s.cadence = readCadence(body.cadence)
      if (body.title !== undefined) s.title = readTitle(body.title)
      await putSub(env, s)
      await env.ALERTS.delete('cursor')
    } else if (action === 'delete') {
      const s = find()
      if (subs.length === 1) {
        await endAddress(env, who.hmac, 'unsubscribed', stamp(deps.now()))
        meter(env, 'unsubscribe', 'manage_last', 200, 1, origin)
        return json({ ok: true, status: 'unsubscribed', subscriptions: [] })
      }
      await env.ALERTS.delete(`sub:${s.id}`)
      addr.subs = addr.subs.filter((id) => id !== s.id)
      subs = subs.filter((x) => x.id !== s.id)
      await putAddr(env, who.hmac, addr, subs.some((x) => x.confirmed_at))
    } else if (action === 'unsubscribe') {
      const n = await endAddress(env, who.hmac, 'unsubscribed', stamp(deps.now()))
      meter(env, 'unsubscribe', 'manage', 200, n, origin)
      return json({ ok: true, status: 'unsubscribed', subscriptions: [] })
    } else if (action !== 'list') {
      return fail(400, 'bad_action', 'action: list, update, delete or unsubscribe')
    }
  } catch (e) {
    if ((e as { http?: number }).http === 404) return fail(404, 'not_found', 'no such subscription')
    throw e
  }
  meter(env, 'manage', action as string, 200, 1, origin)
  return json({ ok: true, status: 'active', subscriptions: subs.map(view) })
}

/**
 * one-click unsubscribe (RFC 8058): the mail client POSTs `List-Unsubscribe=One-Click` (form encoded) to the URL of the
 * List-Unsubscribe header, `/v1/unsubscribe?t=<manage token>`. the manage page's button POSTs `{token}` as JSON. both end
 * every subscription of the address; a second call answers the same. never rate limited (the token is the guard).
 */
export async function unsubscribe(req: Request, env: Env, deps: Deps, origin: string): Promise<Response> {
  const k = await keys(env.ALERTS_KEY)
  const body = await readBody(req)
  const token = new URL(req.url).searchParams.get('t') ?? body.token
  const who = await readManageToken(k, token)
  if (!who) return fail(403, 'bad_token', 'the unsubscribe link is not valid')
  const addr = await getAddr(env, who.hmac)
  if (addr && addr.epoch === who.epoch) {
    const n = await endAddress(env, who.hmac, 'unsubscribed', stamp(deps.now()))
    meter(env, 'unsubscribe', body['List-Unsubscribe'] === 'One-Click' ? 'one_click' : 'page', 200, n, origin)
  } else {
    meter(env, 'unsubscribe', 'again', 200, 0, origin)
  }
  return json({ ok: true, status: 'unsubscribed' })
}
