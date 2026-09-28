import { Hono } from 'hono'
import { type AppEnv, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run } from '../db'
import { llm, SCHEMAS } from '../llm'
import { fetchTranscript, type Line, parsePastedTranscript, parseVideoId, transcriptToText } from '../youtube'
import { ingestVideo, saveTranscript, searchTranscripts } from '../transcripts'
import { competenciesOf, pickBottleneck, recurringErrorCounts } from '../learning'

export const videos = new Hono<AppEnv>()

videos.get('/videos', async c => {
  const rows = await all(c.env,
    `SELECT v.id, v.title, v.channel, v.mission_id, v.competency_id, v.position, v.duration, v.updated_at,
       v.transcript IS NOT NULL AS has_transcript, v.ai_notes IS NOT NULL AS has_ai_notes,
       (SELECT COUNT(*) FROM video_notes n WHERE n.video_id = v.id) AS note_count
     FROM videos v ORDER BY v.updated_at DESC LIMIT 50`)
  return c.json(rows)
})

/** Open a video by URL/id. Upserts it so progress and notes sync across devices; captions are indexed in the background. */
videos.post('/videos', async c => {
  const b = await c.req.json<{ url: string; mission_id?: string; competency_id?: string }>()
  const id = parseVideoId(b.url ?? '')
  if (!id) throw new UserFacingError('That does not look like a YouTube link.')
  const work = ingestVideo(c.env, id, { missionId: b.mission_id, competencyId: b.competency_id })
  // Wait just long enough for the row to exist; the caption fetch may continue after the response.
  const done = await Promise.race([work.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 2500))])
  if (!done) c.executionCtx.waitUntil(work.catch(e => console.error('ingest failed', e)))
  if (!(await first(c.env, 'SELECT id FROM videos WHERE id = ?', id))) await work
  return c.json({ id })
})

/** Keyword search inside transcripts of saved videos (optionally one video). */
videos.get('/videos/search', async c => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json([])
  return c.json(await searchTranscripts(c.env, q, { videoId: c.req.query('video') || undefined, limit: 30 }))
})

/** Accepted videos for the primary mission's bottleneck that you haven't finished. */
videos.get('/videos/suggested', async c => {
  const m = await first<{ id: string }>(c.env, `SELECT id FROM missions WHERE status = 'active' ORDER BY role = 'primary' DESC, updated_at DESC LIMIT 1`)
  if (!m) return c.json({ competency: null, videos: [] })
  const bottleneck = pickBottleneck(await competenciesOf(c.env, m.id), await recurringErrorCounts(c.env, m.id))
  if (!bottleneck) return c.json({ competency: null, videos: [] })
  const rows = await all<{ url: string }>(c.env,
    `SELECT r.id, r.title, r.url, r.author, r.duration_s, r.reason, v.position, v.duration
     FROM resources r LEFT JOIN videos v ON r.url LIKE '%' || v.id || '%'
     WHERE r.competency_id = ? AND r.type = 'video' AND r.status = 'accepted'
       AND (v.id IS NULL OR v.duration IS NULL OR v.position < v.duration * 0.9)
     ORDER BY r.created_at LIMIT 6`, bottleneck.competency.id)
  return c.json({
    competency: { id: bottleneck.competency.id, name: bottleneck.competency.name },
    videos: rows.map(r => ({ ...r, video_id: parseVideoId(r.url) })),
  })
})

videos.get('/videos/:id', async c => {
  const v = await first(c.env, 'SELECT * FROM videos WHERE id = ?', c.req.param('id'))
  if (!v) throw new UserFacingError('Video not found', 404)
  const notes = await all(c.env, 'SELECT * FROM video_notes WHERE video_id = ? ORDER BY t', v.id)
  const indexed = await first(c.env, 'SELECT 1 AS x FROM transcript_segments WHERE video_id = ? LIMIT 1', v.id)
  const { transcript, ...rest } = parseJson(v, ['ai_notes'])
  // Searchable if either the raw transcript or its index exists (a restore keeps the index, not the raw text).
  return c.json({ ...rest, has_transcript: transcript != null || Boolean(indexed), notes })
})

videos.put('/videos/:id/progress', async c => {
  const b = await c.req.json<{ position: number; duration?: number }>()
  await run(c.env, 'UPDATE videos SET position = ?, duration = COALESCE(?, duration), updated_at = ? WHERE id = ?',
    b.position, b.duration ?? null, nowIso(), c.req.param('id'))
  return c.json({ ok: true })
})

videos.post('/videos/:id/notes', async c => {
  const b = await c.req.json<{ t: number; text: string }>()
  if (!b.text?.trim()) throw new UserFacingError('Empty note')
  const id = newId('vn')
  await run(c.env, 'INSERT INTO video_notes (id, video_id, t, text) VALUES (?, ?, ?, ?)', id, c.req.param('id'), b.t, b.text.trim())
  return c.json({ id })
})

videos.delete('/video-notes/:id', async c => {
  await run(c.env, 'DELETE FROM video_notes WHERE id = ?', c.req.param('id'))
  return c.json({ ok: true })
})

/** Try automatic captions; if YouTube blocks it, the client falls back to a pasted transcript. */
videos.post('/videos/:id/transcript', async c => {
  const id = c.req.param('id')
  const b = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }))
  const lines = b.text?.trim() ? parsePastedTranscript(b.text) : await fetchTranscript(id)
  if (!lines?.length) return c.json({ available: false })
  const segments = await saveTranscript(c.env, id, lines)
  return c.json({ available: true, lines: lines.length, segments })
})

async function videoContext(env: AppEnv['Bindings'], id: string, from = 0, to = Infinity) {
  const v = await first<{ title: string; channel: string | null; transcript: string | null }>(env,
    'SELECT title, channel, transcript FROM videos WHERE id = ?', id)
  if (!v) throw new UserFacingError('Video not found', 404)
  const notes = await all<{ t: number; text: string }>(env, 'SELECT t, text FROM video_notes WHERE video_id = ? AND t >= ? AND t <= ? ORDER BY t',
    id, from, Number.isFinite(to) ? to : 1e9)
  const transcript = v.transcript ? transcriptToText(JSON.parse(v.transcript) as Line[], from, to) : null
  if (!transcript && !notes.length) {
    throw new UserFacingError('No transcript yet and no notes in this range. Load the transcript or take a few notes first.', 409)
  }
  return { title: v.title, channel: v.channel, window: { from, to: Number.isFinite(to) ? to : null }, transcript, learner_notes: notes }
}

/** Transcript → summary, key concepts (with timestamps) and questions. Cached on the video. */
videos.post('/videos/:id/ai-notes', async c => {
  const id = c.req.param('id')
  const out = await llm(c.env, { prompt: 'video-notes', schema: SCHEMAS.videoNotes, tier: 'fast', input: await videoContext(c.env, id) })
  await run(c.env, 'UPDATE videos SET ai_notes = ? WHERE id = ?', JSON.stringify(out), id)
  return c.json(out)
})

/** "Quiz me on the last N minutes": questions only, not cached. Answers are graded via /attempts. */
videos.post('/videos/:id/quiz', async c => {
  const b = await c.req.json<{ from: number; to: number }>()
  const out = await llm<{ questions: unknown[] }>(c.env, {
    prompt: 'video-notes', schema: SCHEMAS.videoNotes, tier: 'fast',
    input: await videoContext(c.env, c.req.param('id'), Math.max(0, b.from), b.to),
  })
  return c.json({ questions: out.questions.slice(0, 3) })
})
