import { Hono } from 'hono'
import { type AppEnv, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run } from '../db'
import { llm, SCHEMAS } from '../llm'
import { fetchTranscript, type Line, parsePastedTranscript, parseVideoId, transcriptToText, videoMeta } from '../youtube'

export const videos = new Hono<AppEnv>()

videos.get('/videos', async c => {
  const rows = await all(c.env,
    `SELECT v.id, v.title, v.channel, v.mission_id, v.competency_id, v.position, v.duration, v.updated_at,
       v.transcript IS NOT NULL AS has_transcript, v.ai_notes IS NOT NULL AS has_ai_notes,
       (SELECT COUNT(*) FROM video_notes n WHERE n.video_id = v.id) AS note_count
     FROM videos v ORDER BY v.updated_at DESC LIMIT 50`)
  return c.json(rows)
})

/** Open a video by URL/id. Upserts it so progress and notes sync across devices. */
videos.post('/videos', async c => {
  const b = await c.req.json<{ url: string; mission_id?: string; competency_id?: string }>()
  const id = parseVideoId(b.url ?? '')
  if (!id) throw new UserFacingError('That does not look like a YouTube link.')
  const existing = await first(c.env, 'SELECT id FROM videos WHERE id = ?', id)
  if (!existing) {
    const meta = await videoMeta(id)
    await run(c.env, 'INSERT INTO videos (id, title, channel, mission_id, competency_id) VALUES (?, ?, ?, ?, ?)',
      id, meta?.title ?? 'YouTube video', meta?.channel ?? null, b.mission_id ?? null, b.competency_id ?? null)
  } else if (b.mission_id) {
    await run(c.env, 'UPDATE videos SET mission_id = COALESCE(mission_id, ?), competency_id = COALESCE(competency_id, ?) WHERE id = ?',
      b.mission_id, b.competency_id ?? null, id)
  }
  return c.json({ id })
})

videos.get('/videos/:id', async c => {
  const v = await first(c.env, 'SELECT * FROM videos WHERE id = ?', c.req.param('id'))
  if (!v) throw new UserFacingError('Video not found', 404)
  const notes = await all(c.env, 'SELECT * FROM video_notes WHERE video_id = ? ORDER BY t', v.id)
  const { transcript, ...rest } = parseJson(v, ['ai_notes'])
  return c.json({ ...rest, has_transcript: transcript != null, notes })
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
  await run(c.env, 'UPDATE videos SET transcript = ? WHERE id = ?', JSON.stringify(lines), id)
  return c.json({ available: true, lines: lines.length })
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
  const out = await llm(c.env, { prompt: 'video-notes', schema: SCHEMAS.videoNotes, tier: 'fast', input: await videoContext(c.env, id), maxTokens: 3000 })
  await run(c.env, 'UPDATE videos SET ai_notes = ? WHERE id = ?', JSON.stringify(out), id)
  return c.json(out)
})

/** "Quiz me on the last N minutes": questions only, not cached. Answers are graded via /attempts. */
videos.post('/videos/:id/quiz', async c => {
  const b = await c.req.json<{ from: number; to: number }>()
  const out = await llm<{ questions: unknown[] }>(c.env, {
    prompt: 'video-notes', schema: SCHEMAS.videoNotes, tier: 'fast',
    input: await videoContext(c.env, c.req.param('id'), Math.max(0, b.from), b.to), maxTokens: 2000,
  })
  return c.json({ questions: out.questions.slice(0, 3) })
})
