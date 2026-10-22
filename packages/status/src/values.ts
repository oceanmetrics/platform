// values: the series shown as it is, with no status or trend (OBIS by decade, an SDG latest-year value, anything
// whose record cannot carry a statistical status).
import { noStatus } from './ieaSd.js'
import type { Point, StatusOptions, StatusResult } from './types.js'

export function values(series: Point[], _opts: StatusOptions): StatusResult {
  return noStatus('values', [...series].sort((a, b) => a.t.localeCompare(b.t)), 'shown as values, with no status')
}
