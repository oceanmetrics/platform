// the theme file (tokens.ts): the fallback chain, the brand contrast in both themes, and no colour outside it
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOKENS, tokenDecl } from '../src/index.js'
import type { Role } from '../src/index.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

// WCAG 2 relative luminance and contrast ratio of two #rrggbb colours
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('tokens', () => {
  it('a role falls back: the bar\'s own property, the host\'s semantic tokens in order, the brand pair', () => {
    expect(tokenDecl('brand')).toBe('--_brand: var(--om-nav-brand, var(--brand-text, var(--link, light-dark(#0c7288, #86d6e5))));')
    expect(tokenDecl('bg')).toBe('--_bg: var(--om-nav-bg, var(--bg-surface, light-dark(#ffffff, #103a45)));')
  })
  it('text on the bar reads at 4.5:1 or more, in both themes (body, strong, brand teal)', () => {
    for (const side of [1, 2] as const)
      for (const r of ['text', 'strong', 'brand'] as Role[]) {
        const fg = TOKENS[r][side], bg = TOKENS.bg[side], panel = TOKENS.overlay[side]
        expect(contrast(fg, bg), `${r} on bg, ${side === 1 ? 'light' : 'dark'}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(fg, panel), `${r} on the menu panel, ${side === 1 ? 'light' : 'dark'}`).toBeGreaterThanOrEqual(4.5)
      }
  })
  it('the current door\'s rule and the focus ring reach 3:1 against the bar, in both themes (WCAG 1.4.11)', () => {
    for (const side of [1, 2] as const)
      for (const r of ['accent', 'focus'] as Role[]) expect(contrast(TOKENS[r][side], TOKENS.bg[side]), r).toBeGreaterThanOrEqual(3)
  })
  it('no colour value in the package source outside the theme file', () => {
    const hex = /#[0-9a-f]{3,8}\b/i
    for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.ts') && f !== 'tokens.ts'))
      expect(hex.test(fs.readFileSync(path.join(SRC, f), 'utf8').replace(/&#\d+;/g, '')), f).toBe(false)
  })
})
