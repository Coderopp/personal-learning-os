import type { Env } from './env'
import { all, run } from './db'
import type { Line } from './youtube'

const WINDOW_S = 30

/** Store the transcript and (re)index it as ~30 s windows so moments are keyword-searchable. */
export async function saveTranscript(env: Env, videoId: string, lines: Line[]) {
  await run(env, 'UPDATE videos SET transcript = ? WHERE id = ?', JSON.stringify(lines), videoId)
  const windows: { t: number; text: string }[] = []
  for (const l of lines) {
    const last = windows[windows.length - 1]
    if (last && l.t - last.t < WINDOW_S) last.text += ` ${l.text}`
    else windows.push({ t: Math.floor(l.t), text: l.text })
  }
  await run(env, 'DELETE FROM transcript_segments WHERE video_id = ?', videoId)
  // D1 caps statements per batch; chunk the inserts.
  for (let i = 0; i < windows.length; i += 200) {
    await env.DB.batch(windows.slice(i, i + 200).map(w =>
      env.DB.prepare('INSERT INTO transcript_segments (video_id, t, text) VALUES (?, ?, ?)').bind(videoId, w.t, w.text)))
  }
  return windows.length
}

const STOP = new Set(('a an and are as at be but by can do does did for from how i if in into is it its me my of on or so that the ' +
  'their them then there these this to was what when where which who why will with you your about explain tell use used using').split(' '))

/** Turn free text into a safe FTS5 query: quoted content words, AND by default, OR as a fallback. */
function ftsQuery(q: string, mode: 'AND' | 'OR') {
  const terms = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].filter(t => !STOP.has(t)).slice(0, 8)
  return terms.map(t => `"${t}"`).join(` ${mode} `)
}

export interface Moment { video_id: string; title: string; channel: string | null; t: number; snippet: string }

export async function searchTranscripts(env: Env, q: string, opts: { videoId?: string; limit?: number } = {}): Promise<Moment[]> {
  const limit = opts.limit ?? 20
  for (const mode of ['AND', 'OR'] as const) {
    const match = ftsQuery(q, mode)
    if (!match) return []
    const rows = await all<Moment>(env,
      `SELECT s.video_id, v.title, v.channel, CAST(s.t AS REAL) AS t,
         snippet(transcript_segments, 2, '**', '**', '…', 14) AS snippet
       FROM transcript_segments s JOIN videos v ON v.id = s.video_id
       WHERE transcript_segments MATCH ? AND (? IS NULL OR s.video_id = ?)
       ORDER BY bm25(transcript_segments) LIMIT ?`,
      match, opts.videoId ?? null, opts.videoId ?? null, limit)
    if (rows.length || mode === 'OR') return rows
  }
  return []
}

/**
 * Make an approved/opened video searchable: upsert the video row, then best-effort fetch + index its captions.
 * Safe to call repeatedly; skips the fetch when a transcript already exists.
 */
export async function ingestVideo(env: Env, id: string, link: { missionId?: string | null; competencyId?: string | null; title?: string; channel?: string | null }) {
  const { fetchTranscript, videoMeta } = await import('./youtube')
  const existing = await all<{ has: number }>(env, 'SELECT transcript IS NOT NULL AS has FROM videos WHERE id = ?', id)
  if (!existing.length) {
    const meta = link.title ? { title: link.title, channel: link.channel ?? null } : await videoMeta(id)
    await run(env, 'INSERT OR IGNORE INTO videos (id, title, channel, mission_id, competency_id) VALUES (?, ?, ?, ?, ?)',
      id, meta?.title ?? 'YouTube video', meta?.channel ?? null, link.missionId ?? null, link.competencyId ?? null)
  } else if (link.missionId) {
    await run(env, 'UPDATE videos SET mission_id = COALESCE(mission_id, ?), competency_id = COALESCE(competency_id, ?) WHERE id = ?',
      link.missionId, link.competencyId ?? null, id)
  }
  if (existing[0]?.has) return { indexed: true }
  const lines = await fetchTranscript(id)
  if (!lines?.length) return { indexed: false }
  await saveTranscript(env, id, lines)
  return { indexed: true }
}
