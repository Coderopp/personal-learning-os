import { Hono } from 'hono'
import { type AppEnv, type Env, UserFacingError } from '../env'
import { all, first, slugify } from '../db'
import { llm, SCHEMAS } from '../llm'
import { competenciesOf } from '../learning'

export const graph = new Hono<AppEnv>()

/** A benchmark this strong in one mission earns a "test out" suggestion for linked competencies elsewhere. */
export const TEST_OUT_THRESHOLD = 70

/** Tag a mission's competencies with concepts, reusing the existing vocabulary so links form across missions. */
export async function linkMission(env: Env, missionId: string) {
  const comps = await competenciesOf(env, missionId)
  if (!comps.length) return { tagged: 0, concepts: 0 }
  const existing = await all<{ id: string; name: string }>(env,
    `SELECT DISTINCT c.id, c.name FROM concepts c JOIN competency_concepts cc ON cc.concept_id = c.id
     JOIN competencies k ON k.id = cc.competency_id WHERE k.mission_id != ? ORDER BY c.id LIMIT 200`, missionId)
  const { tags } = await llm<{ tags: { competency_id: string; concepts: { slug: string; name: string }[] }[] }>(env, {
    prompt: 'concept-tagger',
    schema: SCHEMAS.conceptTags,
    input: {
      mission: (await first<{ title: string }>(env, 'SELECT title FROM missions WHERE id = ?', missionId))?.title,
      competencies: comps.map(c => ({ id: c.id, name: c.name, description: c.description })),
      existing_concepts: existing.map(e => ({ slug: e.id, name: e.name })),
    },
  })
  const ids = new Set(comps.map(c => c.id))
  const stmts = [env.DB.prepare(`DELETE FROM competency_concepts WHERE competency_id IN (SELECT id FROM competencies WHERE mission_id = ?)`).bind(missionId)]
  const seen = new Set<string>()
  for (const t of tags.filter(t => ids.has(t.competency_id))) {
    for (const c of t.concepts.slice(0, 8)) {
      const slug = slugify(c.slug)
      if (!slug) continue
      stmts.push(env.DB.prepare('INSERT OR IGNORE INTO concepts (id, name) VALUES (?, ?)').bind(slug, c.name.slice(0, 60)))
      stmts.push(env.DB.prepare('INSERT OR IGNORE INTO competency_concepts (competency_id, concept_id) VALUES (?, ?)').bind(t.competency_id, slug))
      seen.add(slug)
    }
  }
  await env.DB.batch(stmts)
  return { tagged: tags.length, concepts: seen.size }
}

interface LinkRow { a: string; b: string; concept_id: string; concept: string }

/** Pairs of competencies in DIFFERENT missions that share at least one concept. */
async function crossLinks(env: Env, competencyId?: string) {
  const rows = await all<LinkRow>(env,
    `SELECT x.competency_id AS a, y.competency_id AS b, x.concept_id, c.name AS concept
     FROM competency_concepts x
     JOIN competency_concepts y ON y.concept_id = x.concept_id AND y.competency_id != x.competency_id
     JOIN competencies ka ON ka.id = x.competency_id JOIN competencies kb ON kb.id = y.competency_id
     JOIN missions ma ON ma.id = ka.mission_id JOIN missions mb ON mb.id = kb.mission_id
     JOIN concepts c ON c.id = x.concept_id
     WHERE ka.mission_id != kb.mission_id AND ma.status != 'archived' AND mb.status != 'archived'
       AND (? IS NULL OR x.competency_id = ?)`, competencyId ?? null, competencyId ?? null)
  const pairs = new Map<string, { a: string; b: string; shared: string[] }>()
  for (const r of rows) {
    if (!competencyId && r.a > r.b) continue // each unordered pair once
    const key = `${r.a}|${r.b}`
    const p = pairs.get(key) ?? { a: r.a, b: r.b, shared: [] }
    if (!p.shared.includes(r.concept)) p.shared.push(r.concept)
    pairs.set(key, p)
  }
  return [...pairs.values()].sort((p, q) => q.shared.length - p.shared.length)
}

graph.post('/missions/:id/link', async c => {
  const id = c.req.param('id')
  if (!(await first(c.env, 'SELECT id FROM missions WHERE id = ?', id))) throw new UserFacingError('Mission not found', 404)
  return c.json(await linkMission(c.env, id))
})

graph.get('/graph', async c => {
  const missions = await all<{ id: string; title: string; mode: string; status: string; role: string }>(c.env,
    `SELECT id, title, mode, status, role FROM missions WHERE status != 'archived' ORDER BY role = 'primary' DESC, status = 'active' DESC, created_at`)
  const comps = (await Promise.all(missions.map(m => competenciesOf(c.env, m.id)))).flat()
  const tagged = new Set((await all<{ competency_id: string }>(c.env, 'SELECT DISTINCT competency_id FROM competency_concepts')).map(r => r.competency_id))
  return c.json({
    missions: missions.map(m => ({ ...m, linked: comps.some(k => k.mission_id === m.id && tagged.has(k.id)) })),
    competencies: comps.map(k => ({ id: k.id, mission_id: k.mission_id, name: k.name, benchmark: k.benchmark_score, practice: k.practice_score })),
    links: await crossLinks(c.env),
  })
})

/** "Also in …" for one competency, plus test-out suggestions from strong benchmarks elsewhere. */
graph.get('/links/:id{.+}', async c => {
  const id = c.req.param('id')
  const me = await first<{ benchmark_score: number | null }>(c.env, 'SELECT benchmark_score FROM competencies WHERE id = ?', id)
  if (!me) throw new UserFacingError('Competency not found', 404)
  const links = await crossLinks(c.env, id)
  const others = links.length
    ? await all<{ id: string; name: string; mission_id: string; mission_title: string; benchmark_score: number | null }>(c.env,
      `SELECT k.id, k.name, k.mission_id, m.title AS mission_title, k.benchmark_score FROM competencies k JOIN missions m ON m.id = k.mission_id
       WHERE k.id IN (${links.map(() => '?').join(',')})`, ...links.map(l => l.b))
    : []
  const byId = new Map(others.map(o => [o.id, o]))
  const items = links.map(l => ({ ...byId.get(l.b)!, shared: l.shared })).filter(x => x.id)
  const proven = items.filter(x => (x.benchmark_score ?? 0) >= TEST_OUT_THRESHOLD)
  return c.json({
    links: items,
    // Suggest, never transfer: capability stays demonstrated per mission.
    test_out: (me.benchmark_score ?? 0) < TEST_OUT_THRESHOLD && proven.length
      ? { from: proven[0], shared: proven[0].shared }
      : null,
  })
})
