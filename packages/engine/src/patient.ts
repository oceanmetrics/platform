// patientFetch: ask each ERDDAP request again, on its own, when the server drops it.
//
// the mirror erddap.oceanmetrics.io answers the same url 404 ("Currently unknown datasetID", one backend does not hold the
// dataset yet) and 200 by turns under load (seen 2026-10-23), and any ERDDAP can answer 429 or a 5xx. retrying each request
// beats retrying the whole slice: with half the answers dropped, six tries of one request fail one time in 64. this is the
// one implementation of that rule (the places page and the indicators viewer carried a copy each). fetchRetry stays as it
// is (a timeout per attempt, a short retry for the engine's own requests); this composes with it by naming the failure the
// same way: the last failure is an ErddapUnreachable (a PatientFetchError, which also carries the status), so the toast
// says "host did not answer (HTTP 503 Service Unavailable, 6 tries)" for both.
//
// retried: a network error (the browser's TypeError "Failed to fetch"), a 404 whose body says "Currently unknown datasetID",
// a 429 and a 5xx. every other answer, a 4xx included, is returned at once for the caller to read. the caller's own abort
// (`init.signal`) stops it at once, between tries too, as the AbortError it is.
import { ErddapUnreachable, hostOf } from './fetchRetry.js'

/** the body text ERDDAP sends with a 404 when the dataset is not (yet) on the server that answered */
export const UNKNOWN_DATASET = 'Currently unknown datasetID'

/** one retry about to happen: reported through `onRetry` */
export interface PatientRetry {
  /** the try that just failed (1 = the first) */
  attempt : number
  /** tries in all */
  tries   : number
  /** the pause before the next try (ms) */
  delayMs : number
  url     : string
  /** why: "HTTP 503 Service Unavailable", "HTTP 404 (unknown datasetID)" or "network error: Failed to fetch" */
  reason  : string
  /** the status that failed the try; absent for a network error */
  status ?: number
}

export interface PatientOpts {
  /** tries in all (1 = no retry) */
  tries    ?: number
  /** the pause before the second try (ms); before try n + 1 it is `delayMs * n`, up to `maxDelayMs`. 0 = no pause */
  delayMs  ?: number
  /** the longest pause (ms) */
  maxDelayMs?: number
  /** called before each pause */
  onRetry  ?: (r: PatientRetry) => void
  /** whether an answer is to be asked for again; the default is `isRetryable`. It replaces the default, so a caller who
   *  wants more can call `isRetryable(res)` itself. It reads `res.clone()` if it needs the body; the caller still gets `res` */
  retryOn  ?: (res: Response) => boolean | Promise<boolean>
  /** for tests */
  fetchFn  ?: typeof fetch
  wait     ?: (ms: number, signal?: AbortSignal) => Promise<unknown>
}

/** the last failure after every try: an ErddapUnreachable that also says which status it was (absent: a network error) */
export class PatientFetchError extends ErddapUnreachable {
  constructor(host: string, reason: string, attempts: number, url: string, readonly status?: number, options?: { cause?: unknown }) {
    super(host, reason, attempts, url)
    this.name = 'PatientFetchError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/**
 * the default rule: a 429 or a 5xx, and a 404 whose body is ERDDAP's "Currently unknown datasetID". Any other 404 is a real
 * answer (a wrong dataset id, a coordinate out of range) and is not asked for again. The body is read from a clone.
 */
export async function isRetryable(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status >= 500) return true
  if (res.status !== 404) return false
  try { return (await res.clone().text()).includes(UNKNOWN_DATASET) } catch { return false }
}

const abortReason = (signal: AbortSignal) => signal.reason ?? new DOMException('aborted', 'AbortError')

/** a pause that an abort cuts short (rejecting with the abort reason) */
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortReason(signal))
  const done = () => { clearTimeout(t); signal?.removeEventListener('abort', onAbort) }
  const onAbort = () => { done(); reject(abortReason(signal!)) }
  const t = setTimeout(() => { done(); resolve() }, ms)
  signal?.addEventListener('abort', onAbort, { once: true })
})

/**
 * fetch `url`, asking again when the server drops the request (see the top of this file). Returns the first answer that is
 * not to be retried (a 2xx, or a 4xx that is the server's own); throws a PatientFetchError after `tries` failed tries.
 * `init.signal` aborts it at once, between tries too.
 */
export async function patientFetch(url: string | URL, init?: RequestInit, opts: PatientOpts = {}): Promise<Response> {
  const { tries = 6, delayMs = 300, maxDelayMs = 4_000, onRetry, retryOn = isRetryable, fetchFn = fetch, wait = sleep } = opts
  const signal = init?.signal ?? undefined
  const href = String(url)
  let reason = ''
  let status: number | undefined
  let cause: unknown
  for (let i = 1; i <= Math.max(1, tries); i++) {
    if (signal?.aborted) throw abortReason(signal)
    status = undefined
    cause = undefined
    try {
      const res = await fetchFn(href, init)
      if (!(await retryOn(res))) return res
      status = res.status
      reason = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
      if (res.status === 404) reason += ' (unknown datasetID)'
      void res.body?.cancel().catch(() => {})                            // free the connection of an answer we drop (not awaited: a cancel waits for a clone's reader)
    } catch (e) {
      if (signal?.aborted) throw e                                       // superseded: not a failure
      if (!(e instanceof TypeError)) throw e                             // not the network: the caller's own error
      reason = `network error: ${e.message}`
      cause = e
    }
    if (i < tries) {
      const pause = Math.min(delayMs * i, maxDelayMs)
      onRetry?.({ attempt: i, tries, delayMs: pause, url: href, reason, ...(status !== undefined ? { status } : {}) })
      if (pause > 0) await wait(pause, signal)
    }
  }
  throw new PatientFetchError(hostOf(href), reason, Math.max(1, tries), href, status, { cause })
}
