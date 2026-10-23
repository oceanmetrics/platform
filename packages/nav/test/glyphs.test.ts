// src/glyphs.ts is generated from the published brand kit (the site checkout beside platform; skipped without it):
// never a hand-typed path, never stale. the mark's rounding keeps every number within 0.05 of the published one.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { GLYPHS, MARK_FILE, SITE_DIR, SPRITE_FILE, glyphSource, symbolPath, tidyPath } from '../scripts/glyphs.mjs'
import { GLYPH, MARK_RING, MARK_SPARK } from '../src/glyphs.js'

const have = fs.existsSync(path.join(SITE_DIR, MARK_FILE)) && fs.existsSync(path.join(SITE_DIR, SPRITE_FILE))
const nums = (d: string) => (d.match(/-?\d+\.?\d*/g) ?? []).map(Number)
const cmds = (d: string) => d.replace(/[^MCLZz]/g, '')

describe('tidyPath', () => {
  it('rounds to 0.1 and drops the spaces around commands', () => {
    expect(tidyPath('M 487.069 827.638 C 520.267 744.389 558.642 683.004 622.553 619.549 L 1386.2 880.068 z')).toBe('M487.1 827.6C520.3 744.4 558.6 683 622.6 619.5L1386.2 880.1z')
  })
})

describe.skipIf(!have)(`the glyphs are the brand kit's (${SITE_DIR})`, () => {
  it('src/glyphs.ts is what scripts/glyphs.mjs writes today (run `npm run glyphs -w packages/nav` when not)', () => {
    expect(fs.readFileSync(new URL('../src/glyphs.ts', import.meta.url), 'utf8')).toBe(glyphSource())
  })
  it('each sprite glyph is the published symbol, byte for byte', () => {
    const sprite = fs.readFileSync(path.join(SITE_DIR, SPRITE_FILE), 'utf8')
    for (const id of GLYPHS) expect(GLYPH[id as keyof typeof GLYPH]).toBe(symbolPath(sprite, id))
  })
  it('the mark keeps the published commands, and every number within 0.05', () => {
    const svg = fs.readFileSync(path.join(SITE_DIR, MARK_FILE), 'utf8')
    const orig = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1])
    const mine = [...MARK_RING, MARK_SPARK]
    expect(mine.length).toBe(3)
    orig.forEach((d, k) => {
      expect(cmds(mine[k])).toBe(cmds(d))
      const a = nums(d), b = nums(mine[k])
      expect(b.length).toBe(a.length)
      a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(0.05 + 1e-9))
    })
  })
})
