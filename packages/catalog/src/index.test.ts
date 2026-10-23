import { describe, expect, it } from 'vitest'
import { PACKAGE, PROFILES } from './index.js'
import { listProfiles } from './validate.js'

describe('@oceanmetrics/catalog index', () => {
  it('exports its package name and version', () => {
    expect(PACKAGE).toEqual({ name: '@oceanmetrics/catalog', version: '0.4.0' })
  })
  it('names a schema file for every profile in PROFILES', () => {
    expect(listProfiles()).toEqual(expect.arrayContaining([...PROFILES]))
  })
})
