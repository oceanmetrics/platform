// the status words: one test per rule
import { describe, expect, it } from 'vitest'
import { METHOD_NOTES, STATUS_NOTE, STATUS_WORDS, statusCaption, TREND_WORDS } from './index.js'

describe('status words', () => {
  it('a status in words is relative to the own record, and none says no status', () => {
    expect(STATUS_WORDS).toEqual({ above: 'above its own record', within: 'within its own record', below: 'below its own record', none: 'no status' })
    expect(TREND_WORDS).toEqual({ up: 'up', flat: 'flat', down: 'down' })
  })

  it('the caption capitalises the status and adds the trend', () => {
    expect(statusCaption('within', 'flat')).toBe('Within its own record · trend flat')
    expect(statusCaption('above', 'up')).toBe('Above its own record · trend up')
    expect(statusCaption('below', null)).toBe('Below its own record')
  })

  it('no status carries no trend', () => {
    expect(statusCaption(null)).toBe('No status')
    expect(statusCaption(null, 'up')).toBe('No status')
  })

  it('one note per method, and the note never says better or worse except to deny it', () => {
    expect(Object.keys(METHOD_NOTES).sort()).toEqual(['iea-sd', 'names-pct', 'values'])
    expect(METHOD_NOTES['iea-sd']).toBe('The recent mean against the long-term mean ± 1 SD of the place’s own record (CCIEA).')
    expect(STATUS_NOTE.startsWith('Relative to its own record, not better or worse')).toBe(true)
  })
})
