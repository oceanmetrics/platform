// what would `npm publish` do for the @oceanmetrics packages: compare each packages/<name>/package.json `version` with
// the registry (`npm view @oceanmetrics/<name> versions --json`) and say publish, published (that version is already
// on npm) or older (not on npm, but below the highest version there: a bump that went backwards).
// used by scripts/publish.sh and .github/workflows/publish.yml; nothing here publishes or writes anything.
//
//   node scripts/publish-check.mjs [changed|<name>] [--names]
//     changed (default)  list the six; exit 1 only if one is older than the registry
//     <name>             that package alone (status, places, map, catalog, engine, nav); exit 1 unless it would publish
//     --names            print only the names that would publish, one per line, in publish order (the table goes to stderr)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// publish order: dependency-light first (catalog depends on status)
export const PACKAGES = ['status', 'places', 'map', 'catalog', 'engine', 'nav']
const ROOT = new URL('../', import.meta.url)

// -- semver (x.y.z with an optional -prerelease; build metadata ignored) ----
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v))
  if (!m) throw new Error(`not a semver version: ${JSON.stringify(v)}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] }
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b)
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1 // a release outranks its prerelease
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q)
    if (pn && qn) return +p < +q ? -1 : 1
    if (pn !== qn) return pn ? -1 : 1 // numeric identifiers sort below alphanumeric ones
    return p < q ? -1 : 1
  }
  return 0
}

// -- verdict ----
// local: the package.json version; published: every version npm lists (a package never published has none)
export function verdict(local, published) {
  parseVersion(local)
  if (published.includes(local)) return 'published'
  const highest = published.reduce((hi, v) => (hi === null || compareVersions(v, hi) > 0 ? v : hi), null)
  if (highest !== null && compareVersions(local, highest) < 0) return 'older'
  return 'publish'
}

// the registry's versions of a package; a package npm has never seen (E404) has none. `run` is injectable for tests.
export function registryVersions(name, run = npmView) {
  const out = run(name)
  if (out === null) return []
  const v = JSON.parse(out)
  return Array.isArray(v) ? v : [v] // npm prints a bare string when there is exactly one version
}

function npmView(name) {
  try {
    return execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`
    if (/E404|404 Not Found/.test(text)) return null
    throw new Error(`npm view ${name} failed: ${text.trim() || e.message}`)
  }
}

export function localVersion(pkg, root = ROOT) {
  return JSON.parse(readFileSync(new URL(`packages/${pkg}/package.json`, root), 'utf8')).version
}

// one row per package, in publish order
export function check(pkgs = PACKAGES, { run = npmView, root = ROOT } = {}) {
  return pkgs.map(pkg => {
    const name = `@oceanmetrics/${pkg}`
    const version = localVersion(pkg, root)
    const published = registryVersions(name, run)
    const latest = published.reduce((hi, v) => (hi === null || compareVersions(v, hi) > 0 ? v : hi), null)
    return { pkg, name, version, latest, verdict: verdict(version, published) }
  })
}

export function table(rows) {
  const w = k => Math.max(...rows.map(r => String(r[k] ?? '-').length))
  const [a, b, c] = [w('name'), w('version'), w('latest')]
  return rows.map(r => `${r.name.padEnd(a)}  ${r.version.padEnd(b)}  npm ${String(r.latest ?? '-').padEnd(c)}  ${r.verdict}`).join('\n')
}

// which rows the request accepts; `errors` are the reasons to exit 1
export function plan(request, rows) {
  const errors = []
  const toPublish = rows.filter(r => r.verdict === 'publish')
  if (request === 'changed') {
    for (const r of rows.filter(r => r.verdict === 'older')) errors.push(`${r.name}@${r.version} is older than ${r.latest} on npm`)
    return { names: toPublish.map(r => r.pkg), errors }
  }
  const r = rows.find(r => r.pkg === request)
  if (r.verdict === 'published') errors.push(`${r.name}@${r.version} is already on npm: bump the version before publishing`)
  if (r.verdict === 'older') errors.push(`${r.name}@${r.version} is older than ${r.latest} on npm`)
  return { names: toPublish.filter(x => x.pkg === request).map(x => x.pkg), errors }
}

export function main(argv, io = { out: s => console.log(s), err: s => console.error(s) }, opts = {}) {
  const names = argv.includes('--names')
  const rest = argv.filter(a => a !== '--names')
  if (rest.length > 1) { io.err('usage: publish-check.mjs [changed|status|places|map|catalog|engine|nav] [--names]'); return 2 }
  const request = (rest[0] ?? 'changed').replace(/^@oceanmetrics\//, '')
  if (request !== 'changed' && !PACKAGES.includes(request)) {
    io.err(`unknown package ${JSON.stringify(request)}: one of ${PACKAGES.join(', ')} or changed`)
    return 2
  }
  const rows = check(request === 'changed' ? PACKAGES : [request], opts)
  const { names: publishable, errors } = plan(request, rows)
  const say = names ? io.err : io.out
  say(table(rows))
  say(publishable.length ? `would publish: ${publishable.map(p => `@oceanmetrics/${p}`).join(', ')}` : 'nothing to publish')
  for (const e of errors) io.err(`refused: ${e}`)
  if (names && !errors.length) for (const p of publishable) io.out(p)
  return errors.length ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
