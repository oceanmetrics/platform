// the bar's pure rules (items.ts), one test per rule
import { describe, expect, it } from 'vitest'
import { DEFAULT_ITEMS, isNarrow, parseItems, schemeOf, searchUrl } from '../src/index.js'
import { esc, safeHref } from '../src/items.js'

describe('parseItems', () => {
  it('no attribute: the three doors, then What changed and Docs', () => {
    expect(parseItems(null).map((i) => [i.id, i.label, i.href, !!i.door])).toEqual([
      ['places', 'Places', 'https://oceanmetrics.io/places/', true],
      ['indicators', 'Indicators', 'https://oceanmetrics.io/indicators/', true],
      ['atlas', 'Atlas', 'https://oceanmetrics.io/atlas/', true],
      ['changes', 'What changed', 'https://oceanmetrics.io/docs/', false],
      ['docs', 'Docs', 'https://oceanmetrics.io/docs/', false],
    ])
  })
  it('a JSON array replaces the defaults, in its order; door is true only when true', () => {
    const json = JSON.stringify([{ id: 'home', label: 'Home', href: '/' }, { id: 'places', label: 'Places', href: '/places/', door: true }, { id: 'x', label: 'X', href: '/x', door: 'yes' }])
    expect(parseItems(json)).toEqual([
      { id: 'home', label: 'Home', href: '/', door: false },
      { id: 'places', label: 'Places', href: '/places/', door: true },
      { id: 'x', label: 'X', href: '/x', door: false },
    ])
  })
  it('an entry without id, label or href is dropped', () => {
    expect(parseItems('[{"id":"a","label":"A"},{"id":"b","label":"B","href":"/b"},null,7]').map((i) => i.id)).toEqual(['b'])
  })
  it('not JSON, not an array, or no valid entry: the defaults', () => {
    for (const bad of ['{nope', '{"id":"a"}', '[]', '[{"id":1,"label":"A","href":"/"}]'])
      expect(parseItems(bad).map((i) => i.id), bad).toEqual(DEFAULT_ITEMS.map((i) => i.id))
  })
  it('changes-href moves What changed and only it', () => {
    const items = parseItems(null, 'https://oceanmetrics.io/indicators/#changes')
    expect(items.find((i) => i.id === 'changes')!.href).toBe('https://oceanmetrics.io/indicators/#changes')
    expect(items.find((i) => i.id === 'docs')!.href).toBe('https://oceanmetrics.io/docs/')
  })
  it('the defaults are never mutated by a changes-href', () => {
    parseItems(null, '/elsewhere')
    expect(DEFAULT_ITEMS.find((i) => i.id === 'changes')!.href).toBe('https://oceanmetrics.io/docs/')
  })
})

describe('searchUrl', () => {
  it('the places Home with q, the text trimmed and encoded', () => {
    expect(searchUrl('  Channel Islands & co ')).toBe('https://oceanmetrics.io/places/?q=Channel+Islands+%26+co')
  })
  it('blank text goes nowhere', () => {
    expect(searchUrl('   ')).toBeNull()
  })
  it('a search-href with its own keys keeps them and sets q', () => {
    expect(searchUrl('cinms', 'https://oceanmetrics.io/places/?proj=globe&q=old')).toBe('https://oceanmetrics.io/places/?proj=globe&q=cinms')
  })
  it('a relative search-href resolves against the page', () => {
    expect(searchUrl('kelp', '/places/', 'http://localhost:5173/indicators/#m')).toBe('http://localhost:5173/places/?q=kelp')
  })
})

describe('isNarrow', () => {
  it('390 px collapses, 1280 px does not, the breakpoint itself does not', () => {
    expect([isNarrow(390), isNarrow(1280), isNarrow(860), isNarrow(859)]).toEqual([true, false, false, true])
  })
  it('an unmeasured width (0) is not narrow', () => expect(isNarrow(0)).toBe(false))
  it('collapse-at moves the breakpoint', () => expect([isNarrow(700, 600), isNarrow(500, 600)]).toEqual([false, true]))
})

describe('schemeOf', () => {
  it('the theme attribute wins over the page', () => expect(schemeOf('dark', 'light')).toBe('dark'))
  it('no attribute: the page\'s data-theme', () => expect(schemeOf(null, 'dark')).toBe('dark'))
  it('neither (or an unknown value such as auto): the OS preference, the empty scheme', () => {
    expect([schemeOf(null, undefined), schemeOf('auto', 'navy'), schemeOf('', '')]).toEqual(['', '', ''])
  })
})

describe('escaping', () => {
  it('esc makes text and attribute values inert', () => expect(esc(`<a href="x">'&`)).toBe('&#60;a href=&#34;x&#34;&#62;&#39;&#38;'))
  it('a script url becomes #, other urls pass', () => {
    expect([safeHref(' JavaScript:alert(1)'), safeHref('data:text/html,x'), safeHref('/docs/'), safeHref('https://a.b/c?d=1')]).toEqual(['#', '#', '/docs/', 'https://a.b/c?d=1'])
  })
})
