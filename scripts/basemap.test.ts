import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASEMAP_VERSION, CONTOUR_LEVELS, NAME_RANKS, tilesAt } from '../packages/map/src/basemap.js'

// the tile build (scripts/basemap/build_gebco.sh) and the style (packages/map/src/basemap.ts) each hold the isobath
// level gate and the undersea-name ranks; the archives are built once and read for months, so a drift between the two
// would show as lines or labels that never appear. These tests read the script's own rules and hold them to the style's.
const SCRIPT = readFileSync(new URL('./basemap/build_gebco.sh', import.meta.url), 'utf8')
const grab = (re: RegExp): string => {
  const m = SCRIPT.match(re)
  if (!m) throw new Error(`build_gebco.sh: ${re} not found`)
  return m[1]
}
const sqlite = (sql: string): string => execFileSync('sqlite3', [':memory:', sql], { encoding: 'utf8' }).trim()

describe('build_gebco.sh: isobath levels', () => {
  // gdal_contour writes ELEV in metres, negative below sea level; the SQL turns it into the tile's `ele` and `level`
  const levelSql = grab(/^LEVEL_SQL="(.*)"$/m)
  const level = (elev: number) => {
    const [ele, lv] = sqlite(`SELECT ${levelSql.replaceAll('ELEV', `(${elev}.0)`)}`).split('|').map(Number)
    return { ele, level: lv }
  }

  it('50 m is level 0, 100-450 and 750 m level 1, 500-multiples level 2, 1000-multiples level 3', () => {
    expect(level(-50)).toEqual({ ele: 50, level: 0 })
    expect(level(-100)).toEqual({ ele: 100, level: 1 })
    expect(level(-400)).toEqual({ ele: 400, level: 1 })
    expect(level(-750)).toEqual({ ele: 750, level: 1 })
    expect(level(-500)).toEqual({ ele: 500, level: 2 })
    expect(level(-1500)).toEqual({ ele: 1500, level: 2 })
    expect(level(-1000)).toEqual({ ele: 1000, level: 3 })
    expect(level(-10000)).toEqual({ ele: 10000, level: 3 })
  })

  it('the zoom gate of the tiles is the style\'s CONTOUR_LEVELS', () => {
    // {"*":["any",["==","level",3],["all",[">=","$zoom",5],["==","level",2]], ...]} is tippecanoe's -j filter
    const filter = JSON.parse(grab(/^CONTOUR_FILTER='(.*)'$/m))['*'] as unknown[]
    expect(filter[0]).toBe('any')
    const gate = new Map<number, number>()
    for (const clause of filter.slice(1) as any[]) {
      if (clause[0] === '==') gate.set(clause[2], 0) // `level == n`, no zoom condition: from z0
      else gate.set(clause[2][2], clause[1][2]) // all(zoom >= z, level == n)
    }
    const fromStyle = new Map(CONTOUR_LEVELS.map((l) => [l.level, l.minzoom]))
    expect(Object.fromEntries(gate)).toEqual(Object.fromEntries(fromStyle))
  })
})

describe('build_gebco.sh: undersea names', () => {
  const rankSql = grab(/^RANK_SQL="([\s\S]*?)"\nnames\(\)/m)
  const rank = (type: string) => Number(sqlite(`WITH g(TYPE) AS (SELECT '${type}') SELECT ${rankSql} FROM g`))

  it('ridges and trenches are rank 1, knolls and shoals rank 3, basins, banks and seamounts rank 2', () => {
    for (const t of ['Ridge', 'Trench', 'Fracture Zone', 'Abyssal Plain']) expect(rank(t)).toBe(1)
    for (const t of ['Knoll', 'Shoal', 'Reef', 'Pinnacle']) expect(rank(t)).toBe(3)
    for (const t of ['Basin', 'Bank', 'Seamount', 'Canyon', 'Guyot', 'a type nobody listed']) expect(rank(t)).toBe(2)
  })

  it('the style reads ranks 1, 2 and 3', () => {
    expect(NAME_RANKS.map((r) => r.rank)).toEqual([1, 2, 3])
  })
})

describe('build_gebco.sh: the upload step goes through om-publish.sh', () => {
  // the real om-publish.sh against the fake aws and rclone of om-publish.test.ts: what each call would send is recorded
  const FAKE = new URL('./om-publish/fake', import.meta.url).pathname
  const R2 = 'r2:oceanmetrics-io-public-enam'
  const S3 = 's3://oceanmetrics.io-public'
  // the archives get a modification time, so the version (the date of the build) is fixed: the newest one wins
  const MTIMES: Record<string, string> = {
    'gebco/far.pmtiles': '2026-10-22T10:00:00Z', 'gebco/core.pmtiles': '2026-10-23T02:04:35Z', 'osm/land.pmtiles': '2026-10-23T02:06:02Z',
    'work/contours_low.pmtiles': '2026-11-30T00:00:00Z', 'work/far.mbtiles': '2026-11-30T00:00:00Z', 'raw/land.zip': '2026-11-30T00:00:00Z',
  }
  const upload = (env: Record<string, string> = {}, only: string[] = Object.keys(MTIMES)) => {
    const out = mkdtempSync(join(tmpdir(), 'gebco-out-'))
    for (const f of only) {
      mkdirSync(join(out, f, '..'), { recursive: true })
      writeFileSync(join(out, f), f)
      const t = new Date(MTIMES[f])
      utimesSync(join(out, f), t, t)
    }
    const log = join(out, 'calls.log')
    writeFileSync(log, '')
    const r = spawnSync('bash', [new URL('./basemap/build_gebco.sh', import.meta.url).pathname, join(out, 'src'), out, 'upload'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${FAKE}:${process.env.PATH}`, OM_RCLONE: join(FAKE, 'rclone-r2.sh'), OM_FAKE_LOG: log, OM_STORE: '', ...env },
    })
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { tool: string; args: string[]; files?: string[] })
    return { ...r, calls, uploads: calls.filter((c) => c.files) }
  }
  // the destination of an upload call: r2:<bucket>/<prefix> or s3://<bucket>/<prefix>
  const dest = (c: { tool: string; args: string[] }) => c.args.find((a) => a.startsWith(c.tool === 'rclone' ? 'r2:' : 's3://'))!.replace(c.tool === 'rclone' ? R2 : S3, '')

  it('sends the archives to the versioned keys basemap/<set>/v<build date>/ and then the unversioned basemap/<set>/, R2 then S3, as application/vnd.pmtiles, and nothing of work/ or raw/', () => {
    const r = upload()
    expect(r.status).toBe(0)
    // three om-publish calls (gebco versioned, osm versioned, the unversioned pair), each R2 then S3
    expect(r.uploads.map((c) => `${c.tool} ${dest(c)}`)).toEqual([
      'rclone /basemap/gebco/v20261023', 'aws /basemap/gebco/v20261023',
      'rclone /basemap/osm/v20261023', 'aws /basemap/osm/v20261023',
      'rclone /basemap', 'aws /basemap',
    ])
    expect(r.uploads.map((c) => c.files)).toEqual([
      ['core.pmtiles', 'far.pmtiles'], ['core.pmtiles', 'far.pmtiles'],
      ['land.pmtiles'], ['land.pmtiles'],
      ['gebco/core.pmtiles', 'gebco/far.pmtiles', 'osm/land.pmtiles'], ['gebco/core.pmtiles', 'gebco/far.pmtiles', 'osm/land.pmtiles'],
    ])
    expect(r.uploads.filter((c) => c.tool === 'rclone').every((c) => c.args.includes('Content-Type: application/vnd.pmtiles'))).toBe(true)
    for (const c of r.uploads) expect(c.args.some((a) => a.startsWith('--delete') || a === '--dry-run' || a === '--dryrun')).toBe(false)
  })
  it('the version is the newest archive\'s date (UTC), BASEMAP_VERSION overrides it, a bad one stops before any call', () => {
    expect(upload({}, ['gebco/far.pmtiles']).uploads.map(dest)).toEqual(['/basemap/gebco/v20261022', '/basemap/gebco/v20261022', '/basemap', '/basemap'])
    expect(upload({ BASEMAP_VERSION: '20270105' }).uploads.map(dest).slice(0, 2)).toEqual(['/basemap/gebco/v20270105', '/basemap/gebco/v20270105'])
    for (const bad of ['2026-10-23', 'v20261023', '202610', '20261023/../x']) {
      const r = upload({ BASEMAP_VERSION: bad })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('BASEMAP_VERSION must be YYYYMMDD')
      expect(r.calls).toEqual([])
    }
  })
  it('the keys it writes are the keys @oceanmetrics/map reads (tilesAt), and each versioned key is immutable at the Worker', () => {
    // the archive names the script writes: far, core, core-sanctuaries, contours, names (gebco/) and land (osm/)
    const names = ['far', 'core', 'core-sanctuaries', 'contours', 'names'].map((n) => `gebco/${n}`).concat('osm/land')
    const t = tilesAt(BASEMAP_VERSION)
    const urls = [t.core, t.far, ...(t.regional ?? []), t.contours, t.names, t.land]
    expect(urls.map((u) => u!.replace('https://storage.oceanmetrics.io/basemap/', ''))).toEqual(
      ['core', 'far', 'core-sanctuaries', 'contours', 'names', 'land'].map((n) => `${n === 'land' ? 'osm' : 'gebco'}/v${BASEMAP_VERSION}/${n}.pmtiles`))
    for (const n of names) expect(SCRIPT).toContain(n.split('/')[0]) // the sets the upload loops over
    expect(SCRIPT).toContain('for set in gebco osm')
  })
  it('UPLOAD_MODE=--dry-run lists in the tools\' dry-run modes; OM_STORE=r2 leaves S3 alone', () => {
    const d = upload({ UPLOAD_MODE: '--dry-run', OM_STORE: 'r2' })
    expect(d.status).toBe(0)
    expect(d.uploads.map((c) => c.tool)).toEqual(['rclone', 'rclone', 'rclone'])
    expect(d.uploads.every((c) => c.args.includes('--dry-run'))).toBe(true)
    expect(d.stdout).toContain('(dry run)')
  })
  it('a version folder that already holds other bytes stops the upload (exit 3) before the unversioned keys', () => {
    const r = upload({ OM_FAKE_DIFFER: 'far.pmtiles' })
    expect(r.status).toBe(3)
    expect(r.stderr).toContain('immutable key')
    expect(r.uploads).toEqual([])
  })
  it('a missing publisher stops with its path', () => {
    const r = upload({ OM_PUBLISH: '/nonexistent/om-publish.sh' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('/nonexistent/om-publish.sh not found')
  })
})
