// the address at rest: AES-GCM, found by HMAC; the tokens. every key is derived from the one secret ALERTS_KEY (HKDF) ----

const te = new TextEncoder()
const td = new TextDecoder()

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')

/** random url-safe text of `n` bytes */
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)))

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', te.encode(s)))
}

export interface Keys {
  aes: CryptoKey
  /** the address index */
  addr: CryptoKey
  /** manage tokens */
  token: CryptoKey
  /** client ips in the rate-limit counters */
  ip: CryptoKey
}

const cache = new Map<string, Promise<Keys>>()

/** the derived keys of an ALERTS_KEY (base64 or base64url of at least 32 bytes); cached per isolate */
export function keys(secret: string | undefined): Promise<Keys> {
  if (!secret) throw new Error('ALERTS_KEY is not set')
  let k = cache.get(secret)
  if (!k) {
    k = derive(secret)
    cache.set(secret, k)
  }
  return k
}

async function derive(secret: string): Promise<Keys> {
  const raw = fromB64(secret.trim())
  if (raw.length < 32) throw new Error('ALERTS_KEY must be at least 32 bytes (openssl rand -base64 32)')
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('om-alerts'), info: te.encode(info) })
  const hmac = (info: string) => crypto.subtle.deriveKey(params(info), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify'])
  const [aes, addr, token, ip] = await Promise.all([
    crypto.subtle.deriveKey(params('aes-gcm v1'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    hmac('address v1'), hmac('manage token v1'), hmac('ip v1'),
  ])
  return { aes, addr, token, ip }
}

/** an address as it is indexed and stored: trimmed, lower case */
export const normalise = (email: string) => email.trim().toLowerCase()

export async function hmacHex(key: CryptoKey, s: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', key, te.encode(s)))
}

/** `v1.<iv>.<ciphertext>`: AES-GCM with a random 96-bit iv, the address's hmac as additional data */
export async function encrypt(k: Keys, plain: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, k.aes, te.encode(plain))
  return `v1.${b64url(iv)}.${b64url(ct)}`
}

/** the plaintext, or a throw for a wrong key, a wrong hmac or a changed ciphertext */
export async function decrypt(k: Keys, enc: string, aad: string): Promise<string> {
  const [v, iv, ct] = enc.split('.')
  if (v !== 'v1' || !iv || !ct) throw new Error('unknown ciphertext format')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: te.encode(aad) }, k.aes, fromB64(ct))
  return td.decode(pt)
}

// manage tokens: `m1.<hmac>.<epoch>.<signature>`, stateless; an address's epoch moves when all its subscriptions end ----

export async function manageToken(k: Keys, hmac: string, epoch: number): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', k.token, te.encode(`manage:${hmac}:${epoch}`))
  return `m1.${hmac}.${epoch}.${b64url(sig)}`
}

export async function readManageToken(k: Keys, token: unknown): Promise<{ hmac: string; epoch: number } | null> {
  if (typeof token !== 'string' || token.length > 200) return null
  const m = /^m1\.([0-9a-f]{64})\.(\d{1,6})\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!m) return null
  const [, hmac, e, sig] = m
  const ok = await crypto.subtle.verify('HMAC', k.token, fromB64(sig), te.encode(`manage:${hmac}:${e}`))
  return ok ? { hmac, epoch: Number(e) } : null
}

/** constant-time comparison of two strings */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
