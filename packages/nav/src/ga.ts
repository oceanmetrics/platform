// google analytics (GA4) for the Ocean Metrics pages, off unless the page passes a measurement id (no id lives in any
// repo: each consumer reads it from a build variable and sets <om-nav data-ga>). every hit carries an explicit
// page_location rebuilt from origin + path (+ the `keep` keys with short plain values), never the live href: a query
// or fragment can carry a place polygon, a report title or a search. page_title is the document title, or `title`. the GA4 stream's enhanced measurement
// "page changes based on browser history events" must be OFF (README "Analytics"): this module sends those itself.

/** what the helper reads off the page; `globalThis` in a browser, a stub in a test */
export interface GaWindow {
  document: { title: string; head: { appendChild(n: unknown): unknown }; createElement(tag: 'script'): { async: boolean; src: string } }
  location: { origin: string; pathname: string; search: string; hash: string }
  navigator?: { doNotTrack?: string | null; globalPrivacyControl?: boolean }
  history?: { pushState(...a: unknown[]): void; replaceState(...a: unknown[]): void }
  addEventListener?(type: string, fn: () => void): void
  setTimeout?(fn: () => void, ms?: number): unknown
  doNotTrack?: string | null
  dataLayer?: unknown[]
  gtag?: (...a: unknown[]) => void
  /** set to anything truthy before the bar loads to keep analytics off on that page */
  __om_ga_disabled?: unknown
  /** the id installed on this page (the once guard) */
  __om_ga?: string
}

export interface GaOptions {
  /** `anonymize_ip: true` on the config (default true) */
  anonymize?: boolean
  /** `'history'` (default): a page_view on load and on each change of the rebuilt location (pushState, replaceState,
   * popstate, hashchange); `'load'`: on load only; `false`: none */
  pageView?: 'history' | 'load' | false
  /** query or hash keys whose value (1 to 40 of `[A-Za-z0-9_.-]`) is kept in page_location, e.g. `['view']` */
  keep?: readonly string[]
  /** a fixed page_title for every hit, for a page whose document title can hold reader text (a report title);
   * default the document title */
  title?: string
  /** the page; default `globalThis` */
  win?: GaWindow
}

export const GA_ID_RE = /^G-[A-Z0-9]{4,16}$/
export const GA_SRC = 'https://www.googletagmanager.com/gtag/js?id='

/** may this page load analytics: not disabled by `window.__om_ga_disabled`, no Do Not Track, no Global Privacy Control */
export function gaAllowed(w: GaWindow): boolean {
  const n = w.navigator ?? {}
  return !w.__om_ga_disabled && n.doNotTrack !== '1' && w.doNotTrack !== '1' && n.globalPrivacyControl !== true
}

/** the page_location every hit carries: origin + path, then the `keep` keys of the query or hash, nothing else */
export function gaLocation(loc: GaWindow['location'], keep: readonly string[] = []): string {
  const q = new URLSearchParams()
  for (const part of [loc.search, loc.hash])
    for (const [k, v] of new URLSearchParams(part.replace(/^[?#]/, '')))
      if (keep.includes(k) && !q.has(k) && /^[\w.-]{1,40}$/.test(v)) q.set(k, v)
  const s = q.toString()
  return loc.origin + loc.pathname + (s ? `?${s}` : '')
}

/** load gtag.js for `id` once per page; false (and nothing loaded) for a bad id, a second call, DNT or the escape */
export function installGa(id: string, opts: GaOptions = {}): boolean {
  const w = opts.win ?? (globalThis as unknown as GaWindow)
  if (!GA_ID_RE.test(id) || w.__om_ga || !w.document || !gaAllowed(w)) return false
  w.__om_ga = id
  const d = w.document, keep = opts.keep ?? [], mode = opts.pageView ?? 'history'
  const s = d.createElement('script')
  s.async = true
  s.src = GA_SRC + id
  d.head.appendChild(s)
  const dl = (w.dataLayer ??= [])
  // gtag.js reads `arguments` objects off the dataLayer, not arrays
  const gtag = (w.gtag ??= function () { dl.push(arguments) })
  let at = gaLocation(w.location, keep)
  const fields = () => ({ page_location: at, page_title: opts.title || d.title })
  gtag('js', new Date())
  gtag('config', id, {
    ...(opts.anonymize !== false && { anonymize_ip: true }),
    allow_google_signals: false, allow_ad_personalization_signals: false, send_page_view: false, ...fields() })
  if (mode) gtag('event', 'page_view', fields())
  if (mode !== 'history') return true
  // after the router's own title update (a task later), one page_view per new location
  const changed = () => (w.setTimeout ?? setTimeout)(() => {
    const now = gaLocation(w.location, keep)
    if (now === at) return
    at = now
    const f = fields()
    gtag('set', f)
    gtag('event', 'page_view', f)
  }, 0)
  const h = w.history
  if (h) for (const m of ['pushState', 'replaceState'] as const) {
    const orig = h[m]
    h[m] = function (this: unknown, ...a: unknown[]) { orig.apply(this, a); changed() }
  }
  w.addEventListener?.('popstate', changed)
  w.addEventListener?.('hashchange', changed)
  return true
}
