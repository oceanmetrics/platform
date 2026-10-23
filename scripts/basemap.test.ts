import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTOUR_LEVELS, NAME_RANKS } from '../packages/map/src/basemap.js'

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
  const upload = (env: Record<string, string> = {}) => {
    const out = mkdtempSync(join(tmpdir(), 'gebco-out-'))
    for (const f of ['gebco/far.pmtiles', 'gebco/core.pmtiles', 'osm/land.pmtiles', 'work/contours_low.pmtiles', 'work/far.mbtiles', 'raw/land.zip']) {
      mkdirSync(join(out, f, '..'), { recursive: true })
      writeFileSync(join(out, f), f)
    }
    const log = join(out, 'calls.log')
    writeFileSync(log, '')
    const r = spawnSync('bash', [new URL('./basemap/build_gebco.sh', import.meta.url).pathname, join(out, 'src'), out, 'upload'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${FAKE}:${process.env.PATH}`, OM_RCLONE: join(FAKE, 'rclone-r2.sh'), OM_FAKE_LOG: log, OM_STORE: '', ...env },
    })
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { tool: string; args: string[]; files?: string[] })
    return { ...r, calls, uploads: calls.filter((c) => c.files) }
  }

  it('sends the archives of gebco/ and osm/ to basemap/ on R2 then S3, as application/vnd.pmtiles, and nothing of work/ or raw/', () => {
    const r = upload()
    expect(r.status).toBe(0)
    expect(r.uploads.map((c) => c.tool)).toEqual(['rclone', 'aws'])
    for (const c of r.uploads) expect(c.files).toEqual(['gebco/core.pmtiles', 'gebco/far.pmtiles', 'osm/land.pmtiles'])
    expect(r.uploads[0].args).toContain('Content-Type: application/vnd.pmtiles')
    expect(r.uploads[0].args).toContain('r2:oceanmetrics-io-public-enam/basemap')
    expect(r.uploads[1].args).toContain('s3://oceanmetrics.io-public/basemap')
    for (const c of r.uploads) expect(c.args.some((a) => a.startsWith('--delete') || a === '--dry-run' || a === '--dryrun')).toBe(false)
  })
  it('UPLOAD_MODE=--dry-run lists in the tools\' dry-run modes; OM_STORE=r2 leaves S3 alone', () => {
    const d = upload({ UPLOAD_MODE: '--dry-run', OM_STORE: 'r2' })
    expect(d.status).toBe(0)
    expect(d.uploads.map((c) => c.tool)).toEqual(['rclone'])
    expect(d.uploads[0].args).toContain('--dry-run')
    expect(d.stdout).toContain('(dry run)')
  })
  it('a missing publisher stops with its path', () => {
    const r = upload({ OM_PUBLISH: '/nonexistent/om-publish.sh' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('/nonexistent/om-publish.sh not found')
  })
})
