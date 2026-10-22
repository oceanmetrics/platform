// fetchRetry: a per-attempt timeout, a retry on a network error / timeout / 5xx, no retry on a 4xx or
// on the caller's own abort, and an error that names the host. fetch is a stub: no network.
import { describe, expect, it } from 'vitest'
import { ErddapUnreachable, fetchRetry, hostOf, mapFailMessage } from './fetchRetry.js'
// erddap-places runToken.ts isAbort(), inlined (the run token stays in the app)
const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))

const URL0 = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.json?latitude'
const ok   = (body = 'ok', status = 200) => new Response(body, { status })
const noWait = async () => {}
/** a fetch that plays `script` in order: a Response, an Error to throw, or 'hang' (waits for the signal). */
function stub(script: Array<Response | Error | 'hang'>) {
  const calls: string[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(url)
    const step = script.shift()
    if (step === 'hang') return new Promise((_, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason)))
    if (step instanceof Error) throw step
    return step!
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}

describe('fetchRetry', () => {
  it('returns the first good answer', async () => {
    const s = stub([ok('a')])
    expect(await (await fetchRetry(URL0, { fetchFn: s.fetchFn })).text()).toBe('a')
    expect(s.calls).toHaveLength(1)
  })
  it('retries the browser\'s "Failed to fetch" (a TypeError) and a 5xx', async () => {
    const s = stub([new TypeError('Failed to fetch'), ok('', 503), ok('b')])
    const res = await fetchRetry(URL0, { fetchFn: s.fetchFn, wait: noWait, attempts: 3 })
    expect(await res.text()).toBe('b')
    expect(s.calls).toHaveLength(3)
  })
  it('gives up after the attempts with the host and the reason', async () => {
    const s = stub([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')])
    const e = await fetchRetry(URL0, { fetchFn: s.fetchFn, wait: noWait }).catch((x) => x)
    expect(e).toBeInstanceOf(ErddapUnreachable)
    expect(e.message).toBe('pae-paha.pacioos.hawaii.edu did not answer (network error: Failed to fetch, 2 tries)')
    expect(isAbort(e)).toBe(false)              // reported, never swallowed as a superseded run
  })
  it('times out a stalled attempt and says so', async () => {
    const s = stub(['hang', 'hang'])
    const e = await fetchRetry(URL0, { fetchFn: s.fetchFn, wait: noWait, timeoutMs: 20 }).catch((x) => x)
    expect(e.message).toBe('pae-paha.pacioos.hawaii.edu did not answer (no response within 0 s, 2 tries)')
    expect(isAbort(e)).toBe(false)
  })
  it('a stall while the body is read is a timeout too: retried, not swallowed as an abort', async () => {
    const s = stub([ok('x'), ok('y')])
    let n = 0
    const out = await fetchRetry(URL0, { fetchFn: s.fetchFn, wait: noWait, timeoutMs: 1 }, async (r) => {
      if (n++ === 0) {                          // the first body stalls past the 1 ms timer, then fails as a timed-out read does
        await new Promise((ok) => setTimeout(ok, 10))
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      }
      return r.text()
    })
    expect(out).toBe('y')
    expect(s.calls).toHaveLength(2)
  })
  it('does not retry a 4xx: read() gets it and its error passes through', async () => {
    const s = stub([ok('Error: "Start" is greater than the axis maximum', 404), ok('never')])
    const e = await fetchRetry(URL0, { fetchFn: s.fetchFn, wait: noWait }, async (r) => {
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
      return r
    }).catch((x) => x)
    expect(e.message).toBe('404: Error: "Start" is greater than the axis maximum')
    expect(s.calls).toHaveLength(1)
  })
  it('the caller\'s abort passes through at once, as an abort', async () => {
    const s = stub(['hang', ok()])
    const ctrl = new AbortController()
    const p = fetchRetry(URL0, { fetchFn: s.fetchFn, wait: noWait, signal: ctrl.signal })
    ctrl.abort(new DOMException('aborted', 'AbortError'))
    const e = await p.catch((x) => x)
    expect(isAbort(e)).toBe(true)
    expect(s.calls).toHaveLength(1)
  })
  it('hostOf and the map message', () => {
    expect(hostOf(URL0)).toBe('pae-paha.pacioos.hawaii.edu')
    expect(hostOf('not a url')).toBe('not a url')
    expect(mapFailMessage(new ErddapUnreachable('pae-paha.pacioos.hawaii.edu', 'no response within 20 s', 2, URL0)))
      .toBe("The map's latest time step did not load: pae-paha.pacioos.hawaii.edu did not answer (no response within 20 s, 2 tries). " +
            'The precomputed statistics are unaffected; retry the map from the Time strip.')
  })
})
