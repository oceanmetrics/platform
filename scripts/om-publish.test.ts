import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

// scripts/om-publish.sh against a fake aws and a fake rclone on PATH (scripts/om-publish/fake/): each call is recorded
// as a JSON line, with the files of the staged folder it was given, so a test asserts what would go where
const ROOT = new URL('../', import.meta.url).pathname
const SCRIPT = join(ROOT, 'scripts/om-publish.sh')
const FAKE = join(ROOT, 'scripts/om-publish/fake')
const S3 = 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public'

interface Call { tool: 'aws' | 'rclone'; args: string[]; files?: string[]; list?: string[]; text?: string[] }
const bytes = (c: Call, i = 0) => Buffer.from(c.text![i], 'base64')

function run(args: string[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'om-publish-test-'))
  const log = join(dir, 'log')
  writeFileSync(log, '')
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${FAKE}:${process.env.PATH}`, OM_RCLONE: join(FAKE, 'rclone-r2.sh'), OM_FAKE_LOG: log,
      OM_HISTORY_DATE: '2026-10-23', OM_STORE: '', ...env },
  })
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Call)
  return { code: r.status, out: r.stdout, err: r.stderr, calls }
}
const uploads = (calls: Call[]) => calls.filter(c => (c.tool === 'aws' && c.args[1] === 'sync') || (c.tool === 'rclone' && c.args[0] === 'copy' && c.files))
const store = (c: Call) => c.tool === 'aws' ? 's3' : 'r2'
const typeOf = (c: Call) => c.tool === 'aws' ? c.args[c.args.indexOf('--content-type') + 1]
  : c.args.find((a, i) => c.args[i - 1] === '--header-upload' && a.startsWith('Content-Type: '))?.slice(14)

/** a built catalog folder like oceanmetrics/indicators writes */
function catalog() {
  const d = mkdtempSync(join(tmpdir(), 'om-publish-src-'))
  mkdirSync(join(d, 'values/NMS_CINMS/sst'), { recursive: true })
  mkdirSync(join(d, 'feeds'))
  writeFileSync(join(d, 'indicators.json'), '{}\n')
  writeFileSync(join(d, 'coverage.parquet'), 'PAR1')
  writeFileSync(join(d, 'values/NMS_CINMS/sst/data.parquet'), 'PAR1')
  writeFileSync(join(d, 'feeds/all.xml'), '<feed/>')
  writeFileSync(join(d, 'README.md'), '# indicators')
  writeFileSync(join(d, 'basemap.pmtiles'), 'PMTiles')
  writeFileSync(join(d, '.DS_Store'), '')
  return d
}

describe('om-publish.sh: upload', () => {
  it('is a dry run by default, R2 first, then S3, every call in its dry-run mode', () => {
    const r = run([catalog(), 'indicators'])
    expect(r.code).toBe(0)
    const u = uploads(r.calls)
    expect(u.length).toBe(10)
    expect(u.slice(0, 5).every(c => store(c) === 'r2')).toBe(true)
    expect(u.slice(5).every(c => store(c) === 's3')).toBe(true)
    for (const c of u) expect(c.args).toContain(c.tool === 'aws' ? '--dryrun' : '--dry-run')
    expect(r.out).toContain('(dry run; --really to upload)')
  })
  it('never deletes: no --delete and never rclone sync, and --delete is refused', () => {
    const r = run([catalog(), 'indicators', '--really'])
    for (const c of r.calls) {
      expect(c.args.some(a => a.startsWith('--delete'))).toBe(false)
      if (c.tool === 'rclone') expect(c.args[0]).not.toBe('sync')
    }
    const d = run([catalog(), 'indicators', '--delete'])
    expect(d.code).toBe(2)
    expect(d.err).toContain('never deletes')
    expect(d.calls).toEqual([])
  })
  it('--really drops the dry-run flags; rclone compares checksums', () => {
    const u = uploads(run([catalog(), 'indicators', '--really']).calls)
    for (const c of u) expect(c.args.some(a => a === '--dryrun' || a === '--dry-run')).toBe(false)
    for (const c of u.filter(c => c.tool === 'rclone')) expect(c.args).toContain('--checksum')
  })
  it('sets the content type by extension, the same on both stores, and leaves out .DS_Store', () => {
    const u = uploads(run([catalog(), 'indicators']).calls)
    const byType = (s: string) => Object.fromEntries(u.filter(c => store(c) === s).map(c => [typeOf(c) ?? '', c.files]))
    const want = {
      'application/json': ['indicators.json'],
      'application/vnd.apache.parquet': ['coverage.parquet', 'values/NMS_CINMS/sst/data.parquet'],
      'application/vnd.pmtiles': ['basemap.pmtiles'],
      'application/xml': ['feeds/all.xml'],
      'text/markdown; charset=utf-8': ['README.md'],
    }
    expect(byType('r2')).toEqual(want)
    expect(byType('s3')).toEqual(want)
  })
  it('--type overrides an extension, --cache-control and --content-encoding reach both tools', () => {
    const u = uploads(run([catalog(), 'indicators', '--type', 'xml=application/atom+xml; charset=utf-8', '--cache-control', 'no-cache', '--content-encoding', 'gzip']).calls)
    const feed = u.filter(c => c.files?.includes('feeds/all.xml'))
    expect(feed.map(typeOf)).toEqual(['application/atom+xml; charset=utf-8', 'application/atom+xml; charset=utf-8'])
    const aws = feed.find(c => c.tool === 'aws')!
    expect(aws.args.slice(aws.args.indexOf('--cache-control'), aws.args.indexOf('--cache-control') + 2)).toEqual(['--cache-control', 'no-cache'])
    expect(aws.args).toContain('--content-encoding')
    const r2 = feed.find(c => c.tool === 'rclone')!
    expect(r2.args).toContain('Cache-Control: no-cache')
    expect(r2.args).toContain('Content-Encoding: gzip')
  })
  it('--last uploads the manifest after every other file, on each store', () => {
    const u = uploads(run([catalog(), 'indicators', '--last', 'indicators.json']).calls)
    for (const s of ['r2', 's3']) {
      const mine = u.filter(c => store(c) === s)
      expect(mine.at(-1)!.files).toEqual(['indicators.json'])
      expect(mine.slice(0, -1).flatMap(c => c.files)).not.toContain('indicators.json')
    }
  })
  it('--include and --exclude choose the files (globs over the relative path, * crosses /)', () => {
    const u = uploads(run([catalog(), 'indicators', '--include', '*.parquet', '--exclude', 'values/*']).calls)
    expect(u.flatMap(c => c.files)).toEqual(['coverage.parquet', 'coverage.parquet'])
  })
  it('a single file keeps its name, or takes --as', () => {
    const d = catalog()
    const u = uploads(run([join(d, 'README.md'), 'indicators', '--as', 'README.md']).calls)
    expect(u.map(c => c.files)).toEqual([['README.md'], ['README.md']])
    const v = uploads(run([join(d, 'coverage.parquet'), 'indicators/']).calls)
    expect(v.map(c => c.args[2].endsWith('/') ? '' : (c.tool === 'aws' ? c.args[3] : c.args[2]))).toEqual(['r2:oceanmetrics-io-public-enam/indicators', 's3://oceanmetrics.io-public/indicators'])
  })
  it('--only-r2 and OM_STORE=r2 leave S3 alone; --only-s3 leaves R2 alone; a bad OM_STORE stops', () => {
    for (const r of [run([catalog(), 'indicators', '--only-r2']), run([catalog(), 'indicators'], { OM_STORE: 'r2' })]) {
      expect(r.calls.some(c => c.tool === 'aws')).toBe(false)
      expect(uploads(r.calls).length).toBe(5)
    }
    expect(run([catalog(), 'indicators', '--only-s3']).calls.some(c => c.tool === 'rclone')).toBe(false)
    const bad = run([catalog(), 'indicators'], { OM_STORE: 'gcs' })
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('OM_STORE must be both, r2 or s3')
  })
  it('--keep-history copies the objects that will change to <top>/_history/<date>/ on R2, before the upload', () => {
    const r = run([catalog(), 'indicators', '--keep-history', '--really'], { OM_FAKE_DIFFER: 'indicators.json,coverage.parquet' })
    const i = r.calls.findIndex(c => c.args[0] === 'check')
    expect(r.calls[i].args.slice(1, 3)[1]).toBe('r2:oceanmetrics-io-public-enam/indicators')
    const copy = r.calls[i + 1]
    expect(copy.args.slice(0, 3)).toEqual(['copy', 'r2:oceanmetrics-io-public-enam/indicators', 'r2:oceanmetrics-io-public-enam/indicators/_history/2026-10-23'])
    expect(copy.list).toEqual(['indicators.json', 'coverage.parquet'])
    expect(copy.args).toContain('--ignore-existing')
    expect(copy.args).not.toContain('--dry-run')
    expect(r.calls.slice(0, i).length).toBe(0)
    expect(r.calls.filter(c => c.tool === 'aws' && c.args.join(' ').includes('_history'))).toEqual([])
  })
  it('a deeper prefix keeps its rest under the top prefix\'s _history/; nothing changed copies nothing', () => {
    const r = run([catalog(), 'atlas/aquamaps_eov', '--keep-history'], { OM_FAKE_DIFFER: 'indicators.json' })
    const copy = r.calls.find(c => c.args[0] === 'copy' && c.list)!
    expect(copy.args[2]).toBe('r2:oceanmetrics-io-public-enam/atlas/_history/2026-10-23/aquamaps_eov')
    expect(copy.args).toContain('--dry-run')
    const none = run([catalog(), 'indicators', '--keep-history'])
    expect(none.calls.filter(c => c.list)).toEqual([])
    expect(none.out).toContain('history: nothing overwritten')
  })
  it('a missing rclone wrapper stops with an error naming it', () => {
    const r = run([catalog(), 'indicators'], { OM_RCLONE: '/nonexistent/rclone-r2.sh' })
    expect(r.code).toBe(2)
    expect(r.err).toContain('/nonexistent/rclone-r2.sh is missing')
    expect(r.calls).toEqual([])
  })
  it('refuses an empty prefix, .. and _history/ as a prefix', () => {
    for (const p of ['', 'indicators/../backups', 'indicators/_history/x']) {
      const r = run([catalog(), p])
      expect(r.code).toBe(2)
      expect(r.calls).toEqual([])
    }
  })
  it('the bucket root: refused for any folder or key but the exact key index.html (the browse page of places)', () => {
    const d = catalog()
    for (const args of [[d, '/'], [join(d, 'README.md'), '/'], [join(d, 'indicators.json'), '/', '--as', 'indicators.json'],
      [join(d, 'README.md'), '/', '--as', 'gazetteer/index.html'], [join(d, 'README.md'), '/', '--as', 'index.html.bak'], [join(d, 'README.md'), '/', '--as', 'xindex.html']]) {
      const r = run(args)
      expect(r.code, args.join(' ')).toBe(2)
      expect(r.err).toContain('the bucket root takes only the keys: index.html')
      expect(r.calls).toEqual([])
    }
    // a folder holding index.html and anything else is refused too, even with --include of a wider glob
    writeFileSync(join(d, 'index.html'), '<html/>')
    expect(run([d, '/', '--include', '*index.html']).code).toBe(0)   // matches index.html only: the other files have other names
    expect(run([d, '/', '--include', '*.html', '--include', 'README.md']).code).toBe(2)
    expect(run([d, '/']).code).toBe(2)
    // no history folder at the root, and a prefix that merely looks like it is still a prefix
    const h = run([join(d, 'index.html'), '/', '--keep-history'])
    expect(h.code).toBe(2)
    expect(h.err).toContain('the bucket root has no history folder')
  })
  it('the bucket root takes index.html on both stores, in the bucket and not in a folder of it', () => {
    const d = catalog()
    writeFileSync(join(d, 'index.html'), '<html>root</html>')
    const r = run([join(d, 'index.html'), '/', '--cache-control', 'no-cache'])
    expect(r.code).toBe(0)
    const u = uploads(r.calls)
    expect(u.map(store)).toEqual(['r2', 's3'])
    expect(u.map(c => c.files)).toEqual([['index.html'], ['index.html']])
    expect(u.map(typeOf)).toEqual(['text/html; charset=utf-8', 'text/html; charset=utf-8'])
    expect(u[0].args[1]).toMatch(/\/g\d+$/)
    expect(u[0].args[2]).toBe('r2:oceanmetrics-io-public-enam')
    expect(u[1].args[3]).toBe('s3://oceanmetrics.io-public')
    expect(r.out).toContain('r2:oceanmetrics-io-public-enam/')
    expect(r.out).not.toContain('//  ')
    for (const c of u) expect(c.args.some(a => a.startsWith('--delete'))).toBe(false)
    // and a folder of pages: the include picks the root page alone
    mkdirSync(join(d, 'gazetteer'), { recursive: true })
    writeFileSync(join(d, 'gazetteer/index.html'), '<html>g</html>')
    const f = run([d, '/', '--include', 'index.html', '--cache-control', 'no-cache'])
    expect(f.code).toBe(0)
    expect(uploads(f.calls).flatMap(c => c.files)).toEqual(['index.html', 'index.html'])
  })
})

describe('om-publish.sh rewrite', () => {
  beforeAll(() => { execFileSync('npm', ['run', 'build', '-w', 'packages/status', '-w', 'packages/catalog'], { cwd: ROOT, stdio: 'pipe' }) }, 180_000)

  /** a fake bucket: two JSON files with path-style hrefs (one gzip-encoded), one with none, one parquet */
  function bucket() {
    const d = mkdtempSync(join(tmpdir(), 'om-publish-remote-'))
    const b = join(d, 's3/oceanmetrics.io-public')
    mkdirSync(join(b, 'obis-h3/v20261012'), { recursive: true })
    mkdirSync(join(b, 'atlas/aquamaps_native'), { recursive: true })
    writeFileSync(join(b, 'obis-h3/collection.json'), `{"links":[{"href":"${S3}/obis-h3/latest.json"},{"href":"${S3}/obis-h3/v20261012/"}]}\n`)
    writeFileSync(join(b, 'obis-h3/collection.json.meta.json'), JSON.stringify({ 'content-type': 'application/json', 'cache-control': 'max-age=300' }))
    writeFileSync(join(b, 'obis-h3/v20261012/item.json'), '{"href":"https://erddap.oceanmetrics.io/erddap/griddap/x"}\n')
    writeFileSync(join(b, 'obis-h3/v20261012/cells.parquet'), 'PAR1')
    writeFileSync(join(b, 'atlas/aquamaps_native/registry_index.json'), gzipSync(`{"cog":"${S3}/marine-atlas/cog/a.tif"}`))
    writeFileSync(join(b, 'atlas/aquamaps_native/registry_index.json.meta.json'), JSON.stringify({ 'content-type': 'application/json', 'content-encoding': 'gzip' }))
    return d
  }

  it('counts per file and in total, reads S3, unzips a gzip-encoded JSON, and writes nothing', () => {
    const r = run(['rewrite', '--from', 'S3_PATH_STYLE', '--to', 'STORAGE_HOST', 'obis-h3', 'atlas/aquamaps_native/registry_index.json'], { OM_FAKE_REMOTE: bucket() })
    expect(r.code).toBe(0)
    expect(r.out.split('\n').filter(l => l.includes('\t') || l.includes('urls in'))).toEqual([
      '1\tatlas/aquamaps_native/registry_index.json',
      '2\tobis-h3/collection.json',
      '0\tobis-h3/v20261012/item.json',
      '3 urls in 2 of 3 files (dry run)',
    ])
    expect(r.calls.find(c => c.args[0] === 'lsf')!.args).toContain('s3:oceanmetrics.io-public/obis-h3')
    expect(uploads(r.calls)).toEqual([])
    expect(r.calls.some(c => c.tool === 'aws')).toBe(false)
  })
  it('--depth limits a prefix listing', () => {
    const r = run(['rewrite', '--from', 's3', '--to', 'storage', '--depth', '1', 'obis-h3'], { OM_FAKE_REMOTE: bucket() })
    expect(r.out).toContain('1 JSON objects')
  })
  it('--really uploads only the changed files, with their own headers, gzip again, history kept', () => {
    const r = run(['rewrite', '--from', 's3', '--to', 'storage', '--really', 'obis-h3', 'atlas/aquamaps_native/registry_index.json'], { OM_FAKE_REMOTE: bucket(), OM_FAKE_DIFFER: 'x' })
    expect(r.code).toBe(0)
    const u = uploads(r.calls)
    expect(u.map(c => [store(c), c.files])).toEqual([
      ['r2', ['aquamaps_native/registry_index.json']], ['s3', ['aquamaps_native/registry_index.json']],
      ['r2', ['collection.json']], ['s3', ['collection.json']],
    ])
    const coll = u.find(c => c.tool === 'aws' && c.files?.includes('collection.json'))!
    expect(coll.args).toContain('s3://oceanmetrics.io-public/obis-h3')
    expect(coll.args.slice(coll.args.indexOf('--cache-control'), coll.args.indexOf('--cache-control') + 2)).toEqual(['--cache-control', 'max-age=300'])
    const reg = u.find(c => c.tool === 'rclone' && c.files?.includes('aquamaps_native/registry_index.json'))!
    expect(reg.args).toContain('Content-Encoding: gzip')
    expect(gunzipSync(bytes(reg)).toString()).toBe('{"cog":"https://storage.oceanmetrics.io/marine-atlas/cog/a.tif"}')
    expect(bytes(coll).toString()).toBe('{"links":[{"href":"https://storage.oceanmetrics.io/obis-h3/latest.json"},{"href":"https://storage.oceanmetrics.io/obis-h3/v20261012/"}]}\n')
    expect(r.calls.filter(c => c.args[0] === 'check').length).toBe(2)
  })
  it('regression 2026-10-23: the headers are read recursively, files only (a nested key is not listed as its folder)', () => {
    // the first live --really read `lsjson -M --files-from-raw` without -R: rclone answered with the top folders
    // (`atlas`, `indicators`, IsDir true) and the upload stopped at `cp .../src/atlas` (nothing uploaded)
    const r = run(['rewrite', '--from', 's3', '--to', 'storage', '--really', 'obis-h3', 'atlas/aquamaps_native/registry_index.json'], { OM_FAKE_REMOTE: bucket(), OM_FAKE_DIFFER: 'x' })
    expect(r.code).toBe(0)
    const ls = r.calls.find(c => c.args[0] === 'lsjson')!
    expect(ls.args).toEqual(expect.arrayContaining(['-M', '-R', '--files-only']))
  })
  it('needs --from, --to and a target', () => {
    expect(run(['rewrite', '--to', 'storage', 'obis-h3']).code).toBe(2)
    expect(run(['rewrite', '--from', 's3', '--to', 'storage']).code).toBe(2)
  })
})

// ---- the staged plan: what is staged, in which groups and order, with which headers, is pinned byte for byte ----
// scripts/om-publish/staging-plan.golden.json was recorded from the per-file implementation (one subprocess per file,
// 13,000 files a minute) before staging became one pass (awk for the types, perl for the symlinks). A change to the plan
// is a change to what reaches the bucket: regenerate it only on purpose (UPDATE_GOLDEN=1 npx vitest run scripts/om-publish.test.ts)
const GOLDEN = join(ROOT, 'scripts/om-publish/staging-plan.golden.json')

/** a deterministic tree with the awkward names: upper-case and missing extensions, a dotted folder, spaces, .DS_Store */
function planTree() {
  const d = mkdtempSync(join(tmpdir(), 'om-publish-src-'))
  const names = [
    'collection.json', 'index.html', 'LICENSE', 'README.MD', '.hidden', '.DS_Store', 'x/.DS_Store', 'v1.2/data', 'v1.2/data.JSON',
    'a b/c d.json', 'a b/e.PARQUET', 'items/a.json', 'items/b.json', 'score_1.tif', 'score_1_3857.tif', 'score_2.Tiff', 'feeds/index.json',
    'feeds/a.xml', 'feeds/b.atom', 'changes/latest.json', 'changes/20260101.json', 'changes/20260102.parquet', 'g/h/i/j/k.geojson',
    'm.nc', 'n.gz', 'o.zip', 'p.svg', 'q.jpg', 'r.jpeg', 's.png', 't.pmtiles', 'u.csv', 'v.txt', 'w.md', 'x.unknownext', 'noext/y', 'dir.with.dots/z.json',
  ]
  for (let i = 0; i < 150; i++) names.push(`bulk/b${i % 7}/f${String(i).padStart(3, '0')}.${['json', 'parquet', 'html', 'xml', 'png', 'tif', 'csv', 'bin'][i % 8]}`)
  for (const n of names) {
    mkdirSync(join(d, n, '..'), { recursive: true })
    writeFileSync(join(d, n), n)
  }
  return d
}
const normal = (s: string) => s.replace(/[^\s"]*om-publish-src-[A-Za-z0-9]+/g, '<SRC>').replace(/[^\s"]*om-publish\.[A-Za-z0-9]+/g, '<TMP>').replace(/differ\.\d+/g, 'differ.N')
const plan = (args: string[], env: Record<string, string> = {}) => {
  const r = run(args, env)
  return { code: r.code, out: normal(r.out), err: normal(r.err), calls: r.calls.map(c => JSON.parse(normal(JSON.stringify(c)))) }
}

describe('om-publish.sh: the staged plan', () => {
  const scenarios: [string, (d: string) => [string[], Record<string, string>?]][] = [
    ['dry run, both stores', d => [[d, 'obis-h3/v1']]],
    ['really, history, two files differ', d => [[d, 'indicators', '--really', '--keep-history'], { OM_FAKE_DIFFER: 'collection.json,items/a.json' }]],
    ['the indicators chain: --last, --type, --cache-control', d => [[d, 'indicators', '--really', '--cache-control', 'public, max-age=300', '--type', 'xml=application/atom+xml; charset=utf-8', '--type', 'BIN=application/x-bin',
      '--last', 'changes/*.parquet', '--last', 'changes/[0-9]*.json', '--last', 'feeds/*.xml', '--last', 'feeds/index.json', '--last', 'changes/latest.json', '--last', 'collection.json']]],
    ['include and exclude', d => [[d, 'gazetteer/x', '--include', '*.json', '--include', '*.png', '--exclude', 'bulk/*', '--exclude', 'a b/*']]],
    ['one file with --as', d => [[join(d, 'collection.json'), 'atlas', '--as', 'catalog.json', '--cache-control', 'no-cache']]],
    ['r2 only, size-only, gzip', d => [[d, 'atlas/aquamaps_native', '--only-r2', '--size-only', '--content-encoding', 'gzip', '--exclude', 'bulk/*']]],
    ['s3 only, the pmtiles and the dotted folder', d => [[d, 'basemap', '--only-s3', '--include', '*.pmtiles', '--include', 'dir.with.dots/*', '--include', 'v1.2/*']]],
  ]
  it('is identical to the recorded plan for the fixture tree, scenario by scenario', () => {
    const got = scenarios.map(([name, f]) => { const d = planTree(); const [args, env] = f(d); return { name, ...plan(args, env) } })
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n')
    const want = JSON.parse(readFileSync(GOLDEN, 'utf8'))
    expect(got.map(g => g.name)).toEqual(want.map((w: { name: string }) => w.name))
    for (let i = 0; i < got.length; i++) expect(got[i], got[i].name).toEqual(want[i])
    expect(got.every(g => g.code === 0)).toBe(true)
  }, 60000)
  it('regression: a folder, a name with spaces and a dotted folder reach the stage with their own content types', () => {
    const d = planTree()
    const u = uploads(run([d, 'p', '--only-r2']).calls)
    const where = (f: string) => u.find(c => c.files?.includes(f))!
    expect(typeOf(where('a b/c d.json'))).toBe('application/json')
    expect(typeOf(where('v1.2/data'))).toBeUndefined()
    expect(typeOf(where('v1.2/data.JSON'))).toBe('application/json')
    expect(typeOf(where('score_2.Tiff'))).toBe('image/tiff')
    expect(u.flatMap(c => c.files!)).not.toContain('.DS_Store')
    expect(u.flatMap(c => c.files!)).not.toContain('x/.DS_Store')
  })
})
