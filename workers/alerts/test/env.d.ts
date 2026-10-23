// make `env` from cloudflare:test carry the Worker's bindings
import type { Env as WorkerEnv } from '../src/env'

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
