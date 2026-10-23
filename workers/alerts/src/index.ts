// om-alerts: the module entry. only the default export lives here (workerd reads every named export of the main
// module as an entrypoint, so `handle` and the rest are in app.ts) ----
import { handle } from './app.js'
import { defaultDeps } from './env.js'
import type { Env } from './env.js'
import { meter } from './http.js'
import { runDigests } from './scheduled.js'

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    // deployed before its secret (PROVIDER=log on workers.dev): the cron waits quietly
    if (!env.ALERTS_KEY) { meter(env, 'cron', 'not_configured'); return }
    ctx.waitUntil(runDigests(env, defaultDeps()).then(
      (s) => console.log(`om-alerts cron: ${JSON.stringify(s)}`),
      (e) => { console.error('om-alerts cron failed', (e as Error).message); meter(env, 'cron', 'failed') },
    ))
  },
} satisfies ExportedHandler<Env>
