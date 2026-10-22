// the moved modules against the frozen originals in erddap-places (when that checkout is beside platform; skipped
// otherwise): mask.ts, wkb.ts and cells.ts byte for byte, erddap.ts, extent.ts and fetchRetry.ts once the import lines
// are set aside (only the `.js` specifiers changed), every function of dataset.ts and lobes.ts word for word in
// catalog.ts and gazetteer.ts, and chunks() in precompute/src/stats.ts. what did change is in the README ("What moved").
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIB = path.resolve(process.env.OM_ERDDAP_PLACES_DIR ?? path.join(PKG, '../../../erddap-places'), 'app', 'src', 'lib')
const have = fs.existsSync(path.join(LIB, 'gridMask.ts'))
const mine = (f: string) => fs.readFileSync(path.join(PKG, 'src', f), 'utf8')
const theirs = (f: string) => fs.readFileSync(path.join(LIB, f), 'utf8')
const stats = () => fs.readFileSync(path.join(LIB, '../../../precompute/src/stats.ts'), 'utf8')
const noImports = (s: string) => s.split('\n').filter((l) => !/^import /.test(l)).join('\n')
/** every top-level `export function` of a module, by name: from its line to its closing brace at column 0 */
function functions(s: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /^export function (\w+)[\s\S]*?\n\}\n/gm
  for (const m of s.matchAll(re)) out.set(m[1], m[0])
  return out
}

describe.skipIf(!have)(`the moved modules are the originals (${LIB})`, () => {
  for (const [p, e] of [['mask.ts', 'gridMask.ts'], ['wkb.ts', 'wkb.ts'], ['cells.ts', 'cells.ts']])
    it(`${p} is ${e}, byte for byte`, () => expect(mine(p)).toBe(theirs(e)))
  for (const f of ['erddap.ts', 'extent.ts', 'fetchRetry.ts'])
    it(`${f} is the original but for its import lines`, () => expect(noImports(mine(f))).toBe(noImports(theirs(f))))
  for (const [p, e] of [['dataset.ts', 'catalog.ts'], ['lobes.ts', 'gazetteer.ts']]) {
    it(`every function of ${p} is in ${e}, word for word`, () => {
      const orig = functions(theirs(e))
      const got = [...functions(mine(p))]
      expect(got.length).toBeGreaterThan(0)
      for (const [name, text] of got) expect(orig.get(name), name).toBe(text)
    })
  }
  it('chunks() is precompute/src/stats.ts chunks(), word for word (window and chunkDaysFor gained options)', () => {
    expect(functions(mine('chunks.ts')).get('chunks')).toBe(functions(stats()).get('chunks'))
  })
})
