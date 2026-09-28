import { Hono } from 'hono'
import { type AppEnv, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run } from '../db'
import { llm, SCHEMAS } from '../llm'
import { commitJson } from '../github'
import { parseVideoId, videoMeta } from '../youtube'

export const library = new Hono<AppEnv>()

const RESOURCE_JSON = ['supports'] as const

library.get('/resources', async c => {
  const q = c.req.query()
  const where: string[] = []
  const params: unknown[] = []
  if (q.mission) { where.push('r.mission_id = ?'); params.push(q.mission) }
  if (q.status) { where.push('r.status = ?'); params.push(q.status) }
  else where.push(`r.status IN ('accepted', 'candidate', 'deferred')`)
  if (q.competency) { where.push('r.competency_id = ?'); params.push(q.competency) }
  if (q.type) { where.push('r.type = ?'); params.push(q.type) }
  if (q.q) {
    where.push('(r.title LIKE ? OR r.reason LIKE ? OR r.snippet LIKE ?)')
    params.push(...Array(3).fill(`%${q.q}%`))
  }
  const rows = await all(c.env, `
    SELECT r.*, c.name AS competency_name, m.title AS mission_title
    FROM resources r LEFT JOIN competencies c ON c.id = r.competency_id JOIN missions m ON m.id = r.mission_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.status = 'candidate' DESC, r.official DESC, r.created_at DESC LIMIT 300`, ...params)
  return c.json(rows.map(r => parseJson(r, [...RESOURCE_JSON])))
})

/** Review-queue decision. Approve = the human gate; the resource is committed to the canonical repo. */
library.patch('/resources/:id', async c => {
  const id = c.req.param('id')
  const body = await c.req.json<{ status?: string; note?: string; competency_id?: string; reason?: string }>()
  const r = await first(c.env, 'SELECT * FROM resources WHERE id = ?', id)
  if (!r) throw new UserFacingError('Resource not found', 404)
  if (body.status && !['candidate', 'accepted', 'deferred', 'rejected', 'deprecated'].includes(body.status)) {
    throw new UserFacingError('Invalid status')
  }
  await run(c.env,
    `UPDATE resources SET status = COALESCE(?, status), note = COALESCE(?, note), competency_id = COALESCE(?, competency_id),
     reason = COALESCE(?, reason) WHERE id = ?`,
    body.status ?? null, body.note ?? null, body.competency_id ?? null, body.reason ?? null, id)

  let committed: string | null = null
  if (body.status === 'accepted' || body.status === 'deprecated') {
    const fresh = parseJson((await first(c.env, 'SELECT * FROM resources WHERE id = ?', id))!, [...RESOURCE_JSON])
    const { committed_sha: _sha, snippet: _snip, ...record } = fresh
    committed = await commitJson(c.env, `knowledge/resources/${fresh.mission_id}/${id}.json`, record,
      `knowledge: ${body.status === 'accepted' ? 'accept' : 'deprecate'} "${fresh.title}"`)
    if (committed) await run(c.env, 'UPDATE resources SET committed_sha = ? WHERE id = ?', committed, id)
  }
  return c.json({ ok: true, committed })
})

/** Manual add: you are the curator, so it goes straight to accepted, but still needs a reason to exist. */
library.post('/resources', async c => {
  const body = await c.req.json<{ mission_id: string; competency_id?: string; url: string; title?: string; type?: string; reason: string; level?: string }>()
  if (!body.url || !body.mission_id) throw new UserFacingError('URL and mission are required')
  if (!body.reason?.trim()) throw new UserFacingError('Every resource needs a reason to exist.')
  let url: URL
  try { url = new URL(body.url) } catch { throw new UserFacingError('Not a valid URL') }
  const vid = parseVideoId(body.url)
  const meta = vid ? await videoMeta(vid) : null
  const id = newId('res')
  await run(c.env,
    `INSERT INTO resources (id, mission_id, competency_id, title, url, type, level, reason, source, author, status, last_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'accepted', ?)`,
    id, body.mission_id, body.competency_id ?? null, body.title?.trim() || meta?.title || url.hostname, url.toString(),
    vid ? 'video' : body.type ?? 'article', body.level ?? 'intermediate', body.reason.trim(), meta?.channel ?? null, nowIso().slice(0, 10))
  const fresh = parseJson((await first(c.env, 'SELECT * FROM resources WHERE id = ?', id))!, [...RESOURCE_JSON])
  const committed = await commitJson(c.env, `knowledge/resources/${body.mission_id}/${id}.json`, fresh, `knowledge: add "${fresh.title}"`)
  return c.json({ id, committed })
})

library.get('/primer/:id{.+}', async c => {
  const p = await first(c.env, 'SELECT * FROM primers WHERE competency_id = ?', c.req.param('id'))
  return c.json(p ? parseJson(p, ['citations']) : null)
})

/** Generated once and cached; regenerate explicitly (e.g. after accepting new resources). */
library.post('/primer/:id{.+}', async c => {
  const id = c.req.param('id')
  const comp = await first<{ name: string; description: string; mission_id: string }>(c.env,
    'SELECT name, description, mission_id FROM competencies WHERE id = ?', id)
  if (!comp) throw new UserFacingError('Competency not found', 404)
  const mission = await first<{ title: string; level: string }>(c.env, 'SELECT title, level FROM missions WHERE id = ?', comp.mission_id)
  const resources = await all<{ id: string; title: string; url: string; reason: string; type: string; snippet: string | null }>(c.env,
    `SELECT id, title, url, reason, type, snippet FROM resources WHERE competency_id = ? AND status = 'accepted' ORDER BY official DESC LIMIT 8`, id)
  const citations = resources.map((r, i) => ({ n: i + 1, resource_id: r.id, title: r.title, url: r.url }))

  const { markdown } = await llm<{ markdown: string }>(c.env, {
    prompt: 'primer',
    schema: SCHEMAS.primer,
    input: {
      mission: mission?.title, learner_level: mission?.level,
      competency: { name: comp.name, description: comp.description },
      resources: resources.map((r, i) => ({ n: i + 1, title: r.title, type: r.type, why: r.reason, excerpt: r.snippet ?? '' })),
    },
  })
  await run(c.env,
    `INSERT INTO primers (competency_id, content, citations, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(competency_id) DO UPDATE SET content = excluded.content, citations = excluded.citations, created_at = excluded.created_at`,
    id, markdown, JSON.stringify(citations), nowIso())
  return c.json({ competency_id: id, content: markdown, citations })
})

/** Free-form tutor question about a competency, and targeted hints for a question in progress. */
library.post('/tutor', async c => {
  const body = await c.req.json<{ task: 'hint' | 'ask'; competency_id?: string; question?: string; answer?: string; message?: string }>()
  const comp = body.competency_id
    ? await first<{ name: string; description: string }>(c.env, 'SELECT name, description FROM competencies WHERE id = ?', body.competency_id)
    : null
  const { markdown } = await llm<{ markdown: string }>(c.env, {
    prompt: 'tutor',
    schema: SCHEMAS.tutor,
    tier: body.task === 'hint' ? 'fast' : 'large',
    input: { task: body.task, competency: comp, question: body.question ?? '', learner_answer_so_far: body.answer ?? '', message: body.message ?? '' },
  })
  return c.json({ markdown })
})
