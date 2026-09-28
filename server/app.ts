import { Hono } from 'hono'
import { type AppEnv, UserFacingError } from './env'
import { requireAccess } from './auth'
import { missions } from './routes/missions'
import { library } from './routes/library'
import { sessions } from './routes/sessions'
import { tracking } from './routes/tracking'
import { videos } from './routes/videos'
import { benchmarks } from './routes/benchmarks'
import { analytics } from './routes/analytics'
import { push } from './routes/push'

export const app = new Hono<AppEnv>().basePath('/api')

app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})
app.use('*', requireAccess)
app.route('/', missions)
app.route('/', library)
app.route('/', sessions)
app.route('/', tracking)
app.route('/', videos)
app.route('/', benchmarks)
app.route('/', analytics)
app.route('/', push)

app.notFound(c => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  if (err instanceof UserFacingError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Something went wrong on the server.' }, 500)
})
