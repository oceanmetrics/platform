import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
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
