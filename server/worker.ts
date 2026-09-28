import { app } from './app'
import type { Env } from './env'

// Static assets (the React app) are served by Cloudflare before this runs; only /api/* reaches the Worker.
export default { fetch: app.fetch } satisfies ExportedHandler<Env>
