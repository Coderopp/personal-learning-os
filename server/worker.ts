import { app } from './app'
import type { Env } from './env'
import { snapshot } from './snapshot'
import { eveningNudge } from './routes/push'
import { pollFeeds } from './routes/feedsRoutes'

// Static assets (the React app) are served by Cloudflare before this runs; only /api/* reaches the Worker.
export default {
  fetch: app.fetch,
  // Cron triggers (see [triggers] in wrangler.toml).
  scheduled(event, env, ctx) {
    const job = event.cron === '30 14 * * *'
      ? eveningNudge(env).then(r => console.log('evening nudge', JSON.stringify(r)))
      // 02:00 IST: pull new posts from followed writers, then back up (so the backup includes them).
      : pollFeeds(env).then(r => console.log('feeds', JSON.stringify(r))).catch(e => console.error('feeds failed', e))
        .then(() => snapshot(env)).then(r => console.log('snapshot', JSON.stringify(r)))
    ctx.waitUntil(job.catch(e => console.error(`cron ${event.cron} failed`, e)))
  },
} satisfies ExportedHandler<Env>
