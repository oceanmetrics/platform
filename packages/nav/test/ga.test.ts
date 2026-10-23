// the analytics helper (ga.ts) on a stubbed page: the id rule, the once guard, the escape, Do Not Track, the config
// fields, the rebuilt page_location, and the history-event leak (no hit ever carries the query or the fragment)
import { describe, expect, it } from 'vitest'
import { GA_SRC, gaAllowed, gaLocation, installGa } from '../src/ga.js'
import type { GaWindow } from '../src/ga.js'

const SECRET = '?q=my+search&t=secret#pl=g1.test.AAAA&t=secret&view=matrix'
const FORBIDDEN = ['pl=', 'g1.', 'AAAA', 'secret', 'search', '#']

// a page: its head, its location (moved by pushState, replaceState, the hash), its listeners, timers run at once
function page(at = { origin: 'https://oceanmetrics.io', pathname: '/places/', search: '', hash: '' }, extra: Partial<GaWindow> = {}) {
  const scripts: { async: boolean; src: string }[] = []
  const on: Record<string, (() => void)[]> = {}
  const move = (url: string) => {
    const u = new URL(url, at.origin + at.pathname)
    Object.assign(at, { pathname: u.pathname, search: u.search, hash: u.hash })
  }
  const w: GaWindow = {
    document: { title: 'Places', head: { appendChild: (n) => scripts.push(n as { async: boolean; src: string }) }, createElement: () => ({ async: false, src: '' }) },
    location: at,
    navigator: {},
    history: { pushState: (_s, _t, url) => move(String(url)), replaceState: (_s, _t, url) => move(String(url)) },
    addEventListener: (type, fn) => { (on[type] ??= []).push(fn) },
    setTimeout: (fn) => fn(),
    ...extra,
  }
  const calls = () => (w.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>))
  const fire = (type: string) => on[type]?.forEach((f) => f())
  return { w, scripts, calls, fire, on, move }
}
const pageViews = (calls: unknown[][]) => calls.filter((c) => c[0] === 'event' && c[1] === 'page_view').map((c) => (c[2] as { page_location: string }).page_location)

describe('gaLocation: origin + path, the kept keys and nothing else', () => {
  const loc = { origin: 'https://oceanmetrics.io', pathname: '/indicators/', search: '?brand=oceanmetrics', hash: '#view=report&title=My%20secret&place=NMS%3ACINMS' }
  it('drops the query and the fragment by default', () => {
    expect(gaLocation(loc)).toBe('https://oceanmetrics.io/indicators/')
  })
  it('keeps a kept key with a plain value, from the query or the hash', () => {
    expect(gaLocation(loc, ['view', 'brand'])).toBe('https://oceanmetrics.io/indicators/?brand=oceanmetrics&view=report')
  })
  it('never keeps free text: a kept key whose value is not 1 to 40 of [A-Za-z0-9_.-] is dropped', () => {
    expect(gaLocation(loc, ['title', 'place'])).toBe('https://oceanmetrics.io/indicators/')
  })
})

describe('gaAllowed', () => {
  const w = (x: Partial<GaWindow>) => ({ ...page().w, ...x })
  it('yes on a plain page', () => expect(gaAllowed(w({}))).toBe(true))
  it('no with window.__om_ga_disabled', () => expect(gaAllowed(w({ __om_ga_disabled: true }))).toBe(false))
  it('no with navigator.doNotTrack "1" or window.doNotTrack "1"', () => {
    expect(gaAllowed(w({ navigator: { doNotTrack: '1' } }))).toBe(false)
    expect(gaAllowed(w({ doNotTrack: '1' }))).toBe(false)
    expect(gaAllowed(w({ navigator: { doNotTrack: '0' } }))).toBe(true)
  })
  it('no with Global Privacy Control', () => expect(gaAllowed(w({ navigator: { globalPrivacyControl: true } }))).toBe(false))
})

describe('installGa', () => {
  it('loads gtag.js for the id, async, and configures it without signals, ad personalization or its own page view', () => {
    const p = page()
    expect(installGa('G-TEST000000', { win: p.w })).toBe(true)
    expect(p.scripts).toEqual([{ async: true, src: `${GA_SRC}G-TEST000000` }])
    const [js, config, view] = p.calls()
    expect(js[0]).toBe('js')
    expect(config).toEqual(['config', 'G-TEST000000', {
      anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false, send_page_view: false,
      page_location: 'https://oceanmetrics.io/places/', page_title: 'Places' }])
    expect(view).toEqual(['event', 'page_view', { page_location: 'https://oceanmetrics.io/places/', page_title: 'Places' }])
    expect(p.w.__om_ga).toBe('G-TEST000000')
  })
  it('pushes arguments objects onto the dataLayer, as gtag.js expects', () => {
    const p = page()
    installGa('G-TEST000000', { win: p.w })
    expect(Object.prototype.toString.call(p.w.dataLayer![0])).toBe('[object Arguments]')
  })
  it('anonymize: false leaves anonymize_ip out', () => {
    const p = page()
    installGa('G-TEST000000', { win: p.w, anonymize: false })
    expect(p.calls()[1][2]).not.toHaveProperty('anonymize_ip')
  })
  it('loads nothing for an empty or malformed id (no url can be injected through it)', () => {
    for (const id of ['', 'UA-1234-1', 'G-abc', 'G-TEST000000"><script>', 'G-X&y=1']) {
      const p = page()
      expect(installGa(id, { win: p.w })).toBe(false)
      expect(p.scripts).toEqual([])
      expect(p.w.dataLayer).toBeUndefined()
    }
  })
  it('once per page: a second call (a second bar, a re-attach) loads nothing more', () => {
    const p = page()
    installGa('G-TEST000000', { win: p.w })
    expect(installGa('G-TEST000000', { win: p.w })).toBe(false)
    expect(installGa('G-OTHER00000', { win: p.w })).toBe(false)
    expect(p.scripts.length).toBe(1)
  })
  it('loads nothing with the escape or Do Not Track', () => {
    for (const extra of [{ __om_ga_disabled: 1 }, { navigator: { doNotTrack: '1' } }]) {
      const p = page(undefined, extra)
      expect(installGa('G-TEST000000', { win: p.w })).toBe(false)
      expect(p.scripts).toEqual([])
      expect(p.w.dataLayer).toBeUndefined()
    }
  })
  it("pageView 'load' sends one page_view and hooks no history; false sends none", () => {
    const load = page(), none = page()
    installGa('G-TEST000000', { win: load.w, pageView: 'load' })
    installGa('G-TEST000000', { win: none.w, pageView: false })
    load.w.history!.pushState(null, '', '/places/p/NMS:CINMS')
    expect(pageViews(load.calls())).toEqual(['https://oceanmetrics.io/places/'])
    expect(pageViews(none.calls())).toEqual([])
    expect(load.on).toEqual({})
  })
  it("pageView 'history': one page_view per new location on pushState, replaceState, popstate and hashchange", () => {
    const p = page()
    installGa('G-TEST000000', { win: p.w, keep: ['view'] })
    p.w.history!.pushState(null, '', '/places/p/NMS:CINMS')
    p.w.history!.replaceState(null, '', '/places/p/NMS:CINMS?layers=a,b') // same rebuilt location: no hit
    p.move('/places/credits'); p.fire('popstate')
    p.move('/places/credits#view=map'); p.fire('hashchange')
    p.fire('hashchange') // nothing moved: no hit
    expect(pageViews(p.calls())).toEqual([
      'https://oceanmetrics.io/places/',
      'https://oceanmetrics.io/places/p/NMS:CINMS',
      'https://oceanmetrics.io/places/credits',
      'https://oceanmetrics.io/places/credits?view=map',
    ])
    // each new location is also set on gtag's persistent fields, so gtag.js's own later hits carry it too
    expect(p.calls().filter((c) => c[0] === 'set').length).toBe(3)
  })
  it('title: a fixed page_title on every hit, whatever the document title says (a report title stays on the page)', () => {
    const p = page()
    p.w.document.title = 'My secret report · Ocean Metrics Indicators'
    installGa('G-TEST000000', { win: p.w, title: 'Ocean Metrics Indicators' })
    p.w.history!.pushState(null, '', '/places/next')
    const titles = p.calls().filter((c) => c[0] !== 'js').map((c) => (c.at(-1) as { page_title: string }).page_title)
    expect(titles).toEqual(['Ocean Metrics Indicators', 'Ocean Metrics Indicators', 'Ocean Metrics Indicators', 'Ocean Metrics Indicators'])
  })
  it('the wrapped history methods still move the page', () => {
    const p = page()
    installGa('G-TEST000000', { win: p.w })
    p.w.history!.pushState(null, '', '/places/docs')
    expect(p.w.location.pathname).toBe('/places/docs')
  })
})

describe('the history-event leak: no hit ever carries the query or the fragment', () => {
  it('a page opened and moved with a place polygon, a report title and a search in its url sends none of them', () => {
    const p = page({ origin: 'https://oceanmetrics.io', pathname: '/atlas/', search: '', hash: '' })
    p.move(`/atlas/${SECRET}`)
    p.w.document.title = 'Atlas · Ocean Metrics'
    installGa('G-TEST000000', { win: p.w, keep: ['view'] })
    p.w.history!.replaceState(null, '', `/atlas/${SECRET}&more=1`)
    p.w.history!.pushState(null, '', `/atlas/report${SECRET}`)
    p.move(`/atlas/${SECRET.replace('AAAA', 'BBBB')}`); p.fire('hashchange'); p.fire('popstate')
    const text = JSON.stringify(p.calls())
    for (const t of FORBIDDEN) expect(text, `no hit may carry "${t}"`).not.toContain(t)
    expect(pageViews(p.calls())).toEqual(['https://oceanmetrics.io/atlas/?view=matrix', 'https://oceanmetrics.io/atlas/report?view=matrix', 'https://oceanmetrics.io/atlas/?view=matrix'])
  })
})
