// `resend`: POST https://api.resend.com/emails with the RESEND_KEY secret (decision D1: the free plan, 100 a day) ----
import { DEFAULTS } from '../env.js'
import type { Env } from '../env.js'
import type { Mail, Send } from './types.js'

export const RESEND_URL = 'https://api.resend.com/emails'

export function resendProvider(env: Env, fetcher: typeof fetch): Send {
  return async (mail: Mail) => {
    if (!env.RESEND_KEY) return { ok: false, status: 0, retry: false }
    const headers: Record<string, string> = { authorization: `Bearer ${env.RESEND_KEY}`, 'content-type': 'application/json' }
    if (mail.idempotencyKey) headers['idempotency-key'] = mail.idempotencyKey.slice(0, 256)
    const body = {
      from: env.FROM ?? DEFAULTS.FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html,
      ...(env.REPLY_TO ? { reply_to: env.REPLY_TO } : {}),
      ...(mail.headers && Object.keys(mail.headers).length ? { headers: mail.headers } : {}),
    }
    try {
      const res = await fetcher(RESEND_URL, { method: 'POST', headers, body: JSON.stringify(body) })
      const out = (await res.json().catch(() => ({}))) as { id?: string }
      return { ok: res.ok, id: out.id, status: res.status, retry: res.status === 429 || res.status >= 500 }
    } catch {
      return { ok: false, status: 0, retry: true }
    }
  }
}
