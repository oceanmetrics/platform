// @vitest-environment happy-dom
// the element (element.ts) in a DOM: rendering, the current door, the search, the items attribute, the 390 collapse,
// the menu by keyboard, the theme, the slot, the registration
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OmNav, defineNav } from '../src/index.js'
import type { NavSearchDetail } from '../src/index.js'

// a ResizeObserver the test drives: resize(el, width) calls the observer of `el` as a browser would
const observers = new Map<Element, ResizeObserverCallback>()
class FakeRO {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) { observers.set(el, this.cb) }
  unobserve() {}
  disconnect() { for (const [el, cb] of observers) if (cb === this.cb) observers.delete(el) }
}
const resize = (el: Element, width: number) => observers.get(el)!([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)

beforeAll(() => { vi.stubGlobal('ResizeObserver', FakeRO); defineNav() })
beforeEach(() => { document.body.innerHTML = ''; document.documentElement.removeAttribute('data-theme') })
afterEach(() => vi.restoreAllMocks())

function mount(attrs: Record<string, string> = {}, inner = ''): OmNav {
  const el = document.createElement('om-nav') as OmNav
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  el.innerHTML = inner
  document.body.append(el)
  return el
}
const $ = (el: OmNav, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement
const $$ = (el: OmNav, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[]
const texts = (el: OmNav, sel: string) => $$(el, sel).map((a) => a.textContent)
const bar = (el: OmNav) => $(el, '.bar')

describe('rendering', () => {
  it('the mark (two ring strokes and the waterline) and the wordmark link home', () => {
    const el = mount()
    const home = $(el, 'a.home') as HTMLAnchorElement
    expect(home.getAttribute('href')).toBe('https://oceanmetrics.io/')
    expect(home.getAttribute('aria-label')).toBe('Ocean Metrics home')
    expect(home.querySelectorAll('svg.mark path').length).toBe(3)
    expect(home.querySelectorAll('svg.mark path.s').length).toBe(1)
    expect(home.querySelector('.word')!.textContent).toBe('OceanMetrics')
  })
  it('the three doors, the search, then What changed and Docs, in that order', () => {
    const el = mount()
    expect(texts(el, '.doors a')).toEqual(['Places', 'Indicators', 'Atlas'])
    expect(texts(el, '.links a')).toEqual(['What changed', 'Docs'])
    expect([...$(el, 'nav').children].map((c) => c.className || c.tagName.toLowerCase())).toEqual(['doors', 'form', 'links'])
    expect($(el, 'form input').getAttribute('aria-label')).toBe('Search places')
  })
  it('a slot on the right for the app\'s own controls', () => {
    const el = mount({}, '<button id="theme">Theme</button>')
    const slot = $(el, '.end slot') as HTMLSlotElement
    expect(slot).toBeTruthy()
    expect(el.querySelector('#theme')!.parentElement).toBe(el)
  })
  it('no external font or stylesheet: one inline style element, no link, no @import or url()', () => {
    const el = mount()
    expect($$(el, 'link').length).toBe(0)
    const css = $$(el, 'style').map((s) => s.textContent).join('')
    expect(css).not.toMatch(/@import|@font-face|url\(/)
  })
})

describe('current', () => {
  it('current="indicators" marks that door, and only it, as the page', () => {
    const el = mount({ current: 'indicators' })
    expect($$(el, '[aria-current="page"]').map((a) => a.textContent)).toEqual(['Indicators'])
  })
  it('a change of current redraws the mark', () => {
    const el = mount({ current: 'places' })
    el.setAttribute('current', 'atlas')
    expect($$(el, '[aria-current="page"]').map((a) => a.textContent)).toEqual(['Atlas'])
  })
  it('no current: nothing is marked', () => expect($$(mount(), '[aria-current]').length).toBe(0))
})

describe('search', () => {
  const submit = (el: OmNav, text: string) => {
    const input = $(el, 'form input') as HTMLInputElement
    input.value = text
    $(el, 'form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
  }
  it('Enter fires om-nav-search with the places url, then goes there', () => {
    const el = mount()
    const go = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    let got: NavSearchDetail | undefined
    el.addEventListener('om-nav-search', (e) => { got = (e as CustomEvent<NavSearchDetail>).detail })
    submit(el, ' Channel Islands ')
    expect(got).toEqual({ q: 'Channel Islands', url: 'https://oceanmetrics.io/places/?q=Channel+Islands' })
    expect(go).toHaveBeenCalledWith('https://oceanmetrics.io/places/?q=Channel+Islands')
  })
  it('a host that cancels the event keeps the page (places runs the search itself)', () => {
    const el = mount({ 'search-href': '/places/' })
    const go = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    let url = ''
    el.addEventListener('om-nav-search', (e) => { e.preventDefault(); url = (e as CustomEvent<NavSearchDetail>).detail.url })
    submit(el, 'kelp')
    expect(url).toBe(new URL('/places/?q=kelp', location.href).href)
    expect(go).not.toHaveBeenCalled()
  })
  it('blank text goes nowhere', () => {
    const el = mount()
    const go = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    const seen = vi.fn()
    el.addEventListener('om-nav-search', seen)
    submit(el, '  ')
    expect([seen.mock.calls.length, go.mock.calls.length]).toEqual([0, 0])
  })
  it('nosearch drops the field', () => expect($(mount({ nosearch: '' }), 'form')).toBeNull())
})

describe('items', () => {
  it('the items attribute replaces the list: doors left of the search, links right of it', () => {
    const el = mount({ items: JSON.stringify([{ id: 'home', label: 'Home', href: '/' }, { id: 'atlas', label: 'Atlas', href: '/atlas/', door: true }]), current: 'atlas' })
    expect(texts(el, '.doors a')).toEqual(['Atlas'])
    expect(texts(el, '.links a')).toEqual(['Home'])
    expect($(el, '.doors a').getAttribute('aria-current')).toBe('page')
  })
  it('a change of items redraws the bar', () => {
    const el = mount()
    el.setAttribute('items', '[{"id":"docs","label":"Read me","href":"/docs/"}]')
    expect(texts(el, 'nav a')).toEqual(['Read me'])
  })
  it('bad JSON keeps the defaults', () => expect(texts(mount({ items: '[oops' }), '.doors a')).toEqual(['Places', 'Indicators', 'Atlas']))
  it('changes-href moves What changed', () => {
    const el = mount({ 'changes-href': 'https://oceanmetrics.io/indicators/#changes' })
    expect($$(el, '.links a')[0].getAttribute('href')).toBe('https://oceanmetrics.io/indicators/#changes')
  })
  it('labels are text, never markup, and a script href is defused', () => {
    const el = mount({ items: JSON.stringify([{ id: 'x', label: '<img src=x onerror=alert(1)>', href: 'javascript:alert(1)' }]) })
    const a = $(el, '.links a')
    expect([a.textContent, a.getAttribute('href'), a.querySelector('img')]).toEqual(['<img src=x onerror=alert(1)>', '#', null])
  })
  it('an instance mark and label replace the Ocean Metrics mark and wordmark', () => {
    const el = mount({ mark: './mark.svg', label: 'Some Atlas', 'home-href': '/atlas/' })
    const home = $(el, 'a.home')
    expect([home.getAttribute('href'), home.querySelector('img.mark')!.getAttribute('src'), home.querySelector('svg'), home.textContent])
      .toEqual(['/atlas/', './mark.svg', null, 'Some Atlas'])
  })
})

describe('the 390 px collapse', () => {
  it('390 px: the narrow class (the mark, the app\'s controls and the menu button); 1280 px: the full bar', () => {
    const el = mount()
    resize(el, 390)
    expect(bar(el).classList.contains('narrow')).toBe(true)
    resize(el, 1280)
    expect(bar(el).classList.contains('narrow')).toBe(false)
  })
  it('collapse-at moves the breakpoint', () => {
    const el = mount({ 'collapse-at': '400' })
    resize(el, 500)
    expect(bar(el).classList.contains('narrow')).toBe(false)
    el.setAttribute('collapse-at', '600')
    expect(bar(el).classList.contains('narrow')).toBe(true)
  })
  it('a redraw keeps the collapse', () => {
    const el = mount()
    resize(el, 390)
    el.setAttribute('current', 'places')
    expect(bar(el).classList.contains('narrow')).toBe(true)
  })
  it('widening past the breakpoint closes an open menu', () => {
    const el = mount()
    resize(el, 390)
    el.toggle(true)
    resize(el, 1280)
    expect([el.open, $(el, '.menu').getAttribute('aria-expanded')]).toEqual([false, 'false'])
  })
})

describe('keyboard', () => {
  it('every entry is reachable by Tab: native links, the field and buttons, none taken out of the order', () => {
    const el = mount()
    const tabbable = $$(el, 'a[href], input, button')
    expect(tabbable.map((n) => n.textContent || n.getAttribute('aria-label'))).toEqual(['OceanMetrics', 'Menu', 'Places', 'Indicators', 'Atlas', 'Search places', 'What changed', 'Docs'])
    expect($$(el, '[tabindex]').length).toBe(0)
  })
  it('the menu button opens the panel (aria-expanded), Escape closes it and gives focus back to the button', () => {
    const el = mount()
    resize(el, 390)
    const btn = $(el, '.menu') as HTMLButtonElement
    expect(btn.getAttribute('aria-controls')).toBe('p')
    btn.click()
    expect([el.open, btn.getAttribute('aria-expanded'), bar(el).classList.contains('open')]).toEqual([true, 'true', true])
    $(el, '.doors a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    expect([el.open, btn.getAttribute('aria-expanded')]).toEqual([false, 'false'])
    expect(el.shadowRoot!.activeElement).toBe(btn)
  })
  it('following a link closes the panel', () => {
    const el = mount()
    resize(el, 390)
    el.toggle(true)
    $(el, '.links a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(el.open).toBe(false)
  })
})

describe('theme', () => {
  const scheme = (el: OmNav) => bar(el).getAttribute('data-scheme')
  it('no theme anywhere: the empty scheme (the stylesheet follows prefers-color-scheme)', () => expect(scheme(mount())).toBe(''))
  it('the page\'s <html data-theme> is followed, also when it flips', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const el = mount()
    expect(scheme(el)).toBe('dark')
    document.documentElement.setAttribute('data-theme', 'light')
    await new Promise((r) => setTimeout(r, 0))
    expect(scheme(el)).toBe('light')
  })
  it('the theme attribute pins the scheme against the page', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    const el = mount({ theme: 'dark' })
    expect(scheme(el)).toBe('dark')
    el.removeAttribute('theme')
    expect(scheme(el)).toBe('light')
  })
  it('the stylesheet maps both schemes and the OS preference', () => {
    const css = $(mount(), 'style').textContent!
    expect(css).toContain('.bar{color-scheme:light dark;')
    expect(css).toContain('.bar[data-scheme=light]{color-scheme:light}')
    expect(css).toContain('.bar[data-scheme=dark]{color-scheme:dark}')
    expect(css).toContain('--_bg: var(--om-nav-bg, var(--bg-surface, light-dark(')
  })
})

describe('defineNav', () => {
  it('registers om-nav once; a second call is a no-op', () => {
    expect(customElements.get('om-nav')).toBe(OmNav)
    expect(() => defineNav()).not.toThrow()
  })
  it('another tag gets its own subclass', () => {
    defineNav('om-platform-bar')
    const C = customElements.get('om-platform-bar')!
    expect(C).not.toBe(OmNav)
    expect(new C()).toBeInstanceOf(OmNav)
  })
})
