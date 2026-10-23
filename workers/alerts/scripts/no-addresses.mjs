// the repo is public: no address but the sender's and RFC 2606 examples anywhere in the Worker (source, tests,
// fixtures, pages, README, wrangler.toml). exit 1 on any other; a seeded fault proves the pattern still catches one
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SKIP = new Set(['node_modules', 'dist', '.wrangler', 'generated'])
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const ALLOWED = (a) => /@(example\.(org|com|net)|[a-z0-9-]+\.example\.(org|com|net))$/i.test(a) || ['alerts@oceanmetrics.io', 'ben@oceanmetrics.io'].includes(a.toLowerCase())

export function offending(text) {
  return [...text.matchAll(ADDRESS)].map((m) => m[0]).filter((a) => !ALLOWED(a))
}

// the seeded fault: a real-looking address is caught, the allowed ones are not
const seeded = ['someone', 'mailbox.test.io'].join('@')
if (offending(`x ${seeded} y`).length !== 1 || offending('a@example.org alerts@oceanmetrics.io ben@oceanmetrics.io b@sub.example.com').length) {
  console.error('no-addresses: the pattern no longer catches a seeded address')
  process.exit(1)
}

const files = (dir) => readdirSync(dir).flatMap((n) => {
  if (SKIP.has(n)) return []
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : [p]
})

let bad = 0
for (const f of files(ROOT)) {
  if (!/\.(ts|mjs|js|json|html|md|toml|txt)$/.test(f) || f.endsWith('package-lock.json')) continue
  for (const a of offending(readFileSync(f, 'utf8'))) {
    console.error(`no-addresses: ${relative(ROOT, f)}: an address outside example.org/.com/.net`)
    bad++
  }
}
if (bad) process.exit(1)
console.log('no-addresses: ok')
