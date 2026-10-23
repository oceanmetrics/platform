// the status words a caption or a card shows: one wording for every app (moved from the indicators viewer's
// matrix.ts, place.ts and credits.ts, and the places page's indicators.ts). statistical, relative to the place's own
// record, never better or worse.
import type { MethodId, Status, Trend } from './types.js'

/** a status in words, and 'none' for a status rule that gave none */
export const STATUS_WORDS: Record<Status | 'none', string> = {
  above : 'above its own record',
  within: 'within its own record',
  below : 'below its own record',
  none  : 'no status',
}

export const TREND_WORDS: Record<Trend, string> = { up: 'up', flat: 'flat', down: 'down' }

/** what every status is relative to, said once beside a status */
export const STATUS_NOTE = 'Relative to its own record, not better or worse: the place’s recent years against its own earlier years.'

/** each status method in one sentence */
export const METHOD_NOTES: Record<MethodId, string> = {
  'iea-sd'   : 'The recent mean against the long-term mean ± 1 SD of the place’s own record (CCIEA).',
  'names-pct': 'The recent mean against the 10th and 90th percentiles of the place’s own record (NaMES).',
  values     : 'The values as they are, with no status.',
}

/** a status and its trend as one caption: "Within its own record · trend flat"; "No status" when there is none */
export function statusCaption(status: Status | null, trend?: Trend | null): string {
  const w = STATUS_WORDS[status ?? 'none']
  return `${w[0].toUpperCase()}${w.slice(1)}${status && trend ? ` · trend ${TREND_WORDS[trend]}` : ''}`
}
