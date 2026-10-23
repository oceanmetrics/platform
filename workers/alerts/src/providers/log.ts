// `log`: nothing leaves the Worker. the mail is written to the console (the address and anything like one redacted)
// and counted in Analytics Engine, so the whole path can run on workers.dev before a provider exists ----
import type { Env } from '../env.js'
import { meter } from '../http.js'
import type { Mail, Send } from './types.js'

/** any text that looks like an address, so a log line never holds one */
export const redact = (s: string) => s.replace(/[^\s<>()"',;:]+@[^\s<>()"',;]+/g, '[address]')

export function logProvider(env: Env): Send {
  return async (mail: Mail) => {
    const lines = [`[om-alerts log provider] to=[address] subject=${JSON.stringify(redact(mail.subject))}`]
    for (const [k, v] of Object.entries(mail.headers ?? {})) lines.push(`${k}: ${redact(v)}`)
    lines.push(redact(mail.text))
    console.log(lines.join('\n'))
    meter(env, 'send', 'logged')
    return { ok: true, id: `log-${mail.idempotencyKey ?? 'mail'}`, status: 200, retry: false }
  }
}
