// bindings, vars and the KV layout ----
import { DEFAULT_INDICATORS_BASE } from '@oceanmetrics/catalog/cards'

/** the Worker's bindings (wrangler.toml) and secrets (`wrangler secret put`) */
export interface Env {
  /** KV: the subscriptions, the encrypted addresses and the counters (README "KV layout") */
  ALERTS: KVNamespace
  /** Analytics Engine `om_alerts`: one point per route call, mail and cron run; counts only, never an address */
  EVENTS?: AnalyticsEngineDataset
  /** `log` (Analytics Engine and the console, nothing leaves) or `resend` (needs RESEND_KEY) */
  PROVIDER?: string
  /** the site whose static pages confirm and manage (https://oceanmetrics.io) */
  SITE?: string
  /** this Worker's public url, for the List-Unsubscribe header */
  API_BASE?: string
  /** the indicators catalog root: changes/latest.json, changes/<date>.json, indicators.json */
  CHANGES_BASE?: string
  /** the From of every mail */
  FROM?: string
  /** Reply-To (the public contact, ben@oceanmetrics.io, in wrangler.toml); unset sends none */
  REPLY_TO?: string
  /** extra allowed Origins, comma separated (oceanmetrics.io and localhost are always allowed) */
  ALLOWED_ORIGINS?: string
  /** secret: base64 of at least 32 random bytes; the AES-GCM, HMAC and token keys are derived from it (HKDF) */
  ALERTS_KEY?: string
  /** secret: the Resend API key (sending only, for oceanmetrics.io) */
  RESEND_KEY?: string
  /** secret: Turnstile; when unset the check is skipped and the response says so (`x-om-turnstile: skipped`) */
  TURNSTILE_SECRET?: string
  /** secret: Resend's webhook signing secret (`whsec_...`) for /v1/provider-events */
  RESEND_WEBHOOK_SECRET?: string
}

/** what the handlers take besides the env, so the tests can pass a fake network and a fixed clock */
export interface Deps {
  fetch: typeof fetch
  now: () => Date
}

export const defaultDeps = (): Deps => ({ fetch: (input, init) => fetch(input, init), now: () => new Date() })

export const DEFAULTS = {
  SITE: 'https://oceanmetrics.io',
  API_BASE: 'https://om-alerts.ben-f07.workers.dev',
  // the indicators root on the storage rule's default host (storage.oceanmetrics.io since catalog 0.6.0, the cutover of 2026-10-23)
  CHANGES_BASE: DEFAULT_INDICATORS_BASE,
  FROM: 'Ocean Metrics alerts <alerts@oceanmetrics.io>',
} as const

export const site = (env: Env) => (env.SITE ?? DEFAULTS.SITE).replace(/\/+$/, '')
export const apiBase = (env: Env) => (env.API_BASE ?? DEFAULTS.API_BASE).replace(/\/+$/, '')
export const changesBase = (env: Env) => (env.CHANGES_BASE ?? DEFAULTS.CHANGES_BASE).replace(/\/*$/, '/')

// the KV layout ----
// sub:<id>             the subscription record (schema alerts-subscription 1.0); pending ones expire in 48 h
// addr:<hmac>          { enc, subs, epoch }: the address (AES-GCM) and its subscription ids
// tok:<sha256(token)>  { id, hmac, exp, used? }: a confirm token, by its hash only, 48 h
// sent:<hmac>:<day>    { state, upto, at }: the day's digest of an address (the daily cap and the send idempotency), 40 days
// supp:<hmac>          { reason, at, epoch }: an address that unsubscribed, bounced or complained
// ctx:<manifest>       the indicators' series, leads and tags and the place sets, for the rules, 3 days
// cursor               { date, pending, checked_at }: the last change date the cron saw, and how many subscriptions wait
// rl:<route>:<ip>:<w>  a request counter per (hashed) client ip and window

export const TTL = {
  pending: 48 * 3600,
  sent: 40 * 86400,
  ctx: 3 * 86400,
} as const

export const KINDS = ['status', 'new', 'period'] as const
export type Kind = (typeof KINDS)[number]
export const DEFAULT_KINDS: Kind[] = ['status', 'new']
export type Cadence = 'daily' | 'weekly'
export type Source = 'place' | 'report' | 'alerts'

export interface RuleSet { include: string[]; exclude: string[] }
export interface Rules { places: RuleSet; indicators: RuleSet }

/** `sub:<id>`: schemas/alerts-subscription.schema.json, and nothing more (no address, name, organization or ip) */
export interface Subscription {
  id: string
  hmac: string
  kinds: Kind[]
  cadence: Cadence
  rules: Rules
  title?: string | null
  source?: Source
  confirmed_at: string | null
  created_at: string
  last_sent?: string | null
}

/** `addr:<hmac>` */
export interface AddressRecord {
  /** `v1.<iv>.<ciphertext>`, base64url, AES-GCM with the hmac as additional data */
  enc: string
  subs: string[]
  /** bumped when every subscription of the address ends, so an old manage link stops working */
  epoch: number
}

export interface TokenRecord { id: string; hmac: string; exp: number; used?: boolean }
export interface SentRecord { state: 'pending' | 'sent'; upto: string; at: string; rows?: number; attempts?: number }
export interface SuppressionRecord { reason: 'unsubscribed' | 'bounce' | 'complaint'; at: string; epoch: number }
export interface Cursor { date: string | null; pending: number; checked_at: string }
