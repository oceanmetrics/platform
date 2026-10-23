// Turnstile: verified when TURNSTILE_SECRET is set, else skipped (and the response says so) ----
import type { Deps, Env } from './env.js'

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileResult = 'ok' | 'skipped' | 'failed'

export async function turnstile(env: Env, deps: Deps, token: unknown, ip: string): Promise<TurnstileResult> {
  if (!env.TURNSTILE_SECRET) return 'skipped'
  if (typeof token !== 'string' || !token || token.length > 2048) return 'failed'
  const form = new FormData()
  form.set('secret', env.TURNSTILE_SECRET)
  form.set('response', token)
  if (ip !== 'unknown') form.set('remoteip', ip)
  try {
    const res = await deps.fetch(SITEVERIFY, { method: 'POST', body: form })
    const out = (await res.json()) as { success?: boolean }
    return out.success === true ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}
