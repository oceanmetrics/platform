// om-alerts: the routes and CORS (README "Routes"). the module entry (index.ts) exports only the handlers: workerd reads
// every named export of the main module as an entrypoint ----
import { confirm } from './confirm.js'
import { defaultDeps } from './env.js'
import type { Deps, Env } from './env.js'
import { providerEvents } from './events.js'
import { cors, fail, HttpError, json, meter, originAllowed } from './http.js'
import { manage, unsubscribe } from './manage.js'
import { subscribe } from './subscribe.js'

export const VERSION = '0.1.0'

type Handler = (req: Request, env: Env, deps: Deps, origin: string) => Promise<Response>

const POST: Record<string, Handler> = {
  '/v1/subscribe': subscribe,
  '/v1/confirm': confirm,
  '/v1/manage': manage,
  '/v1/unsubscribe': unsubscribe,
}

/** the fetch handler, with the network and the clock passed in */
export async function handle(req: Request, env: Env, deps: Deps = defaultDeps()): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const origin = req.headers.get('origin')
  // a browser call from any other site is refused before anything is read or written
  if (origin && !originAllowed(origin, env) && path !== '/v1/provider-events') {
    meter(env, path.slice(4) || 'root', 'origin_refused', 403, 1, origin)
    return fail(403, 'origin_not_allowed', 'the alerts API answers oceanmetrics.io pages only')
  }
  const res = await route(req, env, deps, path, url, origin ?? '')
  if (origin && path !== '/v1/provider-events') cors(res.headers, origin)
  return res
}

async function route(req: Request, env: Env, deps: Deps, path: string, url: URL, origin: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  try {
    if (path === '/v1/health' && (req.method === 'GET' || req.method === 'HEAD'))
      return json({ ok: true, service: 'om-alerts', version: VERSION, provider: env.PROVIDER ?? 'log', turnstile: env.TURNSTILE_SECRET ? 'on' : 'skipped', keyed: !!env.ALERTS_KEY })
    if (path === '/v1/provider-events') return req.method === 'POST' ? await providerEvents(req, env, deps) : fail(405, 'method_not_allowed')
    // a GET never changes state: the mail's unsubscribe link, opened in a browser, lands on the page with the button
    if (path === '/v1/unsubscribe' && req.method === 'GET') {
      const t = url.searchParams.get('t') ?? ''
      const to = `${(env.SITE ?? 'https://oceanmetrics.io').replace(/\/+$/, '')}/alerts/manage/#t=${encodeURIComponent(t)}&u=all`
      return new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } })
    }
    const h = POST[path]
    if (!h) return fail(404, 'not_found', 'routes: POST /v1/subscribe, /v1/confirm, /v1/manage, /v1/unsubscribe; GET /v1/health')
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'POST only', { allow: 'POST, OPTIONS' })
    if (!env.ALERTS_KEY) return fail(503, 'not_configured', 'ALERTS_KEY is not set')
    return await h(req, env, deps, origin)
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message)
    console.error('om-alerts error', (e as Error).name)
    meter(env, path.slice(4), 'error', 500, 1, origin)
    return fail(500, 'error', 'something went wrong; try again later')
  }
}
