// @oceanmetrics/catalog/storage: the one rule for where the public bucket is read (build week 6, step 0). every app,
// Worker and pipeline builds its storage urls with storageUrl() and rebases hrefs read from published files with
// rewriteStorageUrls(), so the storage cutover (path-style S3 -> storage.oceanmetrics.io on R2) is one setting:
// DEFAULT_STORAGE_HOST below, or per app the VITE_OM_STORAGE / OM_STORAGE override read once at start. pure, no
// dependency; the python twin is om_extract.storage in oceanmetrics/extract, held to the same case table
// (fixtures/storage/cases.json).

/** the public host: the om-gazetteer Worker over R2 (after the DNS cutover; before it, Caddy 302s to S3) */
export const STORAGE_HOST = 'https://storage.oceanmetrics.io'
/** the S3 bucket, path-style: what the apps read today (CORS on every prefix, no redirect) */
export const S3_PATH_STYLE = 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public'
/** the S3 bucket, virtual-hosted style: a legacy form some older hrefs carry */
export const S3_VIRTUAL_HOST = 'https://oceanmetrics.io-public.s3.amazonaws.com'
/** the om-gazetteer Worker on workers.dev: the preview and the rehearsal host */
export const WORKER_PREVIEW = 'https://om-gazetteer.ben-f07.workers.dev'

/** every host the bucket answers on, the names a setting may use */
export const STORAGE_HOSTS = { storage: STORAGE_HOST, s3: S3_PATH_STYLE, 's3-virtual': S3_VIRTUAL_HOST, preview: WORKER_PREVIEW } as const
export type StorageHostName = keyof typeof STORAGE_HOSTS

/** the constant names a setting or the om-publish.sh command line may use for the same hosts */
const CONSTANT_NAMES: Record<string, string> = { STORAGE_HOST, S3_PATH_STYLE, S3_VIRTUAL_HOST, WORKER_PREVIEW }

/**
 * the host every storage url uses unless a setting overrides it. path-style S3 until the DNS cutover of
 * storage.oceanmetrics.io (week 6 step 2); the cutover flips this one line to STORAGE_HOST and every app, Worker and
 * pipeline follows at its next build.
 */
export const DEFAULT_STORAGE_HOST: string = S3_PATH_STYLE

/** where an app reads its override, once at start: the Vite env (browser builds), the process env (Node, Workers' vars), the page attribute (embeds) */
export const STORAGE_ENV = { vite: 'VITE_OM_STORAGE', node: 'OM_STORAGE', attribute: 'data-om-storage' } as const

const trim = (s: string) => s.replace(/\/+$/, '')
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/

/**
 * a setting as a host url (no trailing slash), or null when it is empty or malformed: a name of STORAGE_HOSTS
 * (`storage`, `s3`, `s3-virtual`, `preview`), a constant name (`STORAGE_HOST`, `S3_PATH_STYLE`, ...), an https url, or
 * an http url on localhost (a dev server).
 */
export function parseStorageHost(value: string | null | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  if (Object.hasOwn(STORAGE_HOSTS, v)) return STORAGE_HOSTS[v as StorageHostName]
  if (Object.hasOwn(CONSTANT_NAMES, v)) return CONSTANT_NAMES[v]
  if (!/^https:\/\/[^/?#\s]+/.test(v) && !LOCAL.test(v)) return null
  if (/[?#\s]/.test(v)) return null
  return trim(v)
}

/** the first well-formed setting of `candidates` (in precedence order), else DEFAULT_STORAGE_HOST; a malformed one is skipped */
export function resolveStorageHost(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const h = parseStorageHost(c)
    if (h) return h
  }
  return DEFAULT_STORAGE_HOST
}

export interface StorageUrlOptions {
  /** the host or a setting naming it (see parseStorageHost); absent or malformed = DEFAULT_STORAGE_HOST */
  host?: string | null
  /** the reader's key, added as `?key=` (the Worker's keyed reads: atlas-restricted, unlisted, past the anonymous rate) */
  apiKey?: string | null
}

/**
 * the url of `key` (an object key or a prefix, e.g. `indicators/indicators.json` or `gazetteer/`) on the storage host.
 * leading slashes are dropped; the key is used as given (keys are url-safe), its own query string kept.
 */
export function storageUrl(key: string, opts: StorageUrlOptions = {}): string {
  const host = resolveStorageHost(opts.host)
  const url = `${host}/${key.replace(/^\/+/, '')}`
  if (!opts.apiKey) return url
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(opts.apiKey)}`
}

export interface RewriteOptions {
  /** the host (or hosts) to replace; each a host url or a setting naming it */
  from: string | readonly string[]
  /** the host to write; a host url or a setting naming it */
  to: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// a host ends at a path, a query, a fragment, a quote, a bracket, whitespace or the end; so
// `.../oceanmetrics.io-public-x/` and `storage.oceanmetrics.io.example.org` are other hosts and stay
const END = '(?=[/?#"\'\\s)<>\\]\\\\]|$)'

function hostPattern(from: RewriteOptions['from']): RegExp {
  const hosts = (typeof from === 'string' ? [from] : [...from]).map(h => {
    const p = parseStorageHost(h)
    if (!p) throw new Error(`rewriteStorageUrls: not a host: ${JSON.stringify(h)}`)
    return p
  })
  // longest first, so a host that prefixes another never takes its match
  const alt = [...new Set(hosts)].sort((a, b) => b.length - a.length).map(escape).join('|')
  return new RegExp(`(?:${alt})${END}`, 'g')
}

function toHost(to: string): string {
  const t = parseStorageHost(to)
  if (!t) throw new Error(`rewriteStorageUrls: not a host: ${JSON.stringify(to)}`)
  return t
}

function rewriteText(text: string, re: RegExp, to: string): [string, number] {
  let n = 0
  const out = text.replace(re, () => { n++; return to })
  return [out, n]
}

function walk(value: unknown, re: RegExp, to: string, count: { n: number }): unknown {
  if (typeof value === 'string') {
    const [s, n] = rewriteText(value, re, to)
    count.n += n
    return s
  }
  if (Array.isArray(value)) return value.map(v => walk(v, re, to, count))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, re, to, count)
    return out
  }
  return value
}

/**
 * `input` with every url on a `from` host moved to the `to` host, the path, query and fragment kept. a string is
 * rewritten as text (a published file keeps its bytes apart from the hosts); any other value is walked and its string
 * values rewritten (keys are left alone), returning a new value. a url on any other host (Marine Regions, ERDDAP, a
 * host that only begins with a storage host's name) is never changed.
 */
export function rewriteStorageUrls<T>(input: T, opts: RewriteOptions): T {
  return rewriteStorageUrlsCounted(input, opts).value
}

/** rewriteStorageUrls and the number of urls it moved: the dry-run report of the cutover's rewrite */
export function rewriteStorageUrlsCounted<T>(input: T, opts: RewriteOptions): { value: T; count: number } {
  const re = hostPattern(opts.from)
  const to = toHost(opts.to)
  const count = { n: 0 }
  const value = walk(input, re, to, count) as T
  return { value, count: count.n }
}

/** how many urls on a `from` host `input` carries (text or a JSON value) */
export function countStorageUrls(input: unknown, from: RewriteOptions['from']): number {
  return rewriteStorageUrlsCounted(input, { from, to: STORAGE_HOST }).count
}
