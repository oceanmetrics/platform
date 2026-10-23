// the hourly cron: read changes/latest.json; for each confirmed address whose digest is due, read the change files
// since each subscription's last_sent, pick the rows its rules and kinds select (@oceanmetrics/catalog/report, the
// rules the Report view expands), and send one mail per address per day at most ----
import { changeKey } from '@oceanmetrics/catalog/changes'
import type { ChangeRow } from '@oceanmetrics/catalog/changes'
import { selectRows } from '@oceanmetrics/catalog/report'
import type { IndicatorLike, PlaceSetLike, RuleContext } from '@oceanmetrics/catalog/report'
import { decrypt, keys, manageToken } from './crypto.js'
import { changesBase, TTL } from './env.js'
import type { Cursor, Deps, Env, SentRecord, Subscription } from './env.js'
import { meter } from './http.js'
import { digestMail } from './mail.js'
import { provider } from './providers/index.js'
import { getAddr, putSub } from './store.js'
import { watchWords } from './validate.js'

/** changes/latest.json (schemas/changes-latest.schema.json), the fields the cron reads */
export interface Latest {
  date: string | null
  checked_at: string
  manifest_version?: string
  recent: { date: string; href: string }[]
}

export interface RunSummary {
  idle: boolean
  date: string | null
  addresses: number
  sent: number
  quiet: number
  failed: number
  pending: number
  rows: number
}

const day = (d: Date) => d.toISOString().slice(0, 10)

async function getJson<T>(deps: Deps, url: string): Promise<T> {
  const res = await deps.fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return (await res.json()) as T
}

/** the rules' context: each indicator's series, lead and tags and the place sets; kept in KV per manifest version */
export async function ruleContext(env: Env, deps: Deps, version: string | undefined): Promise<RuleContext> {
  const key = `ctx:${version ?? 'latest'}`
  const hit = (await env.ALERTS.get(key, 'json')) as RuleContext | null
  if (hit) return hit
  const m = await getJson<{ indicators: IndicatorLike[]; place_sets?: PlaceSetLike[] }>(deps, `${changesBase(env)}indicators.json`)
  const ctx: RuleContext = {
    indicators: m.indicators.map((i) => ({ id: i.id, series: i.series, lead: i.lead, ...(i.category ? { category: i.category } : {}) })),
    sets: (m.place_sets ?? []).map((s) => ({ id: s.id, groups: [...s.groups] })),
  }
  await env.ALERTS.put(key, JSON.stringify(ctx), { expirationTtl: version ? TTL.ctx : 3600 })
  return ctx
}

/** a subscription's first change date not yet mailed: the day after last_sent, else the day it was confirmed */
const sinceOf = (s: Subscription) => s.last_sent ?? null
const after = (s: Subscription, date: string) => {
  const since = sinceOf(s)
  return since ? date > since : date >= (s.confirmed_at ?? '').slice(0, 10)
}

async function confirmedSubs(env: Env): Promise<Subscription[]> {
  const out: Subscription[] = []
  let cursor: string | undefined
  do {
    const page = await env.ALERTS.list({ prefix: 'sub:', cursor })
    const subs = await Promise.all(page.keys.map((k) => env.ALERTS.get(k.name, 'json') as Promise<Subscription | null>))
    for (const s of subs) if (s?.confirmed_at) out.push(s)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return out
}

export async function runDigests(env: Env, deps: Deps): Promise<RunSummary> {
  const now = deps.now()
  const today = day(now)
  const base = changesBase(env)
  const sum: RunSummary = { idle: false, date: null, addresses: 0, sent: 0, quiet: 0, failed: 0, pending: 0, rows: 0 }
  const k = await keys(env.ALERTS_KEY)
  const latest = await getJson<Latest>(deps, `${base}changes/latest.json`)
  sum.date = latest.date
  const prev = (await env.ALERTS.get('cursor', 'json')) as Cursor | null
  if (!latest.date || (prev && prev.date === latest.date && prev.pending === 0)) {
    sum.idle = true
    meter(env, 'cron', 'idle')
    return sum
  }
  const files = [...latest.recent].sort((a, b) => a.date.localeCompare(b.date))
  const rowsOf = new Map<string, Promise<ChangeRow[]>>()
  const load = (f: { date: string; href: string }) => {
    let p = rowsOf.get(f.date)
    if (!p) rowsOf.set(f.date, (p = getJson<ChangeRow[]>(deps, new URL(f.href, base).href)))
    return p
  }
  let ctx: RuleContext | null = null
  const send = provider(env, deps)
  const monday = now.getUTCDay() === 1

  const byAddr = new Map<string, Subscription[]>()
  for (const s of await confirmedSubs(env)) byAddr.set(s.hmac, [...(byAddr.get(s.hmac) ?? []), s])
  for (const subs of byAddr.values()) subs.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

  for (const [hmac, subs] of byAddr) {
    sum.addresses++
    const sentKey = `sent:${hmac}:${today}`
    const marker = (await env.ALERTS.get(sentKey, 'json')) as SentRecord | null
    if (marker?.state === 'sent') {
      // the daily cap: this address had its mail today; what is newer waits for tomorrow
      sum.pending += subs.filter((s) => files.some((f) => after(s, f.date))).length
      continue
    }
    const due: { sub: Subscription; dates: string[]; rows: ChangeRow[] }[] = []
    for (const sub of subs) {
      // a retry keeps to the files of the first attempt, so a provider's idempotent replay matches what is recorded
      const fs = files.filter((f) => after(sub, f.date) && (!marker || f.date <= marker.upto))
      if (!fs.length) continue
      if (sub.cadence === 'weekly' && !monday) { sum.pending++; continue }
      ctx ??= await ruleContext(env, deps, latest.manifest_version)
      const rows = (await Promise.all(fs.map(load))).flat()
      const picked = selectRows(sub.rules, rows, ctx).filter((r) => (sub.kinds as string[]).includes(r.kind))
      due.push({ sub, dates: fs.map((f) => f.date), rows: picked })
    }
    if (!due.length) continue
    const upto = due.flatMap((d) => d.dates).sort().at(-1)!
    const seen = new Set<string>()
    const rows = due.flatMap((d) => d.rows).filter((r) => !seen.has(changeKey(r)) && !!seen.add(changeKey(r)))
    const advance = () => Promise.all(due.map((d) => putSub(env, { ...d.sub, last_sent: d.dates.at(-1)! })))
    if (!rows.length) {
      // nothing the rules select: the window moves, no mail
      await advance()
      sum.quiet++
      continue
    }
    const addr = await getAddr(env, hmac)
    if (!addr) { meter(env, 'cron', 'orphan'); continue }
    const to = await decrypt(k, addr.enc, hmac)
    const mail = digestMail(env, {
      rows, manage: await manageToken(k, hmac, addr.epoch), cadence: due.some((d) => d.sub.cadence === 'weekly') ? 'weekly' : 'daily',
      watches: due.filter((d) => d.rows.length).map((d) => watchWords(d.sub)),
    })
    const attempts = (marker?.attempts ?? 0) + 1
    // the marker first: a crash after the send never gives a second mail (the retry reuses the idempotency key)
    await env.ALERTS.put(sentKey, JSON.stringify({ state: 'pending', upto, at: now.toISOString(), attempts } satisfies SentRecord), { expirationTtl: TTL.sent })
    const res = await send({ to, ...mail, idempotencyKey: `digest:${hmac}:${today}` })
    if (res.ok) {
      await env.ALERTS.put(sentKey, JSON.stringify({ state: 'sent', upto, at: now.toISOString(), rows: rows.length, attempts } satisfies SentRecord), { expirationTtl: TTL.sent })
      await advance()
      sum.sent++
      sum.rows += rows.length
      meter(env, 'send', 'digest', res.status, rows.length)
    } else {
      sum.failed++
      sum.pending += due.length
      meter(env, 'send', res.retry ? 'digest_retry' : 'digest_failed', res.status)
      // a refusal that a retry cannot fix stops for the day (the window does not move: tomorrow tries once more)
      if (!res.retry) await env.ALERTS.put(sentKey, JSON.stringify({ state: 'sent', upto, at: now.toISOString(), rows: 0, attempts } satisfies SentRecord), { expirationTtl: TTL.sent })
    }
  }
  const next: Cursor = { date: latest.date, pending: sum.pending, checked_at: now.toISOString() }
  if (!prev || prev.date !== next.date || prev.pending !== next.pending) await env.ALERTS.put('cursor', JSON.stringify(next))
  meter(env, 'cron', 'run', 0, sum.sent)
  return sum
}
