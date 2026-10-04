import { Hono } from 'hono'
import { type AppEnv, type Env, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run } from '../db'
import { llm, SCHEMAS } from '../llm'
import { arxiv, github, type Hit, latestPosts, tavily, youtube } from '../search'
import { fetchTranscript, type Line, looksLikeEpisode, parseVideoId, pickSegment, playlistEpisodes, searchPlaylists, seriesFor } from '../youtube'
import { readable, textFor } from '../content'
import { platformOf } from '../feeds'
import { repoFile, repoInfo } from '../github'
import { ingestVideo } from '../transcripts'

export const paths = new Hono<AppEnv>()

type Kind = 'read' | 'watch' | 'pdf' | 'code' | 'project' | 'link'
type Role = 'foundation' | 'deepen' | 'practice' | 'latest' | 'bench' | 'reference'
const CORE: Role[] = ['foundation', 'deepen', 'practice', 'latest']

interface Candidate {
  index: number; kind: 'read' | 'watch' | 'course' | 'pdf' | 'code'; source: string; title: string; url: string; snippet: string
  published?: string; duration_s?: number; channel?: string; views?: number; stars?: number; episodes?: number; paid?: boolean
}

/** Which platform a web URL belongs to, for display and for choosing how to read it. */
export function sourceOf(url: string): string {
  const host = new URL(url).hostname
  if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube'
  if (host.endsWith('arxiv.org')) return 'arxiv'
  if (host === 'github.com') return 'github'
  if (/\.pdf($|\?)/i.test(url)) return 'pdf'
  const p = platformOf(url)
  if (p !== 'blog') return p
  return /docs\.|\/docs\/|documentation|readthedocs/.test(url) ? 'web' : 'blog'
}

function classify(h: Hit, index: number): Candidate {
  const src = h.source === 'youtube' ? 'youtube' : h.source === 'playlist' ? 'youtube' : h.source === 'arxiv' ? 'arxiv' : h.source === 'github' ? 'github' : sourceOf(h.url)
  const kind: Candidate['kind'] = h.source === 'playlist' ? 'course'
    : src === 'youtube' ? 'watch'
    : src === 'arxiv' || src === 'pdf' ? 'pdf'
    : src === 'github' ? 'code'
    : 'read'
  return {
    index, kind, source: src, title: h.title.slice(0, 140), url: h.url, snippet: h.snippet.slice(0, 220),
    ...(h.published && { published: h.published }), ...(h.duration_s && { duration_s: h.duration_s }),
    ...(h.author && { channel: h.author }), ...(h.views && { views: h.views }), ...(h.stars && { stars: h.stars }),
  }
}

const arxivId = (url: string) => url.match(/arxiv\.org\/(?:abs|pdf|html)\/([\w.-]+?)(?:v\d+)?(?:\.pdf)?$/)?.[1] ?? null

/** Search everything relevant for one competency: web, newsletters/blogs (last 12 months), videos, playlists, papers, repos. */
async function searchAll(env: Env, comp: { name: string; description: string }, missionTitle: string) {
  const q = `${comp.name} ${missionTitle}`.slice(0, 120)
  const settled = await Promise.allSettled([
    tavily(env, q, { max: 5, exclude: ['youtube.com', 'reddit.com', 'quora.com'] }),
    latestPosts(env, comp.name),
    youtube(env, `${comp.name} lecture explained`, 6),
    searchPlaylists(`${comp.name} lecture course`, 2).then(pls => Promise.all(pls.map(async p => ({
      title: p.title, url: `https://www.youtube.com/playlist?list=${p.id}`, snippet: 'YouTube course playlist', source: 'playlist' as const,
      views: (await playlistEpisodes(p.id).catch(() => [])).length, // episode count rides in views for the composer
    })))),
    arxiv(q),
    github(env, comp.name),
  ])
  const seen = new Set<string>()
  const hits: Hit[] = []
  for (const s of settled) {
    if (s.status === 'rejected') { console.error('path search failed', s.reason); continue }
    for (const h of s.value) {
      const key = h.url.match(/[?&](?:v|list)=([\w-]+)/)?.[1] ?? h.url.replace(/[#?].*$/, '').replace(/\/$/, '')
      if (h.source === 'github' && (h.stars ?? 0) < 100) continue
      if (!seen.has(key)) { seen.add(key); hits.push(h) }
    }
  }
  return hits.slice(0, 24)
}

/** Choose the episode of a course that matches the competency best (by title words). */
function bestEpisode(episodes: { id: string; title: string }[], hint: string, comp: string) {
  const words = `${hint} ${comp}`.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  let best = episodes[0], bestScore = -1
  episodes.forEach(e => {
    const t = e.title.toLowerCase()
    const s = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0)
    if (s > bestScore) { best = e; bestScore = s }
  })
  return best
}

interface Pick { index: number; why: string; minutes: number; episode_hint: string }

async function unitFromCandidate(c: Candidate, pick: Pick | null, comp: string): Promise<{ kind: Kind; title: string; url: string; source: string; author?: string; published?: string; minutes?: number; data: Record<string, unknown> }> {
  if (c.kind === 'course') {
    const listId = new URL(c.url).searchParams.get('list')!
    const episodes = await playlistEpisodes(listId).catch(() => [])
    const ep = episodes.length ? bestEpisode(episodes, pick?.episode_hint ?? '', comp) : null
    return {
      kind: 'watch', title: ep ? ep.title : c.title, url: ep ? `https://www.youtube.com/watch?v=${ep.id}` : c.url, source: 'youtube',
      minutes: pick?.minutes, data: { video_id: ep?.id ?? null, playlist: { id: listId, title: c.title, episodes: episodes.slice(0, 80) } },
    }
  }
  if (c.kind === 'watch') {
    const vid = parseVideoId(c.url)
    const series = vid && looksLikeEpisode(c.title) ? await seriesFor(vid, c.title, c.channel).catch(() => null) : null
    return {
      kind: 'watch', title: c.title, url: c.url, source: 'youtube', author: c.channel, minutes: pick?.minutes,
      data: { video_id: vid, duration_s: c.duration_s ?? null, ...(series && { playlist: series }) },
    }
  }
  if (c.kind === 'pdf') {
    const id = arxivId(c.url)
    return {
      kind: 'pdf', title: c.title, url: id ? `https://arxiv.org/abs/${id}` : c.url, source: c.source, author: c.channel, minutes: pick?.minutes,
      data: { pdf_url: id ? `https://arxiv.org/pdf/${id}` : c.url },
    }
  }
  if (c.kind === 'code') {
    return { kind: 'code', title: c.title, url: c.url, source: 'github', minutes: pick?.minutes, data: { repo: c.url.replace('https://github.com/', '').split('/').slice(0, 2).join('/') } }
  }
  return { kind: 'read', title: c.title, url: c.url, source: c.source, published: c.published, minutes: pick?.minutes, data: {} }
}

/** Build (or rebuild) the path for one competency. One composer call + one project-designer call. */
export async function buildPath(env: Env, competencyId: string) {
  const comp = await first<{ id: string; name: string; description: string; mission_id: string }>(env,
    'SELECT id, name, description, mission_id FROM competencies WHERE id = ?', competencyId)
  if (!comp) throw new UserFacingError('Competency not found', 404)
  const mission = await first<{ title: string; goal: string; level: string; mode: string }>(env, 'SELECT title, goal, level, mode FROM missions WHERE id = ?', comp.mission_id)

  // Earlier suggestions for this competency join the candidate pool, so nothing good is lost in the rebuild.
  const legacy = await all<{ title: string; url: string; reason: string; source: string; duration_s: number | null; author: string | null }>(env,
    `SELECT title, url, reason, source, duration_s, author FROM resources WHERE competency_id = ? AND status IN ('candidate', 'accepted', 'deferred') LIMIT 8`, comp.id)
  const fresh = await searchAll(env, comp, mission?.title ?? '')
  const known = new Set(fresh.map(h => h.url))
  const hits: Hit[] = [
    ...fresh,
    ...legacy.filter(l => !known.has(l.url)).map(l => ({
      title: l.title, url: l.url, snippet: l.reason, source: (l.source === 'youtube' ? 'youtube' : l.source === 'github' ? 'github' : l.source === 'arxiv' ? 'arxiv' : 'tavily') as Hit['source'],
      ...(l.duration_s && { duration_s: l.duration_s }), ...(l.author && { author: l.author }),
    })),
  ].slice(0, 26)
  if (!hits.length) throw new UserFacingError('Search returned nothing for this skill. Try again later.', 502)
  const candidates = hits.map(classify)

  const picks = await llm<{ foundation: Pick; deepen: Pick; latest: Pick | null; bench: number[]; reference: number[]; rationale: string }>(env, {
    prompt: 'composer',
    schema: SCHEMAS.composePath,
    input: {
      today: nowIso().slice(0, 10), mission: mission?.title, learner_level: mission?.level,
      competency: { name: comp.name, description: comp.description }, candidates,
    },
  })
  const valid = (i: number | undefined) => i != null && candidates[i] != null
  const used = new Set<number>()
  const take = (p: Pick | null) => (p && valid(p.index) && !used.has(p.index) ? (used.add(p.index), p) : null)
  const core = { foundation: take(picks.foundation), deepen: take(picks.deepen), latest: take(picks.latest) }
  // Guard the composer: "latest" must be a written post, not a video or paper.
  if (core.latest && candidates[core.latest.index].kind !== 'read') { used.delete(core.latest.index); core.latest = null }

  const resourcesForProject = [core.foundation, core.deepen, core.latest].filter(Boolean).map(p => ({ title: candidates[p!.index].title, url: candidates[p!.index].url }))
  const brief = await llm<Record<string, unknown>>(env, {
    prompt: 'project-designer',
    schema: SCHEMAS.projectBrief,
    input: { mission: { title: mission?.title, goal: mission?.goal, level: mission?.level }, competency: { name: comp.name, description: comp.description }, path_resources: resourcesForProject },
  })
  brief.notes = ''

  // Replace any previous path for this competency (its project survives only if the learner already edited it).
  const old = await first<{ id: string }>(env, 'SELECT id FROM paths WHERE competency_id = ?', comp.id)
  if (old) {
    await run(env, `DELETE FROM projects WHERE unit_id IN (SELECT id FROM units WHERE path_id = ?) AND status = 'todo'`, old.id)
    await run(env, 'DELETE FROM units WHERE path_id = ?', old.id)
    await run(env, 'DELETE FROM paths WHERE id = ?', old.id)
  }
  const pathId = newId('path')
  await run(env, 'INSERT INTO paths (id, mission_id, competency_id, rationale) VALUES (?, ?, ?, ?)', pathId, comp.mission_id, comp.id, picks.rationale)

  const insertUnit = async (role: Role, position: number, u: Awaited<ReturnType<typeof unitFromCandidate>>, why: string) => {
    const id = newId('unit')
    await run(env,
      `INSERT INTO units (id, path_id, mission_id, competency_id, role, position, kind, title, url, source, author, published, minutes, why, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, pathId, comp.mission_id, comp.id, role, position, u.kind, u.title, u.url, u.source, u.author ?? null, u.published ?? null,
      u.minutes ?? null, why, JSON.stringify(u.data))
    return id
  }

  let position = 0
  for (const role of ['foundation', 'deepen'] as const) {
    const p = core[role]
    if (p) await insertUnit(role, position++, await unitFromCandidate(candidates[p.index], p, comp.name), p.why)
  }
  // Practice: the project.
  const projectUnit = await insertUnit('practice', position++, {
    kind: 'project', title: String(brief.title), url: '', source: 'project', minutes: Math.round(Number(brief.estimated_hours ?? 3) * 60), data: {},
  }, String(brief.summary))
  await run(env, 'INSERT INTO projects (id, unit_id, mission_id, competency_id, brief) VALUES (?, ?, ?, ?, ?)',
    newId('prj'), projectUnit, comp.mission_id, comp.id, JSON.stringify(brief))
  if (core.latest) await insertUnit('latest', position++, await unitFromCandidate(candidates[core.latest.index], core.latest, comp.name), core.latest.why)

  for (const [role, list] of [['bench', picks.bench], ['reference', picks.reference]] as const) {
    let i = 0
    for (const idx of list.filter(n => valid(n) && !used.has(n)).slice(0, 3)) {
      used.add(idx)
      const c = candidates[idx]
      await insertUnit(role, i++, await unitFromCandidate(c, null, comp.name), c.snippet.slice(0, 160))
    }
  }
  // The old per-link review queue for this competency is retired; its items live on as bench/reference.
  await run(env, `UPDATE resources SET status = 'deferred' WHERE competency_id = ? AND status = 'candidate'`, comp.id)
  return loadPath(env, comp.id)
}

export async function loadPath(env: Env, competencyId: string) {
  const path = await first(env, 'SELECT * FROM paths WHERE competency_id = ?', competencyId)
  if (!path) return null
  const units = (await all(env, 'SELECT * FROM units WHERE path_id = ? ORDER BY CASE role WHEN \'foundation\' THEN 0 WHEN \'deepen\' THEN 1 WHEN \'practice\' THEN 2 WHEN \'latest\' THEN 3 WHEN \'bench\' THEN 4 ELSE 5 END, position', path.id))
    .map(u => parseJson(u, ['data', 'questions']))
  const project = await first<{ id: string }>(env, `SELECT p.id FROM projects p JOIN units u ON u.id = p.unit_id WHERE u.path_id = ?`, path.id)
  return { ...path, units, project_id: project?.id ?? null }
}

paths.post('/paths/build', async c => {
  const { competency_id } = await c.req.json<{ competency_id: string }>()
  return c.json(await buildPath(c.env, competency_id))
})

paths.get('/paths/:id{.+}', async c => c.json(await loadPath(c.env, c.req.param('id'))))

paths.get('/missions/:id/paths', async c => {
  const rows = await all(c.env,
    `SELECT p.id, p.competency_id, p.status, k.name,
       (SELECT COUNT(*) FROM units u WHERE u.path_id = p.id AND u.role IN ('foundation','deepen','practice','latest')) AS steps,
       (SELECT COUNT(*) FROM units u WHERE u.path_id = p.id AND u.role IN ('foundation','deepen','practice','latest') AND u.status = 'done') AS done
     FROM paths p JOIN competencies k ON k.id = p.competency_id WHERE p.mission_id = ? ORDER BY k.order_idx`, c.req.param('id'))
  return c.json(rows)
})

paths.post('/paths/:id/accept', async c => {
  await run(c.env, `UPDATE paths SET status = 'accepted', accepted_at = ? WHERE id = ?`, nowIso(), c.req.param('id'))
  return c.json({ ok: true })
})

/** Swap a core step with a bench item (the old core item goes to the bench). */
paths.post('/units/:id/swap', async c => {
  const { with: benchId } = await c.req.json<{ with: string }>()
  const a = await first<{ id: string; role: Role; position: number; path_id: string }>(c.env, 'SELECT id, role, position, path_id FROM units WHERE id = ?', c.req.param('id'))
  const b = await first<{ id: string; role: Role; position: number; path_id: string }>(c.env, 'SELECT id, role, position, path_id FROM units WHERE id = ?', benchId)
  if (!a || !b || a.path_id !== b.path_id || b.role !== 'bench' || !CORE.includes(a.role) || a.role === 'practice') throw new UserFacingError('Can only swap a reading/watching step with a bench item')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE units SET role = ?, position = ? WHERE id = ?').bind(a.role, a.position, b.id),
    c.env.DB.prepare(`UPDATE units SET role = 'bench', position = ?, status = 'todo' WHERE id = ?`).bind(b.position, a.id),
  ])
  return c.json({ ok: true })
})

/** Open a unit: lazily prepares what the screen needs (readable text, video segment + course, repo files). */
paths.get('/units/:id', async c => {
  const u = await first<Record<string, unknown> & { id: string; kind: Kind; url: string; title: string; data: string; competency_id: string; status: string }>(c.env,
    'SELECT * FROM units WHERE id = ?', c.req.param('id'))
  if (!u) throw new UserFacingError('Step not found', 404)
  const data = JSON.parse(u.data) as Record<string, unknown>
  const comp = await first<{ name: string; description: string; mission_id: string }>(c.env, 'SELECT name, description, mission_id FROM competencies WHERE id = ?', u.competency_id)
  let content: unknown = null
  let changed = false

  if (u.kind === 'read') {
    const r = await readable(c.env, u.url)
    content = r
    if (r.paid !== data.paid) { data.paid = r.paid; changed = true }
    // Search results often lack author/date; the article itself has them.
    if ((!u.published && r.published) || (!u.author && r.author)) {
      await run(c.env, 'UPDATE units SET published = COALESCE(published, ?), author = COALESCE(author, ?) WHERE id = ?', r.published, r.author, u.id)
    }
  } else if (u.kind === 'watch' && data.video_id && data.segment === undefined) {
    // Index the transcript (for search + questions) and choose the part that covers this competency.
    const vid = String(data.video_id)
    await ingestVideo(c.env, vid, { missionId: comp?.mission_id, competencyId: u.competency_id, title: u.title }).catch(() => null)
    const v = await first<{ transcript: string | null; duration: number | null }>(c.env, 'SELECT transcript, duration FROM videos WHERE id = ?', vid)
    const lines = v?.transcript ? JSON.parse(v.transcript) as Line[] : await fetchTranscript(vid) ?? []
    const total = lines.length ? lines[lines.length - 1].t : Number(data.duration_s ?? 0)
    data.segment = total > 25 * 60 ? pickSegment(lines, [comp?.name ?? '', comp?.description ?? '', u.title], 20) : null
    changed = true
  } else if (u.kind === 'code' && !data.info) {
    data.info = await repoInfo(c.env, String(data.repo)).catch(() => null)
    changed = true
  }
  if (changed) await run(c.env, 'UPDATE units SET data = ? WHERE id = ?', JSON.stringify(data), u.id)
  if (u.status === 'todo') await run(c.env, `UPDATE units SET status = 'doing' WHERE id = ?`, u.id)
  const project = u.kind === 'project' ? await first<{ id: string }>(c.env, 'SELECT id FROM projects WHERE unit_id = ?', u.id) : null
  return c.json({ ...parseJson(u, ['questions']), data, content, competency: comp, project_id: project?.id ?? null })
})

paths.get('/units/:id/file', async c => {
  const u = await first<{ data: string }>(c.env, 'SELECT data FROM units WHERE id = ?', c.req.param('id'))
  const info = u ? (JSON.parse(u.data).info as { repo: string; branch: string } | undefined) : undefined
  const path = c.req.query('path')
  if (!info || !path) throw new UserFacingError('File not available', 404)
  return c.json({ path, text: await repoFile(c.env, info.repo, info.branch, path) })
})

/** Stream the PDF through the Worker (publishers don't send CORS headers, so the browser can't fetch it directly). */
paths.get('/units/:id/pdf', async c => {
  const u = await first<{ data: string }>(c.env, `SELECT data FROM units WHERE id = ? AND kind = 'pdf'`, c.req.param('id'))
  const pdfUrl = u ? String(JSON.parse(u.data).pdf_url ?? '') : ''
  if (!pdfUrl.startsWith('https://')) throw new UserFacingError('No PDF for this step', 404)
  const res = await fetch(pdfUrl, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; LearningOS/1.0)' }, redirect: 'follow' })
  const size = Number(res.headers.get('content-length') ?? 0)
  if (!res.ok || size > 30_000_000) throw new UserFacingError('Could not load this PDF', 502)
  return new Response(res.body, { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, max-age=86400' } })
})

/** Check questions, generated on first request from the unit's own material. `text` is sent by the client for PDFs. */
paths.post('/units/:id/questions', async c => {
  const u = await first<{ id: string; kind: Kind; url: string; title: string; data: string; questions: string | null; competency_id: string; mission_id: string }>(c.env,
    'SELECT * FROM units WHERE id = ?', c.req.param('id'))
  if (!u) throw new UserFacingError('Step not found', 404)
  if (u.questions) return c.json(JSON.parse(u.questions))
  const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }))
  const data = JSON.parse(u.data) as Record<string, unknown>
  let text = ''
  if (u.kind === 'read') text = textFor(await readable(c.env, u.url))
  else if (u.kind === 'pdf') text = (body.text ?? '').slice(0, 12_000)
  else if (u.kind === 'code') text = String((data.info as { readme?: string } | undefined)?.readme ?? '').slice(0, 12_000)
  else if (u.kind === 'watch' && data.video_id) {
    const v = await first<{ transcript: string | null }>(c.env, 'SELECT transcript FROM videos WHERE id = ?', String(data.video_id))
    const seg = data.segment as { start: number; end: number } | null
    const lines = v?.transcript ? (JSON.parse(v.transcript) as Line[]).filter(l => !seg || (l.t >= seg.start && l.t <= seg.end)) : []
    text = lines.map(l => l.text).join(' ').slice(0, 12_000)
  }
  if (text.length < 300) throw new UserFacingError('Not enough text from this source to write questions. Mark it done after you study it.', 409)
  const comp = await first<{ name: string; description: string }>(c.env, 'SELECT name, description FROM competencies WHERE id = ?', u.competency_id)
  const mission = await first<{ title: string }>(c.env, 'SELECT title FROM missions WHERE id = ?', u.mission_id)
  const out = await llm<{ questions: { prompt: string; expected: string; type: string }[] }>(c.env, {
    prompt: 'unit-questions', schema: SCHEMAS.unitQuestions,
    input: { mission: mission?.title, competency: comp, material: { title: u.title, kind: u.kind, text } },
  })
  const questions = out.questions.slice(0, 3).map(q => ({ ...q, id: newId('uq'), competency_id: u.competency_id }))
  await run(c.env, 'UPDATE units SET questions = ? WHERE id = ?', JSON.stringify(questions), u.id)
  return c.json(questions)
})

paths.post('/units/:id/progress', async c => {
  const { progress } = await c.req.json<{ progress: number }>()
  await run(c.env, 'UPDATE units SET progress = MAX(progress, ?) WHERE id = ?', Math.max(0, Math.min(1, progress)), c.req.param('id'))
  return c.json({ ok: true })
})

paths.post('/units/:id/complete', async c => {
  const { done = true } = await c.req.json<{ done?: boolean }>().catch(() => ({ done: true }))
  await run(c.env, `UPDATE units SET status = ?, progress = CASE WHEN ? THEN 1 ELSE progress END, completed_at = CASE WHEN ? THEN ? ELSE NULL END WHERE id = ?`,
    done ? 'done' : 'doing', done ? 1 : 0, done ? 1 : 0, nowIso(), c.req.param('id'))
  return c.json({ ok: true })
})
