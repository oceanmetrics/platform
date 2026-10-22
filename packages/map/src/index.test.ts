import { describe, expect, it } from 'vitest'
import * as map from './index.js'

describe('@oceanmetrics/map', () => {
  it('exports its package name and version', () => {
    expect(map.PACKAGE).toEqual({ name: '@oceanmetrics/map', version: '0.2.0' })
  })
  it('the index carries the slot contract, the setup, the basemap and the three providers', () => {
    for (const k of ['parseLayerKey', 'slotBeforeId', 'setupMapLibre', 'composeStyle', 'rampStops', 'gridSlot', 'cogSlot', 'h3Slot', 'buildH3jArchive']) {
      expect(typeof (map as Record<string, unknown>)[k], k).toBe('function')
    }
  })
})
