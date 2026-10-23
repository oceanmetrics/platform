import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs script of the repo, shared with `npm run size`
import { H3_WORKER_BUDGET, measureH3Worker } from '../../../scripts/h3-worker-size.mjs'

describe('the h3 worker chunk (bundled with its dependencies, minified, gzip -9)', () => {
  it('stays in its budget: the h3j and h3r protocols, h3-js, geojson-vt, vt-pbf, pmtiles, hyparquet and fzstd in one chunk', async () => {
    const w = (await measureH3Worker()) as { chunks: number; gzip: number }
    expect(w.chunks).toBe(1)
    expect(w.gzip).toBeLessThanOrEqual(H3_WORKER_BUDGET)
    // the release provider is in it: more than the 0.2.3 chunk (76,808 B), which had no Parquet reader
    expect(w.gzip).toBeGreaterThan(90_000)
  }, 30_000)
})
