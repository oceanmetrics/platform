import type { Deps, Env } from '../env.js'
import { logProvider } from './log.js'
import { resendProvider } from './resend.js'
import type { Send } from './types.js'

export type { Mail, Send, SendResult } from './types.js'

/** the configured provider's send(); `log` unless PROVIDER is `resend` */
export function provider(env: Env, deps: Deps): Send {
  return env.PROVIDER === 'resend' ? resendProvider(env, deps.fetch) : logProvider(env)
}
