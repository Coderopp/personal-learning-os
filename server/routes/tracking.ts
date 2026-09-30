import { Hono } from 'hono'
import { type AppEnv, UserFacingError } from '../env'
import { all, first, parseJson, run } from '../db'
import { searchProviders } from '../search'
import { snapshot } from '../snapshot'
import { activity } from './analytics'
import { addReview, benchmarkStatus, competenciesOf, pickBottleneck, recurringErrorCounts } from '../learning'

export const tracking = new Hono<AppEnv>()

// Minimum samples before a KPI is shown. Below this the UI says "not enough data" instead of a misleading number.
const MIN_RECALL_SAMPLES = 20

tracking.get('/status', async c => {
  const usage = await first(c.env, 'SELECT * FROM llm_usage WHERE day = ?', new Date().toISOString().slice(0, 10))
  const last = await first<{ value: string }>(c.env, `SELECT value FROM meta WHERE key = 'last_snapshot'`)
  return c.json({
    snapshot: { repo: c.env.STATE_REPO ?? null, configured: Boolean(c.env.GITHUB_TOKEN && c.env.STATE_REPO), last: last ? JSON.parse(last.value) : null },
    email: c.get('email'),
    providers: { groq: Boolean(c.env.GROQ_API_KEY), ...searchProviders(c.env), git: Boolean(c.env.GITHUB_TOKEN) },
    models: { large: c.env.LLM_LARGE, fast: c.env.LLM_FAST },
    usage_today: usage ?? { calls: 0, tokens: 0, rate_limited: 0 },
  })
})

/** Manual "back up now"; the same job runs nightly via the cron trigger. */
tracking.post('/snapshot', async c => {
  try {
    return c.json(await snapshot(c.env))
  } catch (e) {
    console.error('snapshot failed', e)
    throw new UserFacingError('Backup failed. Check that GITHUB_TOKEN can write to the state repo.', 502)
  }
})

tracking.get('/dashboard', async c => {
  const requested = c.req.query('mission')
  const mission = requested
    ? await first(c.env, 'SELECT * FROM missions WHERE id = ?', requested)
    : await first(c.env, `SELECT * FROM missions WHERE status = 'active' ORDER BY role = 'primary' DESC, updated_at DESC LIMIT 1`)

  const exploration = await all(c.env, `
    SELECT m.id, m.title, m.mode, m.role, m.status,
      (SELECT COUNT(*) FROM milestones WHERE mission_id = m.id) AS milestone_count,
      (SELECT COUNT(*) FROM milestones WHERE mission_id = m.id AND status = 'done') AS milestone_done,
      (SELECT COUNT(*) FROM reviews WHERE mission_id = m.id AND due_at <= datetime('now')) AS due
    FROM missions m WHERE m.status != 'archived' AND m.id != ? ORDER BY m.status = 'active' DESC, m.updated_at DESC`,
    mission?.id ?? '')

  // Same minutes as the heatmap: every learning screen, not only the Session page.
  const week = await activity(c.env, 7)
  const weekly = { minutes: week.reduce((m, d) => m + d.minutes, 0), sessions: week.reduce((n, d) => n + d.sessions, 0) }
  const totalDue = await first<{ n: number }>(c.env, `SELECT COUNT(*) AS n FROM reviews WHERE due_at <= datetime('now')`)

  if (!mission) return c.json({ mission: null, exploration, weekly, total_due: totalDue?.n ?? 0 })

  const missionId = mission.id as string
  const comps = await competenciesOf(c.env, missionId)
  const recurring = await recurringErrorCounts(c.env, missionId)
  const bottleneck = pickBottleneck(comps, recurring)

  const [errors, due, recall, practice, open, lastSession, nextResource, milestones] = await Promise.all([
    all(c.env, `SELECT id, concept, category, occurrences, status, next_action FROM errors
      WHERE mission_id = ? AND status != 'resolved' ORDER BY status = 'recurring' DESC, occurrences DESC, last_seen DESC LIMIT 4`, missionId),
    first<{ n: number }>(c.env, `SELECT COUNT(*) AS n FROM reviews WHERE mission_id = ? AND due_at <= datetime('now')`, missionId),
    all<{ interval_days: number; n: number; correct: number }>(c.env,
      `SELECT interval_days, COUNT(*) AS n, SUM(correct) AS correct FROM review_log WHERE mission_id = ? AND interval_days IN (7, 30) GROUP BY interval_days`, missionId),
    first<{ n: number; avg: number | null }>(c.env,
      `SELECT COUNT(*) AS n, AVG(score) AS avg FROM attempts WHERE mission_id = ? AND created_at > datetime('now', '-30 days')`, missionId),
    first(c.env, `SELECT id, kind, stage, started_at FROM sessions WHERE mission_id = ? AND ended_at IS NULL AND last_active_at > datetime('now', '-18 hours') ORDER BY last_active_at DESC LIMIT 1`, missionId),
    first(c.env, `SELECT json_extract(state, '$.summary') AS summary, ended_at FROM sessions WHERE mission_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`, missionId),
    bottleneck
      ? first(c.env, `SELECT id, title, type, url, reason FROM resources WHERE competency_id = ? AND status = 'accepted' ORDER BY official DESC, created_at LIMIT 1`, bottleneck.competency.id)
      : null,
    all(c.env, 'SELECT id, title, status, competency_id FROM milestones WHERE mission_id = ? ORDER BY order_idx', missionId),
  ])

  const recallPct = (days: number) => {
    const r = recall.find(x => x.interval_days === days)
    return r && r.n >= MIN_RECALL_SAMPLES ? { value: Math.round((100 * r.correct) / r.n), n: r.n } : { value: null, n: r?.n ?? 0 }
  }
  const benchmarked = comps.filter(x => x.benchmark_score != null)
  const benchmarkDue = (await benchmarkStatus(c.env, missionId)).filter(b => b.due)

  return c.json({
    mission: parseJson(mission, ['excellence']),
    competencies: comps,
    milestones,
    bottleneck: bottleneck && { id: bottleneck.competency.id, name: bottleneck.competency.name, why: bottleneck.why },
    next_resource: nextResource,
    errors,
    due: due?.n ?? 0,
    total_due: totalDue?.n ?? 0,
    open_session: open,
    last_session: lastSession,
    exploration,
    weekly,
    benchmark_due: benchmarkDue,
    metrics: {
      // Strict: demonstrated ability only. Unbenchmarked competencies count as 0, reported with coverage.
      capability: benchmarked.length
        ? Math.round(comps.reduce((s, x) => s + (x.benchmark_score ?? 0), 0) / comps.length)
        : null,
      benchmarked: benchmarked.length,
      coverage: `${benchmarked.length}/${comps.length}`,
      practice_accuracy: practice && practice.n >= 5 ? { value: Math.round(practice.avg ?? 0), n: practice.n } : { value: null, n: practice?.n ?? 0 },
      recall7: recallPct(7),
      recall30: recallPct(30),
    },
  })
})

tracking.get('/reviews/due', async c => {
  const mission = c.req.query('mission')
  const rows = await all(c.env,
    `SELECT r.*, m.title AS mission_title FROM reviews r JOIN missions m ON m.id = r.mission_id
     WHERE r.due_at <= datetime('now') AND (? IS NULL OR r.mission_id = ?) ORDER BY r.due_at LIMIT 100`, mission ?? null, mission ?? null)
  return c.json(rows)
})

tracking.post('/reviews', async c => {
  const b = await c.req.json<{ mission_id: string; competency_id?: string; prompt: string; expected: string; source?: string }>()
  if (!b.prompt?.trim() || !b.expected?.trim() || !b.mission_id) throw new UserFacingError('Prompt, expected answer and mission are required')
  const id = await addReview(c.env, { missionId: b.mission_id, competencyId: b.competency_id, prompt: b.prompt, expected: b.expected, source: b.source ?? 'manual' })
  return c.json({ id })
})

tracking.get('/errors', async c => {
  const q = c.req.query()
  const rows = await all(c.env,
    `SELECT e.*, c.name AS competency_name, m.title AS mission_title FROM errors e
     LEFT JOIN competencies c ON c.id = e.competency_id JOIN missions m ON m.id = e.mission_id
     WHERE (? IS NULL OR e.mission_id = ?) AND (? IS NULL OR e.status = ?)
     ORDER BY e.status = 'resolved', e.status = 'recurring' DESC, e.occurrences DESC, e.last_seen DESC`,
    q.mission ?? null, q.mission ?? null, q.status ?? null, q.status ?? null)
  return c.json(rows)
})

tracking.patch('/errors/:id', async c => {
  const b = await c.req.json<Partial<{ status: string; next_action: string; root_cause: string }>>()
  if (b.status && !['new', 'recurring', 'resolved'].includes(b.status)) throw new UserFacingError('Invalid status')
  await run(c.env,
    'UPDATE errors SET status = COALESCE(?, status), next_action = COALESCE(?, next_action), root_cause = COALESCE(?, root_cause) WHERE id = ?',
    b.status ?? null, b.next_action ?? null, b.root_cause ?? null, c.req.param('id'))
  return c.json({ ok: true })
})

tracking.get('/history', async c => {
  const mission = c.req.query('mission')
  const rows = await all(c.env,
    `SELECT s.id, s.mission_id, s.kind, s.mode, s.started_at, s.ended_at, s.focused_minutes, json_extract(s.state, '$.summary') AS summary,
       json_extract(s.state, '$.focus.name') AS focus, m.title AS mission_title,
       (SELECT COUNT(*) FROM attempts a WHERE a.session_id = s.id) AS attempts,
       (SELECT ROUND(AVG(score)) FROM attempts a WHERE a.session_id = s.id) AS avg_score
     FROM sessions s JOIN missions m ON m.id = s.mission_id WHERE (? IS NULL OR s.mission_id = ?)
     ORDER BY s.started_at DESC LIMIT 50`, mission ?? null, mission ?? null)
  return c.json(rows)
})
