// <om-nav>: the one bar of the Ocean Metrics apps and site (decision D7). framework-free, Shadow DOM, styled by the
// brand tokens the host already defines (custom properties reach into the shadow root). the rules are in items.ts;
// this file renders them and wires the search, the menu button, the collapse and the theme.
import { installGa } from './ga.js'
import { GLYPH, MARK_RING, MARK_SPARK } from './glyphs.js'
import { COLLAPSE_AT, HOME_HREF, SEARCH_HREF, esc, isNarrow, parseItems, safeHref, schemeOf, searchUrl } from './items.js'
import type { NavItem } from './items.js'
import { STYLE } from './style.js'

/** the detail of the `om-nav-search` event (cancelable: a host that handles the search itself calls preventDefault) */
export interface NavSearchDetail { q: string; url: string }

export const DEFAULT_LABEL = 'Ocean Metrics'

// plain Node (no DOM) can still import the module: the class then extends an empty base and is never defined
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement

const glyph = (d: string, cls = '') => `<svg${cls && ` class="${cls}"`} viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
const mark = () =>
  `<svg class="mark" viewBox="0 0 2048 2048" aria-hidden="true">${MARK_RING.map((d) => `<path d="${d}"/>`).join('')}<path class="s" d="${MARK_SPARK}"/></svg>`
const list = (cls: string, items: NavItem[], current: string | null) =>
  items.length ? `<ul class="${cls}" part="${cls}">${items.map((i) =>
    `<li><a href="${esc(safeHref(i.href))}"${i.id === current ? ' aria-current="page"' : ''}>${esc(i.label)}</a></li>`).join('')}</ul>` : ''

export class OmNav extends Base {
  static observedAttributes = ['current', 'items', 'changes-href', 'search-href', 'home-href', 'mark', 'label', 'nosearch', 'theme', 'collapse-at', 'data-ga']

  #bar?: HTMLElement
  #width = 0
  #ro?: ResizeObserver
  #mo?: MutationObserver

  connectedCallback() {
    this.#ga()
    this.render()
    this.#resize(this.getBoundingClientRect().width || globalThis.innerWidth || 0)
    if (typeof ResizeObserver !== 'undefined') {
      this.#ro = new ResizeObserver((es) => this.#resize(es[0]?.contentRect.width ?? 0))
      this.#ro.observe(this)
    }
    // follow the page's theme switch (<html data-theme>) unless `theme` pins one
    this.#mo = new MutationObserver(() => this.#scheme())
    this.#mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }

  disconnectedCallback() {
    this.#ro?.disconnect()
    this.#mo?.disconnect()
    this.#ro = this.#mo = undefined
  }

  attributeChangedCallback(name: string) {
    if (name === 'data-ga') return this.#ga()
    if (!this.#bar) return
    if (name === 'theme') this.#scheme()
    else if (name === 'collapse-at') this.#resize(this.#width)
    else this.render()
  }

  /** the items on display: the `items` attribute (JSON) or the defaults, with `changes-href` applied */
  get items(): NavItem[] { return parseItems(this.getAttribute('items'), this.getAttribute('changes-href')) }

  /** (re)draw the bar from the attributes; the narrow class and the scheme are kept */
  render() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const items = this.items, current = this.getAttribute('current')
    const label = this.getAttribute('label') || DEFAULT_LABEL
    const src = this.getAttribute('mark')
    const word = label === DEFAULT_LABEL ? '<span class="oc">Ocean</span><span class="me">Metrics</span>' : esc(label)
    const search = this.hasAttribute('nosearch') ? '' :
      `<form role="search" part="search">${glyph(GLYPH['ui-search'])}<input type="search" name="q" placeholder="Search places" aria-label="Search places" autocomplete="off" enterkeyhint="search"></form>`
    root.innerHTML = `<style>${STYLE}</style><div class="bar" part="bar">` +
      `<a class="home" part="home" href="${esc(safeHref(this.getAttribute('home-href') || HOME_HREF))}" aria-label="${esc(label)} home">` +
      `${src ? `<img class="mark" src="${esc(safeHref(src))}" alt="">` : mark()}<span class="word">${word}</span></a>` +
      `<button class="menu" part="menu" type="button" aria-expanded="false" aria-controls="p" aria-label="Menu">${glyph(GLYPH['ui-more'], 'm')}${glyph(GLYPH['ui-close'], 'x')}</button>` +
      `<nav class="p" id="p" aria-label="${esc(label)}">${list('doors', items.filter((i) => i.door), current)}${search}${list('links', items.filter((i) => !i.door), current)}</nav>` +
      `<div class="end" part="end"><slot></slot></div></div>`
    const bar = this.#bar = root.querySelector<HTMLElement>('.bar')!
    const btn = bar.querySelector<HTMLButtonElement>('.menu')!
    btn.onclick = () => this.toggle()
    bar.onkeydown = (e) => { if (e.key === 'Escape' && this.open) { this.toggle(false); btn.focus() } }
    bar.querySelector('nav')!.onclick = (e) => { if ((e.target as Element).closest('a')) this.toggle(false) }
    const form = bar.querySelector('form')
    if (form) form.onsubmit = (e) => { e.preventDefault(); this.search(form.querySelector('input')!.value) }
    this.#scheme()
    this.#resize(this.#width)
  }

  /** is the phone menu open */
  get open(): boolean { return !!this.#bar?.classList.contains('open') }

  /** open, close or flip the phone menu */
  toggle(force?: boolean) {
    const bar = this.#bar
    if (!bar) return
    const on = bar.classList.toggle('open', force ?? !this.open)
    bar.querySelector('.menu')!.setAttribute('aria-expanded', String(on))
  }

  /** go to the place search for `text`: fires `om-nav-search` (cancelable), then goes to its url unless cancelled */
  search(text: string) {
    const url = searchUrl(text, this.getAttribute('search-href') || SEARCH_HREF, globalThis.location?.href)
    if (!url) return
    const detail: NavSearchDetail = { q: text.trim(), url }
    if (this.dispatchEvent(new CustomEvent('om-nav-search', { detail, bubbles: true, composed: true, cancelable: true }))) location.assign(url)
  }

  // `data-ga="G-…"`: google analytics for the page, once (installGa guards); `data-ga-keep="view,…"` keeps those keys
  #ga() {
    const id = this.isConnected && this.getAttribute('data-ga')
    if (id) installGa(id, { keep: (this.getAttribute('data-ga-keep') || '').split(',').filter(Boolean) })
  }

  #scheme() {
    this.#bar?.setAttribute('data-scheme', schemeOf(this.getAttribute('theme'), document.documentElement.getAttribute('data-theme')))
  }

  #resize(width: number) {
    this.#width = width
    const narrow = isNarrow(width, Number(this.getAttribute('collapse-at')) || COLLAPSE_AT)
    this.#bar?.classList.toggle('narrow', narrow)
    if (!narrow && this.open) this.toggle(false)
  }
}

/** register the element as `tag` (default `om-nav`); a second call, or a page without custom elements, does nothing */
export function defineNav(tag = 'om-nav'): void {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return
  customElements.define(tag, tag === 'om-nav' ? OmNav : class extends OmNav {})
}
