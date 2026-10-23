// what a page fetches for the bar: packages/nav/src/define.ts (the element, its stylesheet, the mark and the three
// glyphs) bundled alone, minified, gzip -9, as Vite 8 (rolldown) emits it. used by scripts/size-budget.mjs and
// packages/nav/test/size.test.ts. the package line of size-budget.mjs sums dist/**/*.js unbundled and with comments.
import { gzipSync } from 'node:zlib'
import { build } from 'rolldown'

// bytes, gzip. 4,947 on 2026-10-23 at 0.1.0 (the mark is 1,100 of it, its numbers rounded to 0.1 by scripts/glyphs.mjs;
// 1,554 as published). the week 5 plan's 3 kB holds only without the inline mark; the target set for 0.1.0 is under
// 6 kB, so 6,000 (packages/nav/README.md "Size").
export const NAV_BUNDLE_BUDGET = 6_000

export async function measureNav() {
  const input = new URL('../packages/nav/src/define.ts', import.meta.url).pathname
  const r = await build({ input, write: false, platform: 'browser', treeshake: true, logLevel: 'silent', output: { format: 'es', minify: true, codeSplitting: false } })
  const chunks = (r.output ?? r).filter((c) => c.type === 'chunk')
  const code = chunks.map((c) => c.code).join('\n')
  return { chunks: chunks.length, bytes: code.length, gzip: gzipSync(code, { level: 9 }).length }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await measureNav())
