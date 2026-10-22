import { describe, expect, it } from 'vitest'
import { classColors, colorAt, defaultRampFor, interpolateColors, parseRamp, RAMP_IDS, RAMPS, rampHex, rampStops } from './ramps.js'

describe('the ramps as data', () => {
  it('every ramp has eleven stops of #rrggbb', () => {
    expect(RAMP_IDS.length).toBe(25)
    for (const id of RAMP_IDS) {
      expect(RAMPS[id].stops, id).toHaveLength(11)
      for (const s of RAMPS[id].stops) expect(s, id).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
  it('the families: 22 cmocean, viridis, GEBCO (oce) and Spectral (brewer)', () => {
    const n = (f: string) => RAMP_IDS.filter((id) => RAMPS[id].family === f).length
    expect([n('cmocean'), n('viridis'), n('oce'), n('brewer')]).toEqual([22, 1, 1, 1])
    expect(rampHex('gebco')[0]).toBe('#0f7cab')
  })
  it('_r reverses, an unknown id is viridis', () => {
    expect(parseRamp('thermal_r')).toEqual({ base: 'thermal', reversed: true })
    expect(parseRamp('Spectral_r')).toEqual({ base: 'spectral', reversed: true })
    expect(parseRamp('nope')).toEqual({ base: 'viridis', reversed: false })
    expect(parseRamp('constructor')).toEqual({ base: 'viridis', reversed: false })
    expect(rampHex('viridis_r')[0]).toBe('#fde725')
  })
})

describe('interpolation', () => {
  it('colorAt interpolates in RGB and clamps', () => {
    const s: [number, number, number][] = [[0, 0, 0], [100, 200, 50]]
    expect(colorAt(s, 0.5)).toEqual([50, 100, 25])
    expect(colorAt(s, -1)).toEqual([0, 0, 0])
    expect(colorAt(s, 2)).toEqual([100, 200, 50])
  })
  it('interpolateColors keeps both ends', () => {
    expect(interpolateColors(3, 'viridis')).toEqual(['#440154', '#21908c', '#fde725'])
    expect(interpolateColors(1, 'viridis')).toEqual(['#440154'])
    expect(interpolateColors(0)).toEqual([])
  })
  it('rampStops spans [min, max] in n stops; a flat range still increases', () => {
    const s = rampStops(0, 30, 'viridis', 4)
    expect(s.filter((x) => typeof x === 'number')).toEqual([0, 10, 20, 30])
    expect(s[1]).toBe('#440154')
    expect(s[7]).toBe('#fde725')
    const flat = rampStops(5, 5, 'viridis', 2)
    expect(flat[0]).toBe(5)
    expect(flat[2] as number).toBeGreaterThan(5)
  })
  it('classColors spreads the reversed Spectral over the classes, low class blue (seascapeR)', () => {
    const m = classColors([1, 2, 3])
    expect([...m.keys()]).toEqual(['1', '2', '3'])
    expect(m.get('1')).toBe('#5e4fa2')
    expect(m.get('3')).toBe('#9e0142')
  })
})

describe('defaultRampFor', () => {
  it('follows cmocean conventions; sigma_theta is a density, wind_dir is not a speed', () => {
    expect(defaultRampFor('CRW_SST')).toBe('thermal')
    expect(defaultRampFor('sigma_theta')).toBe('dense')
    expect(defaultRampFor('chlor_a')).toBe('algae')
    expect(defaultRampFor('wind_dir_deg')).toBe('viridis')
    expect(defaultRampFor('wind_speed')).toBe('speed')
    expect(defaultRampFor('anything', { anomaly: true })).toBe('balance')
  })
})
