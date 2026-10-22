// fetch with a per-attempt timeout and a retry, for requests to a server that is not ours (ERDDAP).
//
// a browser fetch has no timeout of its own: a host that accepts the connection and then stalls holds
// a run for minutes, and a dropped connection surfaces as the bare "Failed to fetch" (PacIOOS, 2026-10-09:
// a 20 s info request, then a failed map slice). here every attempt gives up after `timeoutMs`, a network
// error, a timeout or a 5xx is retried after `backoffMs`, and the last failure is an ErddapUnreachable
// whose message names the host and what happened, so the toast can say something a person can act on.
// a 4xx is the server's answer (a bad constraint) and is not retried; the caller's own abort (a newer
// run) passes straight through as the AbortError it is.

export interface RetryOpts {
  signal   ?: AbortSignal
  /** give up on one attempt after this long (ms) */
  timeoutMs?: number
  /** tries in all (1 = no retry) */
  attempts ?: number
  /** pause before each retry (ms) */
  backoffMs?: number
  /** for tests */
  fetchFn  ?: typeof fetch
  wait     ?: (ms: number) => Promise<unknown>
}

/** the last failure after every attempt: the host did not answer, or answered with a 5xx. */
export class ErddapUnreachable extends Error {
  constructor(readonly host: string, readonly reason: string, readonly attempts: number, readonly url: string) {
    super(`${host} did not answer (${reason}${attempts > 1 ? `, ${attempts} tries` : ''})`)
    this.name = 'ErddapUnreachable'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const hostOf = (url: string) => { try { return new URL(url).host } catch { return url } }

/**
 * fetch `url` and `read` the response (the default returns it unread), inside the same timeout: a
 * stall while the body downloads is a timeout too. A network error (a TypeError, the browser's
 * "Failed to fetch"), a timeout or a 5xx is retried; a 4xx goes to `read` (which may throw the
 * server's message), and whatever `read` throws for its own reasons is not retried.
 */
export async function fetchRetry<T = Response>(url: string, o: RetryOpts = {},
                                               read: (res: Response) => Promise<T> = async (r) => r as T): Promise<T> {
  const { signal, timeoutMs = 20_000, attempts = 2, backoffMs = 1_500, fetchFn = fetch, wait = sleep } = o
  let reason = ''
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await wait(backoffMs)
    if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
    const timer = AbortSignal.timeout(timeoutMs)
    const sig = signal ? AbortSignal.any([signal, timer]) : timer
    try {
      const res = await fetchFn(url, { signal: sig })
      if (res.status >= 500) { reason = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`; continue }
      return await read(res)
    } catch (e) {
      if (signal?.aborted) throw e                                    // superseded: not a failure
      if (timer.aborted) reason = `no response within ${Math.round(timeoutMs / 1000)} s`
      else if (e instanceof TypeError) reason = `network error: ${e.message}`
      else throw e                                                    // read()'s own error, e.g. a 4xx message
    }
  }
  throw new ErddapUnreachable(hostOf(url), reason, attempts, url)
}

/**
 * The toast's words when the live map step fails after the precomputed statistics are on screen:
 * which host, what happened, and that the statistics are not affected.
 */
export function mapFailMessage(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e)
  return `The map's latest time step did not load: ${why}. The precomputed statistics are unaffected; retry the map from the Time strip.`
}
