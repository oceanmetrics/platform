// the KV records (layout in env.ts and the README) ----
import { TTL } from './env.js'
import type { AddressRecord, Env, Subscription, SuppressionRecord } from './env.js'

const getJson = async <T>(env: Env, key: string): Promise<T | null> => (await env.ALERTS.get(key, 'json')) as T | null

export const getSub = (env: Env, id: string) => getJson<Subscription>(env, `sub:${id}`)
export const getAddr = (env: Env, hmac: string) => getJson<AddressRecord>(env, `addr:${hmac}`)
export const getSupp = (env: Env, hmac: string) => getJson<SuppressionRecord>(env, `supp:${hmac}`)

/** a pending record expires in 48 h; a confirmed one stays until it is deleted */
export async function putSub(env: Env, s: Subscription): Promise<void> {
  await env.ALERTS.put(`sub:${s.id}`, JSON.stringify(s), s.confirmed_at ? {} : { expirationTtl: TTL.pending })
}

/** an address with no confirmed subscription expires with its pending ones */
export async function putAddr(env: Env, hmac: string, a: AddressRecord, confirmed: boolean): Promise<void> {
  await env.ALERTS.put(`addr:${hmac}`, JSON.stringify(a), confirmed ? {} : { expirationTtl: TTL.pending })
}

/** the address's subscriptions that still exist (an expired pending one is dropped from the list) */
export async function subsOf(env: Env, a: AddressRecord): Promise<Subscription[]> {
  const subs = await Promise.all(a.subs.map((id) => getSub(env, id)))
  return subs.filter((s): s is Subscription => s != null)
}

/** end every subscription of an address: the records and the address go, the hmac stays as a suppression */
export async function endAddress(env: Env, hmac: string, reason: SuppressionRecord['reason'], at: string): Promise<number> {
  const a = await getAddr(env, hmac)
  const prev = await getSupp(env, hmac)
  const ids = a?.subs ?? []
  await Promise.all(ids.map((id) => env.ALERTS.delete(`sub:${id}`)))
  if (a) await env.ALERTS.delete(`addr:${hmac}`)
  // a bounce or a complaint is never weakened to an unsubscribe
  const keep = prev && prev.reason !== 'unsubscribed' && reason === 'unsubscribed' ? prev.reason : reason
  const epoch = Math.max(a?.epoch ?? 0, prev?.epoch ?? 0) + 1
  await env.ALERTS.put(`supp:${hmac}`, JSON.stringify({ reason: keep, at, epoch } satisfies SuppressionRecord))
  return ids.length
}

/** a subscription as the manage page sees it: the record without the hmac */
export const view = (s: Subscription) => ({
  id: s.id, title: s.title ?? null, rules: s.rules, kinds: s.kinds, cadence: s.cadence, source: s.source ?? null,
  status: s.confirmed_at ? 'confirmed' : 'pending', confirmed_at: s.confirmed_at, created_at: s.created_at, last_sent: s.last_sent ?? null,
})
