import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs script of the repo, shared with `npm run size`
import { NAV_BUNDLE_BUDGET, measureNav } from '../../../scripts/nav-size.mjs'

describe('the bar a page fetches (define.ts bundled alone, minified, gzip -9)', () => {
  it('is one chunk under the 6 kB target: the element, its stylesheet, the mark and three glyphs', async () => {
    const w = (await measureNav()) as { chunks: number; gzip: number }
    expect(w.chunks).toBe(1)
    expect(w.gzip).toBeLessThanOrEqual(NAV_BUNDLE_BUDGET)
    expect(NAV_BUNDLE_BUDGET).toBeLessThanOrEqual(6_000)
  }, 30_000)
})
