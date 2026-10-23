// @vitest-environment happy-dom
// <om-nav data-ga>: the bar loads analytics for its page, once, only when the attribute holds an id. the script is
// caught at document.head.appendChild, so nothing is fetched.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineNav } from '../src/index.js'

type Win = typeof globalThis & { dataLayer?: unknown[]; gtag?: unknown; __om_ga?: string }
const w = globalThis as Win
let added: HTMLScriptElement[] = []

beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); defineNav() })
beforeEach(() => {
  document.body.innerHTML = ''
  added = []
  delete w.dataLayer; delete w.gtag; delete w.__om_ga
  vi.spyOn(document.head, 'appendChild').mockImplementation((n) => { added.push(n as HTMLScriptElement); return n })
})
afterEach(() => vi.restoreAllMocks())

const mount = (attrs: Record<string, string> = {}) => {
  const el = document.createElement('om-nav')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.append(el)
  return el
}
const ga = () => added.filter((s) => s.src.startsWith('https://www.googletagmanager.com/gtag/js'))
const config = () => (w.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>)).find((c) => c[0] === 'config')

describe('<om-nav data-ga>', () => {
  it('without the attribute (or with it empty) the page gets no gtag script and no dataLayer', () => {
    mount(); mount({ 'data-ga': '' })
    expect(ga()).toEqual([])
    expect(w.dataLayer).toBeUndefined()
  })
  it('with an id the page gets one async gtag script and an anonymized config', () => {
    mount({ 'data-ga': 'G-TEST000000' })
    expect(ga().map((s) => [s.src, s.async])).toEqual([['https://www.googletagmanager.com/gtag/js?id=G-TEST000000', true]])
    expect(config()?.[1]).toBe('G-TEST000000')
    expect(config()?.[2]).toMatchObject({ anonymize_ip: true, allow_google_signals: false, send_page_view: false })
  })
  it('once: a second bar, a re-attach or a re-render adds no second script', () => {
    const el = mount({ 'data-ga': 'G-TEST000000' })
    mount({ 'data-ga': 'G-TEST000000' })
    el.remove(); document.body.append(el)
    el.setAttribute('current', 'places')
    expect(ga().length).toBe(1)
  })
  it('an id set after the bar is on the page still loads it', () => {
    const el = mount()
    el.setAttribute('data-ga', 'G-TEST000000')
    expect(ga().length).toBe(1)
  })
  it('data-ga-keep names the query and hash keys kept in page_location', () => {
    history.replaceState(null, '', '/indicators/?brand=oceanmetrics#view=report&title=secret')
    mount({ 'data-ga': 'G-TEST000000', 'data-ga-keep': 'view' })
    expect((config()?.[2] as { page_location: string }).page_location).toBe(`${location.origin}/indicators/?view=report`)
  })
  it('window.__om_ga_disabled keeps it off', () => {
    vi.stubGlobal('__om_ga_disabled', true)
    mount({ 'data-ga': 'G-TEST000000' })
    expect(ga()).toEqual([])
    vi.unstubAllGlobals(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  })
})
