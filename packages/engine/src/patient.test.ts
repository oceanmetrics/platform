// patientFetch: every branch on a stubbed fetch, no network and no real pauses.
import { describe, expect, it } from 'vitest'
import { ErddapUnreachable } from './fetchRetry.js'
import { PatientFetchError, UNKNOWN_DATASET, isRetryable, patientFetch } from './patient.js'
import type { PatientRetry } from './patient.js'

const URL0 = 'https://erddap.oceanmetrics.io/erddap/griddap/dhw_5km.parquet?x'
const UNKNOWN = `Error {\n  code=404;\n  message=Not Found: ${UNKNOWN_DATASET}=dhw_5km\n}`
type Spec = { status: number; body: string; statusText: string }
const res = (status: number, body = '', statusText = ''): Spec => ({ status, body, statusText })
const make = ({ status, body, statusText }: Spec) => new Response(status === 204 || status === 304 ? null : body, { status, statusText })
/** a fetch that plays `script` in order: a Response or an Error to throw (the last step repeats) */
function stub(script: Array<Spec | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const step = script[Math.min(i++, script.length - 1)]
    if (step instanceof Error) throw step
    return make(step)
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}
const fast = { delayMs: 0 }

describe('patientFetch', () => {
  it('returns the first good answer without a retry', async () => {
    const s = stub([res(200, 'a')])
    const seen: PatientRetry[] = []
    const r = await patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn, onRetry: (x) => seen.push(x) })
    expect(await r.text()).toBe('a')
    expect(s.calls).toHaveLength(1)
    expect(seen).toEqual([])
  })
  it('succeeds on the third try after a 404 unknown dataset and a 503, reporting both retries', async () => {
    const s = stub([res(404, UNKNOWN, 'Not Found'), res(503, '', 'Service Unavailable'), res(200, 'c')])
    const seen: PatientRetry[] = []
    const r = await patientFetch(URL0, undefined, { delayMs: 10, fetchFn: s.fetchFn, wait: async () => {}, onRetry: (x) => seen.push(x) })
    expect(await r.text()).toBe('c')
    expect(s.calls).toHaveLength(3)
    expect(seen).toEqual([
      { attempt: 1, tries: 6, delayMs: 10, url: URL0, reason: 'HTTP 404 Not Found (unknown datasetID)', status: 404 },
      { attempt: 2, tries: 6, delayMs: 20, url: URL0, reason: 'HTTP 503 Service Unavailable', status: 503 },
    ])
  })
  it('retries a 404 "Currently unknown datasetID" but returns any other 404 at once', async () => {
    const a = stub([res(404, UNKNOWN), res(200, 'ok')])
    expect((await patientFetch(URL0, undefined, { ...fast, fetchFn: a.fetchFn })).status).toBe(200)
    expect(a.calls).toHaveLength(2)
    const b = stub([res(404, 'Not Found: your query produced no matching results'), res(200, 'ok')])
    expect((await patientFetch(URL0, undefined, { ...fast, fetchFn: b.fetchFn })).status).toBe(404)
    expect(b.calls).toHaveLength(1)
  })
  it('retries a 429', async () => {
    const s = stub([res(429), res(429), res(200, 'ok')])
    expect((await patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn })).status).toBe(200)
    expect(s.calls).toHaveLength(3)
  })
  it('retries a network error (the browser\'s "Failed to fetch")', async () => {
    const s = stub([new TypeError('Failed to fetch'), res(200, 'ok')])
    const seen: PatientRetry[] = []
    expect((await patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn, onRetry: (x) => seen.push(x) })).status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0].reason).toBe('network error: Failed to fetch')
    expect(seen[0].status).toBeUndefined()
  })
  it('returns a 400, a 403 and a 200 at once', async () => {
    for (const code of [400, 403, 200]) {
      const s = stub([res(code), res(200)])
      expect((await patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn })).status).toBe(code)
      expect(s.calls).toHaveLength(1)
    }
  })
  it('does not retry an error that is not the network (the caller\'s own)', async () => {
    const s = stub([new RangeError('boom'), res(200)])
    await expect(patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn })).rejects.toThrow('boom')
    expect(s.calls).toHaveLength(1)
  })
  it('gives up after `tries` with the host and the last status in the error', async () => {
    const s = stub([res(404, UNKNOWN, 'Not Found'), res(500), res(503, '', 'Service Unavailable')])
    const e = await patientFetch(URL0, undefined, { ...fast, tries: 3, fetchFn: s.fetchFn }).catch((x) => x)
    expect(s.calls).toHaveLength(3)
    expect(e).toBeInstanceOf(PatientFetchError)
    expect(e).toBeInstanceOf(ErddapUnreachable)
    expect(e.status).toBe(503)
    expect(e.url).toBe(URL0)
    expect(e.message).toBe('erddap.oceanmetrics.io did not answer (HTTP 503 Service Unavailable, 3 tries)')
  })
  it('gives up on a network error with no status and the cause kept', async () => {
    const s = stub([new TypeError('Failed to fetch')])
    const e = await patientFetch(URL0, undefined, { ...fast, tries: 2, fetchFn: s.fetchFn }).catch((x) => x)
    expect(s.calls).toHaveLength(2)
    expect(e.message).toBe('erddap.oceanmetrics.io did not answer (network error: Failed to fetch, 2 tries)')
    expect(e.status).toBeUndefined()
    expect(e.cause).toBeInstanceOf(TypeError)
  })
  it('six tries by default', async () => {
    const s = stub([res(503)])
    await expect(patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn })).rejects.toThrow('6 tries')
    expect(s.calls).toHaveLength(6)
  })
  it('tries: 1 is no retry', async () => {
    const s = stub([res(503), res(200)])
    await expect(patientFetch(URL0, undefined, { ...fast, tries: 1, fetchFn: s.fetchFn })).rejects.toThrow('did not answer (HTTP 503)')
    expect(s.calls).toHaveLength(1)
  })
  it('backs off by the try and caps the pause', async () => {
    const s = stub([res(503)])
    const waits: number[] = []
    await patientFetch(URL0, undefined, { delayMs: 1_000, maxDelayMs: 2_500, tries: 5, fetchFn: s.fetchFn, wait: async (ms) => { waits.push(ms) } }).catch(() => {})
    expect(waits).toEqual([1_000, 2_000, 2_500, 2_500])
  })
  it('passes the init to every try', async () => {
    const s = stub([res(503), res(200)])
    const init = { headers: { accept: 'text/csv' } }
    await patientFetch(URL0, init, { ...fast, fetchFn: s.fetchFn })
    expect(s.calls.map((c) => c.init)).toEqual([init, init])
  })
  it('an abort before the first try throws the abort reason and asks nothing', async () => {
    const s = stub([res(200)])
    const c = new AbortController()
    c.abort(new Error('gone'))
    await expect(patientFetch(URL0, { signal: c.signal }, { ...fast, fetchFn: s.fetchFn })).rejects.toThrow('gone')
    expect(s.calls).toHaveLength(0)
  })
  it('an abort during a pause stops at once, even a long one', async () => {
    const s = stub([res(503)])
    const c = new AbortController()
    const t0 = Date.now()
    const p = patientFetch(URL0, { signal: c.signal }, { delayMs: 60_000, maxDelayMs: 60_000, fetchFn: s.fetchFn, onRetry: () => queueMicrotask(() => c.abort(new Error('newer run'))) })
    await expect(p).rejects.toThrow('newer run')
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(s.calls).toHaveLength(1)
  })
  it('an abort during a request passes straight through, not retried', async () => {
    const c = new AbortController()
    let n = 0
    const fetchFn = (async () => { n++; c.abort(); throw new DOMException('aborted', 'AbortError') }) as unknown as typeof fetch
    const e = await patientFetch(URL0, { signal: c.signal }, { ...fast, fetchFn }).catch((x) => x)
    expect(e.name).toBe('AbortError')
    expect(n).toBe(1)
  })
  it('retryOn replaces the rule', async () => {
    const s = stub([res(418), res(200)])
    const r = await patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn, retryOn: (x) => x.status === 418 })
    expect(r.status).toBe(200)
    expect(s.calls).toHaveLength(2)
    const t = stub([res(503), res(200)])
    expect((await patientFetch(URL0, undefined, { ...fast, fetchFn: t.fetchFn, retryOn: () => false })).status).toBe(503)
  })
  it('the answer it returns still has its body (the check reads a clone)', async () => {
    const s = stub([res(404, 'no such thing here')])
    expect(await (await patientFetch(URL0, undefined, { ...fast, fetchFn: s.fetchFn })).text()).toBe('no such thing here')
  })
})

describe('isRetryable', () => {
  const yes = (...a: Parameters<typeof res>) => isRetryable(make(res(...a)))
  it('429 and 5xx yes; other 4xx, 3xx and 2xx no; 404 only with the unknown-dataset body', async () => {
    for (const code of [429, 500, 503, 599]) expect(await yes(code)).toBe(true)
    for (const code of [200, 204, 304, 400, 401, 403, 416]) expect(await yes(code)).toBe(false)
    expect(await yes(404, UNKNOWN)).toBe(true)
    expect(await yes(404, 'Not Found')).toBe(false)
    expect(await yes(404)).toBe(false)
  })
})
