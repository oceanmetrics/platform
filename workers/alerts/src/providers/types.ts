// the provider adapter: one function. switching provider (Cloudflare Email Sending later, decision D1) is one file ----

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
  headers?: Record<string, string>
  /** the provider's idempotency key: a retry with the same key never sends twice */
  idempotencyKey?: string
}

export interface SendResult {
  ok: boolean
  /** the provider's message id */
  id?: string
  /** the http status of the provider's answer (0 for a network error) */
  status: number
  /** a 429, a 5xx or a network error: try again next run */
  retry: boolean
}

export type Send = (mail: Mail) => Promise<SendResult>
