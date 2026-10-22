import { describe, expect, it } from 'vitest'
import { PACKAGE } from './index.js'

describe('@oceanmetrics/map scaffold', () => {
  it('exports its package name and version', () => {
    expect(PACKAGE).toEqual({ name: '@oceanmetrics/map', version: '0.1.0' })
  })
})
