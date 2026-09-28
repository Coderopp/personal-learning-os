import { Hono } from 'hono'
import { type AppEnv, type Env, UserFacingError } from '../env'
import { all, first, run } from '../db'
import { broadcast, sendPush } from '../push'
import { activity, streaks } from './analytics'
import { benchmarkStatus } from '../learning'

export const push = new Hono<AppEnv>()

push.get('/push/key', c => c.json({ key: c.env.VAPID_PUBLIC_KEY ?? null, configured: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY) }))

push.get('/push/subscriptions', async c => c.json(await all(c.env, 'SELECT endpoint, label, enabled, created_at, last_sent_at FROM push_subscriptions ORDER BY created_at')))

push.post('/push/subscribe', async c => {
  const b = await c.req.json<{ subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; label?: string }>()
  const s = b.subscription
  if (!s?.endpoint?.startsWith('https://') || !s.keys?.p256dh || !s.keys?.auth) throw new UserFacingError('Invalid push subscription')
  await run(c.env,
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, enabled = 1`,
    s.endpoint, s.keys.p256dh, s.keys.auth, (b.label ?? 'device').slice(0, 60))
  return c.json({ ok: true })
})

push.post('/push/unsubscribe', async c => {
  const { endpoint } = await c.req.json<{ endpoint: string }>()
  await run(c.env, 'DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint)
  return c.json({ ok: true })
})

push.post('/push/test', async c => {
  const { endpoint } = await c.req.json<{ endpoint: string }>()
  const sub = await first<{ endpoint: string; p256dh: string; auth: string }>(c.env, 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?', endpoint)
  if (!sub) throw new UserFacingError('This device is not subscribed', 404)
  const r = await sendPush(c.env, sub, { title: 'Reminders are on', body: 'You\'ll get one nudge at 20:00 IST, only on days you haven\'t studied and something is due.', url: '/', tag: 'test' })
  if (r === 'gone') await run(c.env, 'DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint)
  if (r === 'ok') await run(c.env, `UPDATE push_subscriptions SET last_sent_at = datetime('now') WHERE endpoint = ?`, endpoint)
  if (r !== 'ok') throw new UserFacingError(r === 'gone' ? 'This browser dropped the subscription. Turn reminders on again.' : 'The push service rejected the message.', 502)
  return c.json({ ok: true })
})

/**
 * 20:00 IST: one nudge, only if you haven't had a learning day today AND something is waiting.
 * Quiet by design: no "you haven't opened the app" messages.
 */
export async function eveningNudge(env: Env) {
  const days = await activity(env, 371)
  const streak = streaks(days)
  if (streak.today_active) return { sent: 0, reason: 'already studied today' }

  const due = await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM reviews WHERE due_at <= datetime('now')`)
  const primary = await first<{ id: string }>(env, `SELECT id FROM missions WHERE status = 'active' ORDER BY role = 'primary' DESC LIMIT 1`)
  const ready = primary ? (await benchmarkStatus(env, primary.id)).filter(b => b.due) : []
  const n = due?.n ?? 0
  if (!n && !ready.length) return { sent: 0, reason: 'nothing due' }

  const title = n ? `${n} review${n > 1 ? 's' : ''} due · ~${Math.max(5, Math.round(n * 1.5))} min` : `Benchmark ready: ${ready[0].name}`
  const keep = streak.current > 0
    ? `Keep your ${streak.current}-day streak${streak.rest_day_available ? ' (or use this week\'s rest day)' : ''}.`
    : 'A short review today starts a new streak.'
  const body = [keep, n && ready.length ? `Benchmark ready: ${ready[0].name}.` : ''].filter(Boolean).join(' ')
  return broadcast(env, { title, body, url: n ? '/start-review' : `/missions/${primary!.id}`, tag: 'evening' })
}
