// the bar's rules, pure (no DOM): the default items, the `items` attribute, the search url, the phone collapse, the
// theme. the element (element.ts) only renders what these return.

/** one entry of the bar: a door (Places, Indicators, Atlas: the three apps, left of the search) or a link (right of it) */
export interface NavItem {
  /** matched by the `current` attribute */
  id: string
  label: string
  href: string
  /** a door: one of the apps; false or absent: a link */
  door?: boolean
}

export const SITE = 'https://oceanmetrics.io'

/**
 * the doors and links of the platform. "What changed" points at the site's /docs/ until the change feed page lands
 * (build week 5 step 3, the front page's "What changed"); a host moves it with `changes-href`.
 */
export const DEFAULT_ITEMS: readonly NavItem[] = [
  { id: 'places', label: 'Places', href: `${SITE}/places/`, door: true },
  { id: 'indicators', label: 'Indicators', href: `${SITE}/indicators/`, door: true },
  { id: 'atlas', label: 'Atlas', href: `${SITE}/atlas/`, door: true },
  { id: 'changes', label: 'What changed', href: `${SITE}/docs/` },
  { id: 'docs', label: 'Docs', href: `${SITE}/docs/` },
]

/** where the place search goes: the places Home, which reads `?q=` */
export const SEARCH_HREF = `${SITE}/places/`
export const HOME_HREF = `${SITE}/`
/** below this width (px) the bar collapses to the mark, the app's controls and a menu button */
export const COLLAPSE_AT = 860

const isItem = (v: unknown): v is NavItem => {
  const o = v as Partial<NavItem> | null
  return !!o && typeof o.id === 'string' && typeof o.label === 'string' && typeof o.href === 'string'
}

/**
 * the items of the bar: the `items` attribute (a JSON array of {id, label, href, door?}) when it parses to at least
 * one valid item, else the defaults; then `changes-href` sets the href of the item whose id is `changes`.
 * an entry missing id, label or href is dropped.
 */
export function parseItems(json: string | null, changesHref?: string | null): NavItem[] {
  let items: NavItem[] = []
  if (json) {
    try {
      const v: unknown = JSON.parse(json)
      if (Array.isArray(v)) items = v.filter(isItem).map((i) => ({ id: i.id, label: i.label, href: i.href, door: i.door === true }))
    } catch { /* not JSON: the defaults */ }
  }
  if (!items.length) items = DEFAULT_ITEMS.map((i) => ({ ...i }))
  if (changesHref) items = items.map((i) => (i.id === 'changes' ? { ...i, href: changesHref } : i))
  return items
}

/** the url a search for `text` goes to: `href` with `q` set (other keys kept), or null for blank text */
export function searchUrl(text: string, href: string = SEARCH_HREF, base: string = SITE): string | null {
  const q = text.trim()
  if (!q) return null
  const u = new URL(href, base)
  u.searchParams.set('q', q)
  return u.href
}

/** the bar is narrow below `at` px; an unmeasured width (0) is not narrow */
export const isNarrow = (width: number, at: number = COLLAPSE_AT): boolean => width > 0 && width < at

export type Scheme = 'light' | 'dark' | ''

/** the bar's colour scheme: the `theme` attribute, else the page's <html data-theme>, else '' (the OS preference) */
export function schemeOf(themeAttr: string | null, pageTheme: string | null | undefined): Scheme {
  for (const t of [themeAttr, pageTheme]) if (t === 'light' || t === 'dark') return t
  return ''
}

/** text for HTML, attribute values included */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** an href that is safe to render: a script url becomes '#' */
export const safeHref = (h: string): string => (/^\s*(javascript|data|vbscript):/i.test(h) ? '#' : h)
