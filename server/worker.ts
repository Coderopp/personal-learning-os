import { app } from './app'
import type { Env } from './env'
import { snapshot } from './snapshot'

// Static assets (the React app) are served by Cloudflare before this runs; only /api/* reaches the Worker.
export default {
  fetch: app.fetch,
  // Nightly (see [triggers] in wrangler.toml): back up learner state to the private state repo.
  scheduled(_event, env, ctx) {
    ctx.waitUntil(snapshot(env).then(r => console.log('snapshot', JSON.stringify(r))).catch(e => console.error('snapshot failed', e)))
  },
} satisfies ExportedHandler<Env>
