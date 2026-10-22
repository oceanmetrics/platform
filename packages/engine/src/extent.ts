// live time extent of an ERDDAP grid dataset, from `<base>/erddap/info/<datasetID>/index.json`.
//
// the STAC `cube:dimensions.time.extent` end is null (or stale) for near-real-time grids, and every
// dataset ends at a different instant: AOML Seascapes is an 8-day product months behind, CRW is a
// couple of days behind. asking the server means the default window always lands inside the data,
// instead of 404ing with `"Start" is greater than the axis maximum=…`.
//
// the parsing and clamping here are pure functions (see extent.test.ts); only fetchTimeExtent()
// touches the network.
import { fetchRetry, type RetryOpts } from './fetchRetry.js'

export interface TimeExtent {
  start     : string          // ISO instant of the first time step, e.g. 2002-08-29T12:00:00Z
  end       : string          // ISO instant of the last time step
  stepDays ?: number          // average spacing in days (1 for daily, 8 for the 8-day product)
  stepLabel?: string          // 'daily', '8-day', 'monthly', …
  nValues  ?: number
}

export interface InfoTable { table: { columnNames: string[]; rows: unknown[][] } }

const isoZ = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
/** the UTC calendar day (yyyy-mm-dd) of an ISO instant. */
export const day = (iso: string) => iso.slice(0, 10)
const dayMs = 864e5
/** yyyy-mm-dd, n days after `d` (n may be negative). */
export function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${day(d)}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10)
}
/** whole days from `a` to `b`, by UTC calendar day. */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / dayMs)

/** `8 days 0h 7m 57s` / `1 day` / `12h` -> days. */
export function parseSpacing(s: string): number | undefined {
  const m = s.match(/([\d.]+)\s*days?/i)
  let days = m ? Number(m[1]) : 0
  const h = s.match(/(\d+)\s*h\b/), mn = s.match(/(\d+)\s*m\b/), sec = s.match(/(\d+)\s*s\b/)
  days += (h ? Number(h[1]) / 24 : 0) + (mn ? Number(mn[1]) / 1440 : 0) + (sec ? Number(sec[1]) / 86400 : 0)
  return days > 0 ? days : undefined
}

/** a human label for a time step in days. */
export function stepLabel(days: number | undefined): string | undefined {
  if (!days || !Number.isFinite(days)) return undefined
  const d = Math.round(days)
  if (days < 1)  return 'sub-daily'
  if (d === 1)   return 'daily'
  if (d === 7)   return 'weekly'
  if (d >= 28 && d <= 31) return 'monthly'
  if (d >= 360 && d <= 366) return 'annual'
  return `${d}-day`
}

/** the ERDDAP `info/<id>/index.json` table -> the dataset's live time extent. */
export function parseInfoExtent(info: InfoTable, axis = 'time'): TimeExtent | null {
  const rows = (info?.table?.rows ?? []).map((r) => r.map((c) => (c == null ? '' : String(c))))
  const find = (type: string, varName: string, attr: string) =>
    rows.find((r) => r[0] === type && r[1] === varName && r[2] === attr)?.[4]

  let start: string | undefined, end: string | undefined
  const range = find('attribute', axis, 'actual_range')
  if (range) {
    const [a, b] = range.split(',').map((x) => Number(x.trim()))
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      start = isoZ(lo); end = isoZ(hi)
    }
  }
  // fall back to the NC_GLOBAL coverage attributes (already ISO strings)
  start ??= find('attribute', 'NC_GLOBAL', 'time_coverage_start')
  end   ??= find('attribute', 'NC_GLOBAL', 'time_coverage_end')
  if (!start || !end) return null

  const dim   = rows.find((r) => r[0] === 'dimension' && r[1] === axis)?.[4] ?? ''
  const step  = parseSpacing((dim.match(/averageSpacing=([^,]+)/)?.[1] ?? '').trim())
  const nVals = Number(dim.match(/nValues=(\d+)/)?.[1])
  return {
    start, end,
    stepDays : step,
    stepLabel: stepLabel(step),
    nValues  : Number.isFinite(nVals) ? nVals : undefined,
  }
}

// ── the date window ───────────────────────────────────────────────────────────
export interface Window { start: string; end: string }   // yyyy-mm-dd, UTC calendar days
export interface ClampResult extends Window { snapped: boolean; reason?: string }

export interface WindowOpts {
  days    ?: number   // the default span for a daily dataset
  minSteps?: number   // at least this many time steps for a coarser dataset
  maxDays ?: number   // never span more than this
}

/** how many days a default window should span for a dataset of this step. */
export function spanDays(ext: TimeExtent | null, o: WindowOpts = {}): number {
  const { days = 30, minSteps = 8, maxDays = 90 } = o
  const step = ext?.stepDays ?? 1
  return Math.min(maxDays, Math.max(days, step > 1 ? Math.ceil(minSteps * step) : days))
}

/** the last `days` (or `minSteps` steps) ending at the dataset's last time step. */
export function defaultWindow(ext: TimeExtent | null, o: WindowOpts = {}): Window {
  const end = ext ? day(ext.end) : addDays(new Date().toISOString(), -2)
  const span = spanDays(ext, o)
  let start = addDays(end, -(span - 1))
  if (ext && daysBetween(ext.start, start) < 0) start = day(ext.start)
  return { start, end }
}

/**
 * Keep a user's window inside the dataset's extent.
 * A start after the last time step (or an end before the first) snaps the whole window back to the
 * default one, with a `reason` for the status line, so nothing out-of-range is ever requested.
 */
export function clampWindow(w: Window, ext: TimeExtent | null, o: WindowOpts = {}): ClampResult {
  if (!ext) return { ...w, snapped: false }
  const lo = day(ext.start), hi = day(ext.end)
  if (daysBetween(w.start, hi) < 0 || daysBetween(lo, w.end) < 0) {
    const d = defaultWindow(ext, o)
    const why = daysBetween(w.start, hi) < 0
      ? `the requested window starts after this dataset ends (${hi})`
      : `the requested window ends before this dataset starts (${lo})`
    return { ...d, snapped: true, reason: `${why}; showing ${d.start} to ${d.end} instead` }
  }
  const start = daysBetween(lo, w.start) < 0 ? lo : w.start
  const end   = daysBetween(w.end, hi)   < 0 ? hi : w.end
  const snapped = start !== w.start || end !== w.end
  return {
    start, end, snapped,
    reason: snapped ? `clamped to the dataset extent (${lo} to ${hi})` : undefined,
  }
}

/**
 * The ISO instant to put in a griddap time constraint for a calendar day. The extent's own endpoints
 * are used verbatim, so a request never overshoots an axis whose steps are not at 12:00Z (MUR sits
 * at 09:00Z); any interior day falls back to noon.
 */
export function timeInstant(date: string, ext: TimeExtent | null, noon: (d: string) => string): string {
  if (ext) {
    if (day(date) === day(ext.end))   return ext.end
    if (day(date) === day(ext.start)) return ext.start
  }
  return noon(date)
}

// ── fetch ─────────────────────────────────────────────────────────────────────
const cache = new Map<string, Promise<TimeExtent | null>>()
const stripSlash = (s: string) => s.replace(/\/+$/, '')

/**
 * `<base>/info/<datasetID>/index.json` -> the live extent, memoised per base+dataset. The fetch is
 * shared by every caller, so no caller's signal is passed to it (a superseded run must not cancel it
 * for the next one); fetchRetry bounds it instead (`INFO_TIMEOUT_MS` per attempt, one retry). null on failure,
 * and a failure is forgotten, so the next call asks again.
 */
/** per-attempt timeout of the info request (PacIOOS took 4–9 s on 2026-10-20, and 20 s on 2026-10-09) */
export const INFO_TIMEOUT_MS = 30_000

export function fetchTimeExtent(base: string, datasetId: string, axis = 'time', retry: Omit<RetryOpts, 'signal'> = {}): Promise<TimeExtent | null> {
  const url = `${stripSlash(base)}/info/${datasetId}/index.json`
  const hit = cache.get(url)
  if (hit) return hit
  const p = fetchRetry(url, { timeoutMs: INFO_TIMEOUT_MS, ...retry }, async (res) => {
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
    return parseInfoExtent(await res.json(), axis)
  }).catch((e) => { cache.delete(url); console.warn('extent:', e); return null })
  cache.set(url, p)
  return p
}
