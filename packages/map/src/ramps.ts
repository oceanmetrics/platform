// colour ramps as data: a typed port of CalCOFI explore `src/ramps.ts` (eleven stops each, interpolated in RGB) plus
// erddap-places' class palette. cmocean 0.3.2 (Thyng et al. 2016, MIT) via the R package; viridis from viridisLite;
// GEBCO from oce::oceColorsGebco(); ColorBrewer Spectral (Cynthia Brewer, Apache 2.0) for classes, as seascapeR draws
// them. A ramp id ending in "_r" is the same ramp reversed; an unknown id is viridis. The same ramp colours a grid slice,
// a COG and the hexagons, so a layer looks the same whichever provider draws it.

export type RampFamily = 'cmocean' | 'viridis' | 'oce' | 'brewer'
export type RampKind = 'sequential' | 'diverging' | 'cyclic'
export interface Ramp { label: string; family: RampFamily; kind: RampKind; stops: string[] }
export type Rgb = [number, number, number]

const c = (label: string, kind: RampKind, s: string): Ramp => ({ label, family: 'cmocean', kind, stops: s.split(',') })

export const RAMPS: Readonly<Record<string, Ramp>> = {
  viridis: { label: 'viridis', family: 'viridis', kind: 'sequential', stops: '#440154,#482576,#414487,#35608D,#2A788E,#21908C,#22A884,#43BF71,#7AD151,#BBDF27,#FDE725'.split(',') },
  thermal: c('thermal', 'sequential', '#042333,#0F326B,#40349F,#684396,#8B538D,#B05F82,#D66C6B,#F2814D,#FCA63C,#F7CF45,#E8FA5B'),
  haline: c('haline', 'sequential', '#2A186C,#2828A2,#0D4E96,#18668C,#2D7C89,#3B9287,#4AAA81,#64C072,#94D35D,#CFE06C,#FDEF9A'),
  solar: c('solar', 'sequential', '#331418,#531E22,#732724,#8F341E,#A54A17,#B66313,#C47F15,#CF9B1D,#D8BA2A,#DEDA39,#E1FD4B'),
  ice: c('ice', 'sequential', '#040613,#1B1B37,#302F5F,#3D4389,#3E5EA9,#427AB7,#5296C1,#6AB0CB,#8CCBD6,#BBE3E6,#EAFDFD'),
  gray: c('gray', 'sequential', '#000000,#131212,#2B2B2B,#424241,#5A5959,#717070,#8A8989,#A3A3A2,#C0BFBE,#DDDDDC,#FFFFFD'),
  oxy: c('oxy', 'sequential', '#400505,#6A060F,#504F4F,#676666,#81807F,#9A9A99,#B7B7B6,#D4D4D3,#F8FE69,#E7D72C,#DDAF19'),
  deep: c('deep', 'sequential', '#FDFECC,#C9EAB1,#92D8A4,#65C2A4,#52A8A3,#488E9E,#407498,#3E5A92,#41407B,#382D51,#281A2C'),
  dense: c('dense', 'sequential', '#E6F1F1,#BBDBE5,#96C5E2,#7BACE4,#7390E3,#7771D5,#7953BA,#743A98,#682471,#531547,#360E24'),
  algae: c('algae', 'sequential', '#D7F9D0,#B7E2AB,#96CD8A,#71BA6B,#44A855,#129450,#097C4A,#156641,#1A5034,#183A25,#122414'),
  matter: c('matter', 'sequential', '#FEEDB0,#FAC98F,#F5A773,#EE835D,#E26253,#CE4356,#B22D5F,#932063,#721A60,#501652,#2F0F3E'),
  turbid: c('turbid', 'sequential', '#E9F6AB,#DBD886,#CFBC66,#C3A04D,#B58740,#A1703B,#895D3A,#704D37,#563E30,#3B2F27,#221F1B'),
  speed: c('speed', 'sequential', '#FFFDCD,#EDDE97,#D8C55F,#B7B12D,#8EA20B,#60920B,#317F1F,#0F6B2B,#10542C,#193B23,#172313'),
  amp: c('amp', 'sequential', '#F1EDEC,#E5CEC8,#DCB1A3,#D3947E,#CA775B,#C0583B,#B23726,#9D1926,#7F0E29,#5C0E21,#3C0912'),
  tempo: c('tempo', 'sequential', '#FFF6F4,#DBDECF,#B6CBAF,#8BB896,#5DA786,#2B937F,#117C79,#18656E,#1C4D61,#1A3651,#151D44'),
  rain: c('rain', 'sequential', '#EEEDF3,#DDD2C8,#CBBA98,#9FAC82,#739D75,#3E8E6E,#0B7A6E,#07636B,#1E4B5F,#25334B,#221B38'),
  phase: c('phase', 'cyclic', '#A8780D,#C85D37,#DC3C6D,#D826BA,#B64BED,#7E71F0,#3A8CCA,#169596,#199A5E,#708F15,#A8780D'),
  topo: c('topo', 'diverging', '#281A2C,#41407B,#407598,#51A8A3,#92D8A4,#83916F,#27511E,#6C703C,#B3913F,#D7C289,#F9FDE4'),
  balance: c('balance', 'diverging', '#181C43,#293E98,#1670BC,#5A9CBB,#AAC2CB,#F1ECEB,#DBB1A3,#CA775B,#B33826,#7F0E29,#3C0912'),
  delta: c('delta', 'diverging', '#112040,#234397,#2378A3,#4EA8AF,#ACCEC6,#FEFCD9,#D8C55F,#8EA20B,#32801E,#10542C,#172313'),
  curl: c('curl', 'diverging', '#151D44,#1C4D61,#117D79,#5DA786,#B6CBAF,#FEF6F4,#E6B7A2,#D4776A,#AE4060,#76195D,#340D35'),
  diff: c('diff', 'diverging', '#082340,#224E6A,#5A7487,#8E9DA8,#C6CACF,#F6F1F0,#CDC6B7,#A19679,#7A6D41,#4C471C,#1C2207'),
  tarn: c('tarn', 'diverging', '#17230E,#3D4D0D,#846A25,#CB854A,#E3BFA3,#FCF7F6,#CACBA9,#7DA490,#2E7E7E,#15506A,#101E4F'),
  gebco: { label: 'GEBCO', family: 'oce', kind: 'sequential', stops: '#0F7CAB,#1F8FB4,#33A2BC,#48B4C6,#5DC5CF,#75D5D9,#8EE2E0,#A9EBE6,#C5F4EE,#E3FCF7,#F5FEFC'.split(',') },
  spectral: { label: 'Spectral', family: 'brewer', kind: 'diverging', stops: '#9e0142,#d53e4f,#f46d43,#fdae61,#fee08b,#ffffbf,#e6f598,#abdda4,#66c2a5,#3288bd,#5e4fa2'.split(',') },
}
export const RAMP_IDS = Object.keys(RAMPS)
export const DEFAULT_RAMP = 'viridis'
/** the class palette: ColorBrewer Spectral reversed, as seascapeR (erddap-places palette.ts) */
export const CLASS_RAMP = 'spectral_r'
/** the colour of a value no class names */
export const UNKNOWN_CLASS_COLOR = '#cccccc'

/** base id + reversed flag from a ramp id (`thermal`, `thermal_r`); an unknown id is viridis */
export function parseRamp(id: string | null | undefined): { base: string; reversed: boolean } {
  const s = (id ?? DEFAULT_RAMP).toLowerCase()
  const rev = s.endsWith('_r')
  const base = rev ? s.slice(0, -2) : s
  return Object.hasOwn(RAMPS, base) ? { base, reversed: rev } : { base: DEFAULT_RAMP, reversed: false }
}

const rgbOf = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const hexOf = (c: readonly number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** the ramp's stops, low to high, as hex (`#rrggbb`, lowercase) */
export function rampHex(id: string | null | undefined): string[] {
  const { base, reversed } = parseRamp(id)
  const s = RAMPS[base].stops.map((x) => x.toLowerCase())
  return reversed ? s.reverse() : s
}

/** the ramp's stops, low to high, as rgb triplets */
export const rampColors = (id: string | null | undefined): Rgb[] => rampHex(id).map(rgbOf)

/** a CSS gradient of the ramp, left to right */
export const rampCss = (id: string | null | undefined) => `linear-gradient(90deg, ${rampHex(id).join(', ')})`

/** the colour at t in [0, 1] along the ramp's stops (clamped), interpolated in RGB as MapLibre does */
export function colorAt(stops: readonly Rgb[], t: number): Rgb {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1)
  const k = Math.min(Math.floor(u), stops.length - 2)
  if (k < 0) return [...stops[0]] as Rgb
  const f = u - k, a = stops[k], b = stops[k + 1]
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)]
}

/** `n` colours spread evenly along a ramp's stops, as hex (erddap-places `ramp()`) */
export function interpolateColors(n: number, id: string | null | undefined = DEFAULT_RAMP): string[] {
  if (n <= 0) return []
  const s = rampColors(id)
  if (n === 1) return [hexOf(s[0])]
  return Array.from({ length: n }, (_, i) => hexOf(colorAt(s, i / (n - 1))))
}

/**
 * `[value, colour, value, colour, ...]` stops spanning [min, max], for a MapLibre `['interpolate', ['linear'], v, ...stops]`.
 * a flat range (every cell the same value) still gets increasing stops, so the expression stays valid (erddap-places
 * `rampStops`).
 */
export function rampStops(min: number, max: number, id: string | null | undefined = DEFAULT_RAMP, n = 7): (number | string)[] {
  const cols = interpolateColors(Math.max(2, n), id)
  const hi = max > min ? max : min + 1e-9
  return cols.flatMap((col, i) => [min + ((hi - min) * i) / (cols.length - 1), col])
}

/** one colour per class value, in the given (sorted) order, along the class ramp */
export function classColors(values: readonly (string | number)[], id: string = CLASS_RAMP): Map<string, string> {
  const cols = interpolateColors(values.length, id)
  return new Map(values.map((v, i) => [String(v), cols[i]]))
}

/** cmocean's conventions by variable name, when nothing names a ramp (explore `defaultRamp`, without CalCOFI's realms) */
export function defaultRampFor(variable: string, opts: { anomaly?: boolean; units?: string | null } = {}): string {
  if (opts.anomaly) return 'balance'
  const v = variable.toLowerCase()
  // density before temperature: sigma_theta contains "theta" (explore WS-R2 parity check, 2026-09-16)
  if (/sigma|dens/.test(v)) return 'dense'
  if (/temp|theta|sst/.test(v)) return 'thermal'
  if (/salin|salt|sss/.test(v)) return 'haline'
  if (/oxy/.test(v)) return 'ice'
  if (/chl|fluor|phyto|algae/.test(v)) return 'algae'
  if (/nitr|phos|silic|ammon|nutri/.test(v)) return 'tempo'
  if (/par\b|light|irrad|rad/.test(v)) return 'solar'
  if (/ph\b|alkal|dic|carbon|pco2/.test(v)) return 'matter'
  if (/depth|bathy|elev/.test(v) || opts.units === 'm') return 'deep'
  // a direction is not a speed (explore: wind_dir_deg drew the speed ramp)
  if (/wind|speed|current/.test(v) && !/dir/.test(v)) return 'speed'
  return DEFAULT_RAMP
}
