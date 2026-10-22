// the STAC side of a dataset: one erddap/* Collection -> the fields a run needs (the griddap URL, the value expression,
// the template). moved from erddap-places `app/src/lib/catalog.ts`: the pure functions, unchanged; `loadDatasets` (it
// reads the gazetteer's catalog.json) and `linkMismatch` (the app's wording) stay in the app.
import type { Format } from './erddap.js'
import { pickFormat } from './erddap.js'
export interface CubeVariable {
  name       : string
  unit       : string | null
  description: string
  categorical: boolean
  /** class value -> label, for categorical variables (from `erddap-places:classes`). */
  classes   ?: Record<string, string>
}

/** the long-format columns of a tabledap table: `measurement_type` / `measurement_value`. */
export interface LongFormat { typeColumn: string; valueColumn: string }

export interface Dataset {
  id           : string           // erddap/dhw_5km
  title        : string
  baseUrl      : string
  datasetId    : string
  protocol     : 'griddap' | 'tabledap'
  /** set when the table keeps its variables in a column (tabledap, long format) */
  longFormat  ?: LongFormat
  version     ?: string
  cors         : boolean
  formats      : string[]
  lonRange     : [number, number]
  latDescending: boolean
  variables    : CubeVariable[]
  timeStep    ?: string           // e.g. P1D, P8D
  timeExtent  ?: [string | null, string | null]
  /** `erddap-places:depth`: the depth level (m) to slice on a grid with a depth axis (the surface) */
  depth       ?: number
  /** `erddap-places:status`: 'pending' when the server does not serve it yet (list it, greyed out) */
  status      ?: string
  format       : Format           // best format this server can serve us
  collection   : any              // the raw STAC Collection
}

const KELVIN = /^(k|kelvin|degree_?k(elvin)?)$/i

/**
 * The SQL expression for a variable's value, converting Kelvin to °C.
 *
 * For a long-format table the variable is not a column: the rows were already filtered to
 * `measurement_type = '<name>'` by the request, so the expression is the value column.
 */
export function valueExpr(v: CubeVariable, alias = 's', long?: LongFormat): string {
  const col = long ? `${alias}."${long.valueColumn}"` : `${alias}."${v.name}"`
  return KELVIN.test(v.unit ?? '') ? `(${col} - 273.15)` : col
}
/** the axis label for a variable, after any unit conversion. */
export function valueLabel(v: CubeVariable): string {
  if (KELVIN.test(v.unit ?? '')) return '°C'
  const u = (v.unit ?? '').trim()
  if (!u || u === '1' || u.toLowerCase() === 'none') return v.name
  if (/^(celsius|degree_?c(elsius)?)$/i.test(u)) return '°C'
  return u
}

/** the `erddap-places:categorical` flag as published in the catalog (boolean, or the string). */
export function isCategorical(v: any): boolean {
  const f = v?.['erddap-places:categorical']
  return f === true || f === 'true'
}

/** `erddap-places:long_format` -> the two column names, or undefined. */
export function toLongFormat(f: any): LongFormat | undefined {
  const t = f?.type_column, v = f?.value_column
  return t && v ? { typeColumn: String(t), valueColumn: String(v) } : undefined
}

/**
 * The SQL template a run is summarised with: point (tabledap) data rolls up by month, a flagged
 * categorical grid gets per-class fractions, everything else is the daily grid statistics.
 */
export function statsTemplate(
  v: Pick<CubeVariable, 'categorical'> | null | undefined,
  protocol: 'griddap' | 'tabledap' = 'griddap',
): 'stats_daily' | 'stats_categorical' | 'stats_tabledap' {
  if (protocol === 'tabledap') return 'stats_tabledap'
  return v?.categorical === true ? 'stats_categorical' : 'stats_daily'
}

function toVariable(name: string, v: any): CubeVariable {
  return {
    name,
    unit       : v?.unit ?? null,
    description: v?.description ?? name,
    categorical: isCategorical(v),
    classes    : v?.['erddap-places:classes'] ?? undefined,
  }
}

/** one STAC Collection -> the fields the app uses. */
export function toDataset(c: any): Dataset {
  const vars = Object.entries(c['cube:variables'] ?? {})
    .filter(([, v]: [string, any]) => (v?.type ?? 'data') === 'data')
    .map(([k, v]) => toVariable(k, v))
  const time = c['cube:dimensions']?.time ?? {}
  return {
    id           : c.id,
    title        : c.title ?? c.id,
    baseUrl      : c['erddap:base_url'],
    datasetId    : c['erddap:dataset_id'],
    protocol     : c['erddap:protocol'] === 'tabledap' ? 'tabledap' : 'griddap',
    longFormat   : toLongFormat(c['erddap-places:long_format']),
    version      : c['erddap:version'],
    cors         : c['erddap:cors'] !== false,
    formats      : c['erddap:formats'] ?? [],
    lonRange     : c['erddap:lon_range'] ?? [-180, 180],
    latDescending: c['erddap:lat_descending'] === true,
    variables    : vars,
    timeStep     : time.step,
    timeExtent   : time.extent,
    depth        : Number.isFinite(Number(c['erddap-places:depth'])) && c['erddap-places:depth'] != null
                     ? Number(c['erddap-places:depth']) : undefined,
    status       : c['erddap-places:status'] ?? undefined,
    format       : pickFormat({ erddap: { cors: c['erddap:cors'], formats: c['erddap:formats'] } }),
    collection   : c,
  }
}

/**
 * The dataset a link names. The app writes the STAC collection id (`erddap/dhw_5km`), but links written elsewhere name
 * ERDDAP's own dataset id (`dhw_5km`, `IMERG_monthly_global_precip`), and one collection id differs from its dataset id
 * in case (`erddap/imerg_monthly_global_precip`). Tried in turn, each ignoring case: the collection id, the collection
 * id with `erddap/` before it, ERDDAP's dataset id. A pending dataset is never picked; null when nothing matches.
 */
export function resolveDataset<D extends Pick<Dataset, 'id' | 'datasetId' | 'status'>>(datasets: D[], wanted: string): D | null {
  const w = String(wanted ?? '').trim().toLowerCase()
  if (!w) return null
  const live = datasets.filter((d) => d.status !== 'pending')
  const eq = (a: string | undefined, b: string) => (a ?? '').toLowerCase() === b
  return live.find((d) => d.id === wanted)
    ?? live.find((d) => eq(d.id, w))
    ?? live.find((d) => eq(d.id, `erddap/${w}`))
    ?? live.find((d) => eq(d.datasetId, w.replace(/^erddap\//, '')))
    ?? null
}

/** ERDDAP wants a lon in the dataset's own range: [-180, 180] or [0, 360]. */
export function toDatasetLon(lon: number, range: [number, number]): number {
  if (range[1] > 180 && lon < 0)  return lon + 360
  if (range[0] < 0   && lon > 180) return lon - 360
  return lon
}

/**
 * A lobe's longitude span in the dataset's own frame, [min, max], clamped to `erddap:lon_range`:
 * a lobe that runs to 180 on a grid ending at 179.75 (CMEMS 0.25°) would otherwise ask for a
 * longitude past the axis maximum, which ERDDAP refuses (404).
 */
export function lobeLonSpan(bbox: [number, number, number, number] | number[], range: [number, number]): [number, number] {
  const lo = toDatasetLon(bbox[0], range), hi = toDatasetLon(bbox[2], range)
  const clamp = (x: number) => Math.min(Math.max(x, range[0]), range[1])
  return [clamp(Math.min(lo, hi)), clamp(Math.max(lo, hi))]
}
