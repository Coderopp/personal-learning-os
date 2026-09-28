import { Hono } from 'hono'
import { type AppEnv, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run, slugify } from '../db'
import { llm, SCHEMAS } from '../llm'
import { gather, searchProviders, type Hit } from '../search'
import { commitJson } from '../github'
import { competenciesOf } from '../learning'

export const missions = new Hono<AppEnv>()

interface Plan {
  title: string
  goal: string
  excellence: { name: string; description: string }[]
  competencies: { id: string; name: string; description: string; prerequisites: string[] }[]
  search_queries: { competency_id: string; web: string[]; youtube: string }[]
  milestones: { title: string; description: string; competency_id: string }[]
}

missions.get('/missions', async c => {
  const rows = await all(c.env, `
    SELECT m.*,
      (SELECT COUNT(*) FROM competencies WHERE mission_id = m.id) AS competency_count,
      (SELECT COUNT(*) FROM resources WHERE mission_id = m.id AND status = 'accepted') AS accepted_count,
      (SELECT COUNT(*) FROM resources WHERE mission_id = m.id AND status = 'candidate') AS candidate_count,
      (SELECT COUNT(*) FROM milestones WHERE mission_id = m.id) AS milestone_count,
      (SELECT COUNT(*) FROM milestones WHERE mission_id = m.id AND status = 'done') AS milestone_done
    FROM missions m WHERE m.status != 'archived'
    ORDER BY m.role = 'primary' DESC, m.status = 'active' DESC, m.updated_at DESC`)
  return c.json(rows.map(r => parseJson(r, ['excellence'])))
})

missions.get('/missions/:id', async c => {
  const m = await first(c.env, 'SELECT * FROM missions WHERE id = ?', c.req.param('id'))
  if (!m) throw new UserFacingError('Mission not found', 404)
  const [competencies, milestones] = await Promise.all([
    competenciesOf(c.env, m.id as string),
    all(c.env, 'SELECT * FROM milestones WHERE mission_id = ? ORDER BY order_idx', m.id),
  ])
  return c.json({
    ...parseJson(m, ['excellence']),
    competencies,
    milestones: milestones.map(x => parseJson(x, ['log'])),
  })
})

/** Step 1 of the agent: planner builds the skill tree and the search plan. The mission starts as a draft. */
missions.post('/missions/plan', async c => {
  const body = await c.req.json<{ topic: string; mode: 'mastery' | 'project'; level: string; hours_per_week: number; notes?: string }>()
  if (!body.topic?.trim()) throw new UserFacingError('Describe what you want to get excellent at.')
  const mode = body.mode === 'project' ? 'project' : 'mastery'

  const plan = await llm<Plan>(c.env, {
    prompt: 'planner',
    schema: SCHEMAS.plan,
    input: { topic: body.topic, mode, level: body.level, hours_per_week: body.hours_per_week, notes: body.notes ?? '' },
    maxTokens: 6000,
  })

  let id = slugify(plan.title)
  if (await first(c.env, 'SELECT id FROM missions WHERE id = ?', id)) id = `${id}-${Date.now().toString(36).slice(-4)}`
  const hasPrimary = await first(c.env, `SELECT id FROM missions WHERE role = 'primary' AND status != 'archived'`)

  // Planner ids are slugs local to the plan; namespace them under the mission and drop dangling prerequisites.
  const localIds = new Set(plan.competencies.map(x => x.id))
  const compId = (local: string) => `${id}/${slugify(local)}`
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO missions (id, title, goal, mode, role, level, hours_per_week, excellence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, plan.title, plan.goal, mode, hasPrimary ? 'exploration' : 'primary', body.level, body.hours_per_week || 5, JSON.stringify(plan.excellence)),
    ...plan.competencies.map((x, i) => c.env.DB.prepare(
      `INSERT INTO competencies (id, mission_id, name, description, prerequisites, order_idx) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(compId(x.id), id, x.name, x.description, JSON.stringify(x.prerequisites.filter(p => localIds.has(p)).map(compId)), i)),
    ...(mode === 'project' ? plan.milestones : []).map((ms, i) => c.env.DB.prepare(
      `INSERT INTO milestones (id, mission_id, title, description, competency_id, order_idx) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(newId('ms'), id, ms.title, ms.description, localIds.has(ms.competency_id) ? compId(ms.competency_id) : null, i)),
  ]
  await c.env.DB.batch(stmts)

  return c.json({
    mission_id: id,
    providers: searchProviders(c.env),
    search_plan: plan.search_queries
      .filter(q => localIds.has(q.competency_id))
      .map(q => ({ competency_id: compId(q.competency_id), web: q.web, youtube: q.youtube })),
  })
})

/** Step 2 of the agent, called once per competency: real search → curator picks → review-queue candidates. */
missions.post('/missions/:id/gather', async c => {
  const missionId = c.req.param('id')
  const body = await c.req.json<{ competency_id: string; web?: string[]; youtube?: string }>()
  const comp = await first<{ id: string; name: string; description: string }>(c.env,
    'SELECT id, name, description FROM competencies WHERE id = ? AND mission_id = ?', body.competency_id, missionId)
  if (!comp) throw new UserFacingError('Competency not found', 404)
  const mission = await first<{ title: string; level: string }>(c.env, 'SELECT title, level FROM missions WHERE id = ?', missionId)

  const web = body.web?.length ? body.web : [`${comp.name} ${mission?.title ?? ''}`.trim()]
  const yt = body.youtube ?? `${comp.name} lecture`
  const existing = await all<{ url: string; title: string }>(c.env,
    `SELECT url, title FROM resources WHERE mission_id = ? AND status != 'rejected'`, missionId)
  const known = new Set(existing.map(r => r.url))
  const hits = (await gather(c.env, web, yt)).filter(h => !known.has(h.url)).slice(0, 18)
  if (!hits.length) return c.json({ added: 0, searched: 0 })

  const { picks } = await llm<{ picks: { index: number; type: string; level: string; est_minutes: number; official: boolean; hands_on: boolean; supports: string[]; reason: string }[] }>(c.env, {
    prompt: 'curator',
    schema: SCHEMAS.curate,
    input: {
      mission: mission?.title, learner_level: mission?.level,
      competency: { name: comp.name, description: comp.description },
      results: hits.map((h, index) => ({ index, title: h.title, url: h.url, snippet: h.snippet, source: h.source })),
      already_in_library: existing.slice(0, 60).map(r => r.title),
    },
  })

  const chosen = picks.filter(p => hits[p.index]).slice(0, 5)
  await c.env.DB.batch(chosen.map(p => {
    const h: Hit = hits[p.index]
    return c.env.DB.prepare(
      `INSERT OR IGNORE INTO resources (id, mission_id, competency_id, title, url, type, level, est_minutes, official, hands_on, reason, supports, source, author, snippet, last_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId('res'), missionId, comp.id, h.title, h.url, h.source === 'youtube' ? 'video' : p.type, p.level, p.est_minutes,
      p.official ? 1 : 0, p.hands_on ? 1 : 0, p.reason, JSON.stringify(p.supports), h.source, h.author ?? null, h.snippet,
      nowIso().slice(0, 10))
  }))
  return c.json({ added: chosen.length, searched: hits.length })
})

missions.patch('/missions/:id', async c => {
  const id = c.req.param('id')
  const body = await c.req.json<Partial<{ title: string; goal: string; role: string; status: string; hours_per_week: number; target: number }>>()
  const m = await first<{ status: string }>(c.env, 'SELECT status FROM missions WHERE id = ?', id)
  if (!m) throw new UserFacingError('Mission not found', 404)

  if (body.role === 'primary') await run(c.env, `UPDATE missions SET role = 'exploration' WHERE role = 'primary'`)
  const fields = (['title', 'goal', 'role', 'status', 'hours_per_week', 'target'] as const).filter(k => body[k] !== undefined)
  if (fields.length) {
    await run(c.env, `UPDATE missions SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...fields.map(f => body[f]), nowIso(), id)
  }

  let committed: string | null = null
  if (body.status === 'active' || (m.status === 'active' && (body.title || body.goal))) committed = await commitMission(c.env, id)
  return c.json({ ok: true, committed })
})

missions.delete('/missions/:id', async c => {
  const id = c.req.param('id')
  const m = await first<{ status: string }>(c.env, 'SELECT status FROM missions WHERE id = ?', id)
  if (!m) throw new UserFacingError('Mission not found', 404)
  if (m.status === 'draft') {
    await c.env.DB.batch(['competencies', 'milestones', 'resources'].map(t =>
      c.env.DB.prepare(`DELETE FROM ${t} WHERE mission_id = ?`).bind(id)).concat(c.env.DB.prepare('DELETE FROM missions WHERE id = ?').bind(id)))
  } else {
    // Active missions carry learner history; archive instead of deleting.
    await run(c.env, `UPDATE missions SET status = 'archived', role = 'exploration', updated_at = ? WHERE id = ?`, nowIso(), id)
  }
  return c.json({ ok: true })
})

missions.post('/missions/:id/competencies', async c => {
  const missionId = c.req.param('id')
  const body = await c.req.json<{ name: string; description?: string; prerequisites?: string[] }>()
  if (!body.name?.trim()) throw new UserFacingError('Name is required')
  const id = `${missionId}/${slugify(body.name)}`
  const max = await first<{ n: number | null }>(c.env, 'SELECT MAX(order_idx) AS n FROM competencies WHERE mission_id = ?', missionId)
  await run(c.env, 'INSERT INTO competencies (id, mission_id, name, description, prerequisites, order_idx) VALUES (?, ?, ?, ?, ?, ?)',
    id, missionId, body.name.trim(), body.description ?? '', JSON.stringify(body.prerequisites ?? []), (max?.n ?? -1) + 1)
  return c.json({ id })
})

missions.patch('/competencies/:id{.+}', async c => {
  const body = await c.req.json<Partial<{ name: string; description: string; prerequisites: string[] }>>()
  const id = c.req.param('id')
  if (body.name !== undefined) await run(c.env, 'UPDATE competencies SET name = ? WHERE id = ?', body.name, id)
  if (body.description !== undefined) await run(c.env, 'UPDATE competencies SET description = ? WHERE id = ?', body.description, id)
  if (body.prerequisites) await run(c.env, 'UPDATE competencies SET prerequisites = ? WHERE id = ?', JSON.stringify(body.prerequisites), id)
  return c.json({ ok: true })
})

missions.delete('/competencies/:id{.+}', async c => {
  const id = c.req.param('id')
  const comp = await first<{ mission_id: string }>(c.env, 'SELECT mission_id FROM competencies WHERE id = ?', id)
  if (!comp) throw new UserFacingError('Competency not found', 404)
  await run(c.env, 'DELETE FROM competencies WHERE id = ?', id)
  // Remove it from others' prerequisites so the graph stays valid.
  for (const other of await competenciesOf(c.env, comp.mission_id)) {
    if (other.prerequisites.includes(id)) {
      await run(c.env, 'UPDATE competencies SET prerequisites = ? WHERE id = ?',
        JSON.stringify(other.prerequisites.filter(p => p !== id)), other.id)
    }
  }
  return c.json({ ok: true })
})

missions.patch('/milestones/:id', async c => {
  const body = await c.req.json<{ status: 'todo' | 'doing' | 'done' }>()
  await run(c.env, 'UPDATE milestones SET status = ? WHERE id = ?', body.status, c.req.param('id'))
  return c.json({ ok: true })
})

/** knowledge/missions/<id>/mission.json is the canonical copy of the mission definition. */
async function commitMission(env: AppEnv['Bindings'], id: string) {
  const m = await first(env, 'SELECT id, title, goal, mode, level, target, excellence FROM missions WHERE id = ?', id)
  if (!m) return null
  const competencies = (await competenciesOf(env, id)).map(({ id, name, description, prerequisites }) => ({ id, name, description, prerequisites }))
  const milestones = await all(env, 'SELECT title, description, competency_id FROM milestones WHERE mission_id = ? ORDER BY order_idx', id)
  const sha = await commitJson(env, `knowledge/missions/${id}/mission.json`,
    { ...parseJson(m, ['excellence']), competencies, milestones }, `knowledge: mission ${m.title}`)
  if (sha) await run(env, 'UPDATE missions SET committed_sha = ? WHERE id = ?', sha, id)
  return sha
}
