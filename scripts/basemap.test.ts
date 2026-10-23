import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
