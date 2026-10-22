// parity with the Python engine: the mask fixtures of extract/tests/fixtures/mask were written BY erddap-places'
// TypeScript (make_expected.mjs imports its gridMask.ts, wkb.ts and gazetteer.ts placeLobes()), and om_extract's
// mask reproduces them bit for bit. here the moved modules must reproduce them too: the same WKB through wkbToGeoJSON,
// placeLobes and gridMask on the same axes gives the same lobes, the same rows in the same order and the same weights,
// compared with ===. the fixtures also record the sha256 of the sources that wrote them, which must be the sha256 of
// this package's mask.ts, wkb.ts and placeLobes() text (moved byte for byte).
//
// skipped with a reason when the extract checkout is not beside platform (OM_EXTRACT_DIR overrides the path), and when
// this CPU's Math.sin differs from the generator's (v8_sin.json.gz: the fixtures were made on arm64, where V8's fdlibm
// sin uses fused multiply-adds; turf's ring area is the one transcendental in the mask).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { gridMask } from '../src/mask.js'
import { placeLobes } from '../src/lobes.js'
import { wkbToGeoJSON } from '../src/wkb.js'

const PKG   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXTRACT = path.resolve(process.env.OM_EXTRACT_DIR ?? path.join(PKG, '../../../extract'))
const FIX   = path.join(EXTRACT, 'tests', 'fixtures', 'mask')
const have  = fs.existsSync(FIX)
const gunzip = (f: string) => zlib.gunzipSync(fs.readFileSync(path.join(FIX, f)))
const load  = (f: string) => JSON.parse(gunzip(f).toString('utf8'))

const cases = have ? fs.readdirSync(FIX).filter((f) => f.endsWith('.json.gz') && f !== 'v8_sin.json.gz').sort() : []
const sinOk = (() => {
  if (!have || !fs.existsSync(path.join(FIX, 'v8_sin.json.gz'))) return false
  const s = load('v8_sin.json.gz') as { x: number[]; sin: number[] }
  return s.x.every((x, i) => Math.sin(x) === s.sin[i])
})()
const skip = !have ? `no extract checkout at ${EXTRACT}` : !sinOk ? 'this CPU\'s Math.sin differs from the fixtures\' generator (arm64)' : ''
if (skip) console.warn(`parity.test.ts skipped: ${skip}`)

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const src = (f: string) => fs.readFileSync(path.join(PKG, 'src', f), 'utf8')
const lobeText = (s: string) => { const i = s.indexOf('export function placeLobes('); return s.slice(i, s.indexOf('\n}\n', i) + 3) }

describe.skipIf(!!skip)('mask parity with the fixtures the TypeScript wrote (extract/tests/fixtures/mask)', () => {
  it('has the 15 cases om_extract tests against', () => {
    expect(cases).toHaveLength(15)
  })

  it('the fixtures were written by this code: mask.ts, wkb.ts, placeLobes() and turf, by sha256 and version', () => {
    const turf = createRequire(import.meta.url)('@turf/area/package.json').version
    for (const f of cases) {
      expect(load(f).sources, f).toEqual({
        'gridMask.ts': sha(src('mask.ts')), 'wkb.ts': sha(src('wkb.ts')), 'gazetteer.ts placeLobes()': sha(lobeText(src('lobes.ts'))), turf,
      })
    }
  })

  for (const f of cases) {
    it(f.replace(/\.json\.gz$/, ''), () => {
      const exp = load(f)
      const geometry = wkbToGeoJSON(new Uint8Array(gunzip(exp.place_wkb)))
      const lobes = placeLobes({ place_id: `TEST:${exp.place}`, geometry })
      expect(lobes.map((l) => [l.id, l.bbox, l.nParts])).toEqual(exp.lobes.map((e: any) => [e.id, e.bbox, e.n_parts]))
      for (const [k, lobe] of lobes.entries()) {
        const e = exp.lobes[k]
        const m = gridMask(lobe.geojson, e.lon, e.lat, exp.opts)
        expect([m.method, m.nCandidates, m.nInside], e.id).toEqual([e.method, e.n_candidates, e.n_inside])
        expect(m.cells.length, e.id).toBe(e.cells.lon.length)
        // every row, in order, by === (no tolerance): the first difference is reported
        let bad = ''
        for (let i = 0; i < m.cells.length && !bad; i++) {
          const c = m.cells[i]
          if (!(c.lon === e.cells.lon[i] && c.lat === e.cells.lat[i] && c.weight === e.cells.weight[i]))
            bad = `row ${i}: got ${c.lon},${c.lat},${c.weight} want ${e.cells.lon[i]},${e.cells.lat[i]},${e.cells.weight[i]}`
        }
        expect(bad, e.id).toBe('')
      }
    }, 120_000)
  }
})
