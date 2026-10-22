// the SQL templates: the strings the package ships are sql/*.sql byte for byte, those files are byte-identical to
// erddap-places' sql/ and to om_extract's copies (when the checkouts are beside platform; skipped otherwise), and each
// template, rendered, runs in DuckDB-WASM (the node-blocking bundle of the package the browser runs) on a tiny
// synthetic slab and mask. the cases are erddap-places app/src/lib/sql.test.ts's, which ran the native duckdb CLI.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lit, render, template, templateNames } from '../src/sql.js'
import { TEMPLATES } from '../src/sqlTemplates.js'
import { isoDay } from '../src/preview.js'
import { nodeEngine } from './helpers/nodeDb.js'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SQL = path.join(PKG, 'sql')
const NAMES = ['last_step', 'points_tabledap', 'stats_categorical', 'stats_daily', 'stats_tabledap']
const ERDDAP_PLACES = path.resolve(process.env.OM_ERDDAP_PLACES_DIR ?? path.join(PKG, '../../../erddap-places'), 'sql')
const EXTRACT = path.resolve(process.env.OM_EXTRACT_DIR ?? path.join(PKG, '../../../extract'), 'om_extract', 'sql')
const bytes = (dir: string, n: string) => fs.readFileSync(path.join(dir, `${n}.sql`))

describe('the shipped templates', () => {
  it('are the five of sql/, by name', () => {
    expect(templateNames()).toEqual(NAMES)
    expect(fs.readdirSync(SQL).filter((f) => f.endsWith('.sql')).sort()).toEqual(NAMES.map((n) => `${n}.sql`))
  })
  it('sqlTemplates.ts is current: every string is its .sql file byte for byte (else run scripts/sql-templates.mjs)', () => {
    for (const n of NAMES) expect(Buffer.from(TEMPLATES[n], 'utf8').equals(bytes(SQL, n)), n).toBe(true)
  })
  it('names a missing template and a missing param', () => {
    expect(() => template('nope')).toThrow(/no SQL template nope/)
    expect(() => render('stats_daily', { expr: 's.v', slab: 'slab' })).toThrow('template stats_daily: missing param mask')
  })
})

describe.skipIf(!fs.existsSync(ERDDAP_PLACES))(`byte-identical to erddap-places' sql/ (${ERDDAP_PLACES})`, () => {
  for (const n of NAMES) it(n, () => expect(bytes(SQL, n).equals(bytes(ERDDAP_PLACES, n))).toBe(true))
})

// om_extract carries the three grid templates (the tabledap two have no Python reader yet)
const extractNames = fs.existsSync(EXTRACT) ? fs.readdirSync(EXTRACT).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4)).sort() : []
describe.skipIf(!extractNames.length)(`byte-identical to om_extract's sql/ (${EXTRACT})`, () => {
  it('om_extract has the three grid templates', () => expect(extractNames).toEqual(['last_step', 'stats_categorical', 'stats_daily']))
  for (const n of extractNames) it(n, () => expect(bytes(SQL, n).equals(bytes(EXTRACT, n))).toBe(true))
})

/** two dates x four cells: classes 1,2,1,3 with weights 1, .5, 1, .25 (a quarter-covered cell). */
const FIXTURE = `
CREATE TABLE mask AS SELECT * FROM (VALUES
  (20.00, -160.00, 1.00), (20.00, -159.95, 0.50),
  (20.05, -160.00, 1.00), (20.05, -159.95, 0.25)
) t(latitude, longitude, weight);
CREATE TABLE slab AS SELECT * FROM (VALUES
  (TIMESTAMP '2026-01-01 12:00:00', 20.00, -160.00, 1, 25.0),
  (TIMESTAMP '2026-01-01 12:00:00', 20.00, -159.95, 2, 26.0),
  (TIMESTAMP '2026-01-01 12:00:00', 20.05, -160.00, 1, 27.0),
  (TIMESTAMP '2026-01-01 12:00:00', 20.05, -159.95, 3, 29.0),
  (TIMESTAMP '2026-01-09 12:00:00', 20.00, -160.00, 2, 25.5),
  (TIMESTAMP '2026-01-09 12:00:00', 20.00, -159.95, 2, 26.5),
  (TIMESTAMP '2026-01-09 12:00:00', 20.05, -160.00, 2, 27.5),
  (TIMESTAMP '2026-01-09 12:00:00', 20.05, -159.95, 2, 29.5),
  -- a cell outside the mask: it must not reach any statistic
  (TIMESTAMP '2026-01-01 12:00:00', 40.00,  -60.00, 9, 99.0)
) t("time", latitude, longitude, "CLASS", "SST");
`

/** the fixture and one statement, in a fresh node DuckDB-WASM; dates as yyyy-mm-dd, as the CLI's -json gave them */
let engine: ReturnType<typeof nodeEngine> | null = null
async function duck(sql: string, fixture = FIXTURE): Promise<Record<string, any>[]> {
  engine ??= nodeEngine()                                   // one database; each fixture replaces its tables
  const rows = await engine.exec(fixture.replace(/CREATE TABLE/g, 'CREATE OR REPLACE TABLE') + sql)
  return rows.map((r) => ('date' in r ? { ...r, date: isoDay(r.date) } : r))
}

describe('sql templates', () => {
  it('ships the statistics and map templates', () => {
    expect(templateNames()).toEqual(expect.arrayContaining(
      ['stats_daily', 'stats_categorical', 'last_step', 'stats_tabledap', 'points_tabledap']))
  })
  it('quotes literals and splices identifiers', () => {
    expect(lit("O'ahu")).toBe("'O''ahu'")
    expect(render('stats_categorical', { expr: 's."CLASS"', slab: 'slab', mask: 'mask' })).toContain('FROM slab s')
  })
})

describe('stats_categorical.sql', () => {
  const rows = () => duck(render('stats_categorical', { expr: 's."CLASS"', slab: 'slab', mask: 'mask' }))

  it('gives the area-weighted fractions per date x class, summing to 1 per date', async () => {
    const r = await rows()
    expect(r.map((x) => `${x.date}:${x.class}`)).toEqual(
      ['2026-01-01:1', '2026-01-01:2', '2026-01-01:3', '2026-01-09:2'])
    for (const date of ['2026-01-01', '2026-01-09']) {
      const sum = r.filter((x) => x.date === date).reduce((s, x) => s + Number(x.fraction), 0)
      expect(sum).toBeCloseTo(1, 12)
    }
    // date 1: weights 1 + 1 = 2 of 2.75 in class 1, .5 in class 2, .25 in class 3
    const d1 = r.filter((x) => x.date === '2026-01-01')
    expect(Number(d1[0].fraction)).toBeCloseTo(2 / 2.75, 12)
    expect(Number(d1[1].fraction)).toBeCloseTo(0.5 / 2.75, 12)
    expect(Number(d1[2].fraction)).toBeCloseTo(0.25 / 2.75, 12)
  })

  it('counts cells and percentages independently of the area weights', async () => {
    const d1 = (await rows()).filter((x) => x.date === '2026-01-01')
    expect(d1.map((x) => x.n)).toEqual([2, 1, 1])
    expect(d1.reduce((s, x) => s + Number(x.percent_cells), 0)).toBeCloseTo(100, 10)
  })

  it('drops cells that are not in the mask (a single class on the second date)', async () => {
    const r = await rows()
    expect(r.some((x) => x.class === 9)).toBe(false)
    const d2 = r.filter((x) => x.date === '2026-01-09')
    expect(d2).toHaveLength(1)
    expect(Number(d2[0].fraction)).toBe(1)
  })
})

describe('last_step.sql', () => {
  it('returns the masked cells of the latest time step only, for the map', async () => {
    const r = await duck(render('last_step', { expr: 's."SST"', slab: 'slab', mask: 'mask' }))
    expect(r.map((x) => x.date)).toEqual(Array(4).fill('2026-01-09'))
    // ordered by latitude then longitude, with the mask's own coordinates and weights
    expect(r.map((x) => [Number(x.latitude), Number(x.longitude), Number(x.weight), Number(x.value)])).toEqual([
      [20.00, -160.00, 1.00, 25.5],
      [20.00, -159.95, 0.50, 26.5],
      [20.05, -160.00, 1.00, 27.5],
      [20.05, -159.95, 0.25, 29.5],
    ])
  })
  it('drops cells outside the mask', async () => {
    const r = await duck(render('last_step', { expr: 's."SST"', slab: 'slab', mask: 'mask' }))
    expect(r.some((x) => Number(x.value) === 99)).toBe(false)
  })
})

describe('stats_daily.sql', () => {
  it('computes the plain and the area-weighted mean', async () => {
    const r = await duck(render('stats_daily', { expr: 's."SST"', slab: 'slab', mask: 'mask' }))
    expect(r).toHaveLength(2)
    expect(Number(r[0].mean)).toBeCloseTo((25 + 26 + 27 + 29) / 4, 10)
    expect(Number(r[0].mean_wt)).toBeCloseTo((25 * 1 + 26 * 0.5 + 27 * 1 + 29 * 0.25) / 2.75, 10)
    expect(r[0].n).toBe(4)
  })
  it('applies a unit conversion given in the value expression', async () => {
    const r = await duck(render('stats_daily', { expr: '(s."SST" + 273.15)', slab: 'slab', mask: 'mask' }))
    expect(Number(r[0].mean)).toBeCloseTo((25 + 26 + 27 + 29) / 4 + 273.15, 8)
  })
})

// ── tabledap (point samples) ──────────────────────────────────────────────────
/** two stations, two cruises a quarter apart, three depths each; one station outside the mask. */
const TABLE_FIXTURE = `
CREATE TABLE mask AS SELECT * FROM (VALUES
  (34.00, -120.50, 1.0), (34.10, -120.60, 1.0)
) t(latitude, longitude, weight);
CREATE TABLE slab AS SELECT * FROM (VALUES
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 34.00, -120.50,  0.0, 'temperature', 15.0),
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 34.00, -120.50, 10.0, 'temperature', 14.0),
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 34.00, -120.50, 20.0, 'temperature', 13.0),
  (TIMESTAMPTZ '2015-01-27 11:02:00Z', 34.10, -120.60,  0.0, 'temperature', 16.0),
  (TIMESTAMPTZ '2015-01-27 11:02:00Z', 34.10, -120.60, 10.0, 'temperature', 12.0),
  (TIMESTAMPTZ '2015-04-14 09:00:00Z', 34.00, -120.50,  0.0, 'temperature', 18.0),
  (TIMESTAMPTZ '2015-04-14 09:00:00Z', 34.00, -120.50, 10.0, 'temperature', NULL),
  -- a station outside the place: it must not reach any statistic
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 40.00,  -60.00,  0.0, 'temperature', 99.0)
) t("time", latitude, longitude, depth, measurement_type, measurement_value);
`

const duckTable = (sql: string) => duck(sql, TABLE_FIXTURE)

const TPARAMS = { expr: 's."measurement_value"', slab: 'slab', mask: 'mask' }

describe('stats_tabledap.sql', () => {
  const rows = () => duckTable(render('stats_tabledap', TPARAMS))

  it('rolls the sparse points up by month, not by day', async () => {
    const r = await rows()
    expect(r.map((x) => x.date)).toEqual(['2015-01-01', '2015-04-01'])
  })
  it('counts measurements and the distinct casts behind them', async () => {
    const [jan, apr] = await rows()
    expect(jan.n).toBe(5)        // 3 depths at one station + 2 at the other
    expect(jan.n_casts).toBe(2)  // but only two sampling events
    expect(apr.n).toBe(1)        // the NULL measurement is not counted
    expect(apr.n_casts).toBe(1)
  })
  it('computes the month mean, sd and the min-max band the chart draws', async () => {
    const [jan] = await rows()
    expect(Number(jan.mean)).toBeCloseTo((15 + 14 + 13 + 16 + 12) / 5, 10)
    expect(Number(jan.min)).toBe(12)
    expect(Number(jan.max)).toBe(16)
    expect(Number(jan.p10)).toBeCloseTo(12.4, 6)   // quantile_cont over 12,13,14,15,16
    expect(Number(jan.p90)).toBeCloseTo(15.6, 6)
    expect(Number(jan.sd)).toBeGreaterThan(0)
  })
  it('drops the samples that are not in the point mask', async () => {
    expect((await rows()).some((x) => Number(x.max) === 99)).toBe(false)
  })
  it('honours a unit conversion given in the value expression', async () => {
    const r = await duckTable(render('stats_tabledap', { ...TPARAMS, expr: '(s."measurement_value" + 273.15)' }))
    expect(Number(r[0].mean)).toBeCloseTo((15 + 14 + 13 + 16 + 12) / 5 + 273.15, 8)
  })
})

describe('points_tabledap.sql', () => {
  it('gives the map one row per station: its mean, its n and its last sample date', async () => {
    const r = await duckTable(render('points_tabledap', TPARAMS))
    expect(r).toHaveLength(2)
    const a = r.find((x) => Number(x.latitude) === 34)!
    expect(Number(a.longitude)).toBe(-120.5)
    expect(Number(a.mean ?? a.value)).toBeCloseTo((15 + 14 + 13 + 18) / 4, 10)
    expect(a.n).toBe(4)
    expect(a.date).toBe('2015-04-14')
    expect(Number(a.weight)).toBe(1)
  })
})
