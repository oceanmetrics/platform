// POST /v1/provider-events: Resend's signed webhooks (Svix). a hard bounce or a complaint ends every subscription of
// the address and keeps only its hmac as a suppression. a bad or old signature is refused ----
import { b64url, fromB64, hmacHex, keys, normalise, sameText } from './crypto.js'
import type { Deps, Env } from './env.js'
import { fail, json, meter } from './http.js'
import { endAddress } from './store.js'

const te = new TextEncoder()
const TOLERANCE = 300

/** whether `svix-signature` signs `<svix-id>.<svix-timestamp>.<body>` with the whsec_ secret, within five minutes */
export async function verifySvix(secret: string, headers: Headers, body: string, now: Date): Promise<boolean> {
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sigs = headers.get('svix-signature')
  if (!id || !ts || !sigs || !/^\d+$/.test(ts)) return false
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > TOLERANCE) return false
  const key = await crypto.subtle.importKey('raw', fromB64(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, te.encode(`${id}.${ts}.${body}`))
  const want = b64url(mac)
  return sigs.split(' ').some((s) => {
    const [v, sig] = s.split(',')
    return v === 'v1' && !!sig && sameText(sig.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), want)
  })
}

interface ResendEvent { type?: string; data?: { to?: string[] | string; bounce?: { type?: string } } }

export async function providerEvents(req: Request, env: Env, deps: Deps): Promise<Response> {
  if (!env.RESEND_WEBHOOK_SECRET) return fail(503, 'not_configured', 'RESEND_WEBHOOK_SECRET is not set')
  const body = await req.text()
  if (body.length > 65_536) return fail(413, 'too_large')
  if (!(await verifySvix(env.RESEND_WEBHOOK_SECRET, req.headers, body, deps.now()))) {
    meter(env, 'provider_events', 'bad_signature', 401)
    return fail(401, 'bad_signature')
  }
  let ev: ResendEvent
  try { ev = JSON.parse(body) } catch { return fail(400, 'bad_json') }
  const hard = ev.type === 'email.complained' || (ev.type === 'email.bounced' && (ev.data?.bounce?.type ?? 'Permanent') !== 'Transient')
  if (!hard) {
    meter(env, 'provider_events', ev.type ?? 'unknown', 200)
    return json({ ok: true, action: 'none' })
  }
  const k = await keys(env.ALERTS_KEY)
  const to = ([] as string[]).concat(ev.data?.to ?? [])
  const at = deps.now().toISOString().replace(/\.\d+Z$/, 'Z')
  for (const addr of to) await endAddress(env, await hmacHex(k.addr, normalise(addr)), ev.type === 'email.complained' ? 'complaint' : 'bounce', at)
  meter(env, ev.type === 'email.complained' ? 'complaint' : 'bounce', 'suppressed', 200, to.length)
  return json({ ok: true, action: 'suppressed', count: to.length })
}
