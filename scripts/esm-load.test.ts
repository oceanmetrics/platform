import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// regression (places 0.5.1, 2026-10-22): the published dist/index.js had extensionless relative imports
// (`export * from './client'`), which Node's ESM loader rejects; a bundler hid it. Build every package, then load
// its dist/index.js in plain Node, as a consumer's vitest or a Node script does.
const ROOT = new URL('../', import.meta.url).pathname
const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)

describe('dist/index.js loads in plain Node ESM', () => {
  it('builds', () => { execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' }) }, 180_000)
  for (const name of packages) {
    it(name, () => {
      const entry = join(ROOT, 'packages', name, 'dist', 'index.js')
      const out = execFileSync('node', ['--input-type=module', '-e', `const m = await import(${JSON.stringify(entry)}); console.log(Object.keys(m).length)`], { encoding: 'utf8' })
      expect(Number(out.trim())).toBeGreaterThan(0)
    })
  }
})

// every JS subpath a package exports loads too (catalog 0.3.0's ./indicators pulls hyparquet and @oceanmetrics/status);
// a worker module (map's ./h3-worker registers itself on the worker's global) only loads in a worker
describe('each exported subpath loads in plain Node ESM', () => {
  for (const name of packages) {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
    const subs = Object.entries(pkg.exports ?? {}).filter(([k, v]) => k !== '.' && !k.includes('*') && typeof v === 'object' && v && 'default' in v && !k.includes('worker'))
    for (const [sub, v] of subs) {
      it(`${name}${sub.slice(1)}`, () => {
        const entry = join(ROOT, 'packages', name, (v as { default: string }).default)
        const out = execFileSync('node', ['--input-type=module', '-e', `const m = await import(${JSON.stringify(entry)}); console.log(Object.keys(m).length)`], { encoding: 'utf8' })
        expect(Number(out.trim())).toBeGreaterThan(0)
      })
    }
  }
})
