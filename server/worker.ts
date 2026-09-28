import { app } from './app'
import type { Env } from './env'
import { snapshot } from './snapshot'
import { eveningNudge } from './routes/push'

// Static assets (the React app) are served by Cloudflare before this runs; only /api/* reaches the Worker.
export default {
  fetch: app.fetch,
  // Cron triggers (see [triggers] in wrangler.toml).
  scheduled(event, env, ctx) {
    const job = event.cron === '30 14 * * *'
      ? eveningNudge(env).then(r => console.log('evening nudge', JSON.stringify(r)))
      : snapshot(env).then(r => console.log('snapshot', JSON.stringify(r)))
    ctx.waitUntil(job.catch(e => console.error(`cron ${event.cron} failed`, e)))
  },
} satisfies ExportedHandler<Env>
