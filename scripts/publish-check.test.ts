import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error plain .mjs script, no declarations
import { PACKAGES, check, compareVersions, localVersion, main, plan, registryVersions, verdict } from './publish-check.mjs'

// scripts/publish-check.mjs: the version on npm is stubbed (a function in the unit tests, a fake `npm` on PATH for the CLI)
const ROOT = new URL('../', import.meta.url).pathname
const SCRIPT = join(ROOT, 'scripts/publish-check.mjs')

// a registry of {name: versions}; a name not in it is E404
const registry = (r: Record<string, string[]>) => (name: string) => (name in r ? JSON.stringify(r[name]) : null)
const today = Object.fromEntries(PACKAGES.map((p: string) => [`@oceanmetrics/${p}`, ['0.0.0-stage', localVersion(p)]]))

describe('compareVersions', () => {
  it('orders numerically, not as strings', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('0.1.1', '0.1.2')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
  it('puts a prerelease below its release and the 0.0.0-stage placeholder below everything', () => {
    expect(compareVersions('0.0.0-stage', '0.0.0')).toBe(-1)
    expect(compareVersions('0.0.0-stage', '0.1.0')).toBe(-1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
  })
  it('rejects what is not a version', () => {
    expect(() => compareVersions('latest', '0.1.0')).toThrow(/not a semver/)
  })
})

describe('verdict', () => {
  const on = ['0.0.0-stage', '0.1.0', '0.1.1']
  it('a new higher version publishes', () => expect(verdict('0.1.2', on)).toBe('publish'))
  it('a version already on npm is published', () => expect(verdict('0.1.1', on)).toBe('published'))
  it('seeded fault: a version below the highest on npm, and not on it, is older', () => expect(verdict('0.1.0-fix', on)).toBe('older'))
  it('a gap below the highest is older too', () => expect(verdict('0.0.9', on)).toBe('older'))
  it('a package npm has never seen publishes', () => expect(verdict('0.1.0', [])).toBe('publish'))
  it('the placeholder alone does not block 0.1.0', () => expect(verdict('0.1.0', ['0.0.0-stage'])).toBe('publish'))
})

describe('registryVersions', () => {
  it('reads a list, a bare string (one version) and E404 (none)', () => {
    expect(registryVersions('a', () => '["0.1.0","0.1.1"]')).toEqual(['0.1.0', '0.1.1'])
    expect(registryVersions('a', () => '"0.0.0-stage"')).toEqual(['0.0.0-stage'])
    expect(registryVersions('a', () => null)).toEqual([])
  })
})

describe('check and plan against the packages on disk', () => {
  it('PACKAGES is every folder under packages/', () => {
    expect([...PACKAGES].sort()).toEqual(readdirSync(join(ROOT, 'packages')).sort())
  })
  it('with every local version on npm, nothing publishes', () => {
    const rows = check(PACKAGES, { run: registry(today) })
    expect(rows.every((r: { verdict: string }) => r.verdict === 'published')).toBe(true)
    expect(plan('changed', rows)).toEqual({ names: [], errors: [] })
  })
  it('a package whose version is not on npm is listed, in publish order', () => {
    const behind = { ...today, '@oceanmetrics/map': ['0.0.0-stage'], '@oceanmetrics/status': ['0.0.0-stage'] }
    const rows = check(PACKAGES, { run: registry(behind) })
    expect(plan('changed', rows)).toEqual({ names: ['status', 'map'], errors: [] })
  })
  it('a named package that is already on npm is refused; one that is new is accepted', () => {
    expect(plan('status', check(['status'], { run: registry(today) })).errors[0]).toMatch(/already on npm/)
    const behind = { ...today, '@oceanmetrics/status': ['0.0.0-stage'] }
    expect(plan('status', check(['status'], { run: registry(behind) }))).toEqual({ names: ['status'], errors: [] })
  })
  it('seeded fault: a local version older than npm\'s is refused, named or in changed', () => {
    const ahead = { ...today, '@oceanmetrics/engine': ['0.0.0-stage', '9.9.9'] }
    expect(plan('changed', check(PACKAGES, { run: registry(ahead) })).errors[0]).toMatch(/engine@.* is older than 9\.9\.9/)
    expect(plan('engine', check(['engine'], { run: registry(ahead) })).errors[0]).toMatch(/older than 9\.9\.9/)
  })
})

describe('main', () => {
  const capture = () => { const out: string[] = [], err: string[] = []; return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } } }
  it('--names prints the bare names on stdout and the table on stderr', () => {
    const c = capture()
    const behind = { ...today, '@oceanmetrics/nav': ['0.0.0-stage'] }
    expect(main(['changed', '--names'], c.io, { run: registry(behind) })).toBe(0)
    expect(c.out).toEqual(['nav'])
    expect(c.err.join('\n')).toMatch(/would publish: @oceanmetrics\/nav/)
  })
  it('an unknown package is a usage error (2)', () => {
    const c = capture()
    expect(main(['nope'], c.io)).toBe(2)
    expect(c.err[0]).toMatch(/unknown package/)
  })
  it('accepts the scoped name', () => {
    const c = capture()
    expect(main(['@oceanmetrics/status'], c.io, { run: registry(today) })).toBe(1)
  })
})

describe('the CLI with a fake npm on PATH', () => {
  function fakeNpm(body: string) {
    const dir = mkdtempSync(join(tmpdir(), 'publish-check-'))
    writeFileSync(join(dir, 'npm'), `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(join(dir, 'npm'), 0o755)
    return dir
  }
  const run = (dir: string, args: string[]) =>
    spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } })

  it('E404 from npm means never published: every package would publish', () => {
    const r = run(fakeNpm('echo \'{"error":{"code":"E404"}}\'; echo "npm error code E404" >&2; exit 1'), ['changed'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/would publish: @oceanmetrics\/status, @oceanmetrics\/places/)
  })
  it('any other npm failure is an error, not "nothing to publish"', () => {
    const r = run(fakeNpm('echo "npm error code ENOTFOUND" >&2; exit 1'), ['changed'])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/npm view @oceanmetrics\/status failed/)
  })
})

// the workflow's shape, as text: these are the rules npm's trusted publisher entry and the runbook rely on
describe('.github/workflows/publish.yml', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/publish.yml'), 'utf8').split('\n').filter(l => !l.trim().startsWith('#')).join('\n')
  const publishJob = wf.slice(wf.indexOf('\n  publish:'))
  it('is dispatch only, dry-run by default, and never sees a token', () => {
    expect(wf).toMatch(/^on:\n  workflow_dispatch:/m)
    expect(wf).not.toMatch(/^\s+(push|pull_request|release):/m)
    expect(wf).toMatch(/dry-run:[\s\S]*?default: true/)
    expect(wf).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./)
    expect(wf).not.toMatch(/registry-url/) // setup-node would write a dummy token that shadows OIDC
  })
  it('only the publish job has the npm environment and id-token: write', () => {
    expect(publishJob).toMatch(/environment: npm\n/)
    expect(publishJob).toMatch(/id-token: write/)
    expect(wf.slice(0, wf.indexOf('\n  publish:')).match(/id-token/g)).toBeNull()
    expect(wf.match(/environment: npm/g)).toHaveLength(1)
  })
  it('publishes with provenance and the check script, only when not a dry run', () => {
    expect(publishJob).toMatch(/npm publish -w "packages\/\$p" --provenance --access public/)
    expect(wf).toMatch(/publish-check\.mjs/)
    expect(wf).toMatch(/if: \$\{\{ !inputs\.dry-run/)
  })
})
