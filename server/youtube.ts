import { decodeEntities } from './search'

export function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null
    if (u.hostname.endsWith('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v')!.slice(0, 11)
      const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]{11})/)
      if (m) return m[2]
    }
  } catch { /* not a URL */ }
  return null
}

/** Keyless title lookup via oEmbed. */
export async function videoMeta(id: string): Promise<{ title: string; channel: string } | null> {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`)
  if (!res.ok) return null
  const d = await res.json<{ title: string; author_name: string }>()
  return { title: d.title, channel: d.author_name }
}

export interface Line { t: number; text: string }

/**
 * Best-effort caption fetch. YouTube has no official captions API for other people's videos and often
 * blocks datacenter IPs, so callers must fall back to a pasted transcript when this returns null.
 */
export async function fetchTranscript(id: string): Promise<Line[] | null> {
  try {
    const player = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)' },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } } }),
      signal: AbortSignal.timeout(8000),
    })
    if (!player.ok) return null
    const data = await player.json<{ captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string }[] } } }>()
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    const track = tracks.find(t => t.languageCode.startsWith('en') && t.kind !== 'asr') ?? tracks.find(t => t.languageCode.startsWith('en')) ?? tracks[0]
    if (!track) return null
    const xml = await (await fetch(track.baseUrl.replace(/&fmt=[^&]*/, ''), { signal: AbortSignal.timeout(8000) })).text()
    const lines = [...xml.matchAll(/<(?:text|p) (?:start|t)="([\d.]+)"[^>]*>([\s\S]*?)<\/(?:text|p)>/g)].map(m => ({
      // srv1 uses seconds in `start`; srv3 uses milliseconds in `t`
      t: m[0].startsWith('<p') ? Number(m[1]) / 1000 : Number(m[1]),
      text: decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
    })).filter(l => l.text)
    return lines.length ? lines : null
  } catch (e) {
    console.error('transcript fetch failed', e)
    return null
  }
}

/** Parse a transcript pasted from YouTube's "Show transcript" panel ("0:00\ntext\n0:05\ntext" or "0:00 text"). */
export function parsePastedTranscript(text: string): Line[] {
  const lines: Line[] = []
  let current: Line | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s*(.*)$/)
    if (m) {
      current = { t: Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), text: m[4] ?? '' }
      lines.push(current)
    } else if (current) {
      current.text = `${current.text} ${line}`.trim()
    } else {
      current = { t: 0, text: line }
      lines.push(current)
    }
  }
  return lines.filter(l => l.text)
}

/**
 * Compact "[mm:ss] text" form. Long transcripts are sampled evenly across the whole video (not cut off at the start)
 * so the result fits Groq's free-tier per-minute budget.
 */
export function transcriptToText(lines: Line[], from = 0, to = Infinity, maxChars = 14_000) {
  const fmt = (l: Line) => `[${Math.floor(l.t / 60)}:${String(Math.floor(l.t % 60)).padStart(2, '0')}] ${l.text}`
  const all = lines.filter(l => l.t >= from && l.t <= to).map(fmt)
  const total = all.reduce((n, l) => n + l.length + 1, 0)
  if (total <= maxChars) return all.join('\n')
  const keepEvery = Math.ceil(total / maxChars)
  return `${all.filter((_, i) => i % keepEvery === 0).join('\n')}\n[long transcript: every ${keepEvery}th line shown]`
}

// ---------- Series / playlists (keyless InnerTube) ----------

const INNERTUBE_CTX = { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en' } }

async function innertube(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${path}?prettyPrint=false`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, context: INNERTUBE_CTX }), signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`innertube ${path} ${res.status}`)
  return res.json<unknown>()
}

function collect<T>(o: unknown, key: string, out: T[] = []): T[] {
  if (Array.isArray(o)) o.forEach(v => collect(v, key, out))
  else if (o && typeof o === 'object') {
    const rec = o as Record<string, unknown>
    if (key in rec) out.push(rec[key] as T)
    Object.values(rec).forEach(v => collect(v, key, out))
  }
  return out
}

interface Lockup { contentId: string; contentType: string; metadata?: { lockupMetadataViewModel?: { title?: { content?: string } } } }
const lockupTitle = (l: Lockup) => l.metadata?.lockupMetadataViewModel?.title?.content ?? ''

export interface Playlist { id: string; title: string; episodes: { id: string; title: string }[] }

export async function searchPlaylists(query: string, max = 3): Promise<{ id: string; title: string }[]> {
  const res = await innertube('search', { query, params: 'EgIQAw%3D%3D' }) // playlists only
  return collect<Lockup>(res, 'lockupViewModel')
    .filter(l => l.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST')
    .slice(0, max).map(l => ({ id: l.contentId, title: lockupTitle(l) }))
}

export async function playlistEpisodes(id: string): Promise<{ id: string; title: string }[]> {
  const res = await innertube('browse', { browseId: `VL${id}` })
  return collect<Lockup>(res, 'lockupViewModel')
    .filter(l => l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
    .map(l => ({ id: l.contentId, title: lockupTitle(l) }))
}

const SERIES = /\b(lecture|lec|chapter|part|episode|ep|lesson|session|module|week|day)\s*\.?\s*#?\d+|#\d+\b|\b\d+\s*[:.|-]\s/i

/** Is this title an episode of a series (e.g. "Lecture 5 | MIT 6.832 …")? */
export const looksLikeEpisode = (title: string) => SERIES.test(title)

/** For an episode, find the playlist that contains it, so the app can show the course around it. */
export async function seriesFor(videoId: string, title: string, channel?: string | null): Promise<Playlist | null> {
  const stem = title.replace(SERIES, ' ').replace(/[|:–—-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  const lists = await searchPlaylists(`${channel ?? ''} ${stem}`.trim(), 3)
  for (const pl of lists) {
    const episodes = await playlistEpisodes(pl.id).catch(() => [])
    if (episodes.some(e => e.id === videoId)) return { ...pl, episodes: episodes.slice(0, 80) }
  }
  return null
}

/**
 * Pick the stretch of a long video that best covers the given terms: score ~60 s windows by term hits,
 * then grow around the best window to roughly `targetMin` minutes. Returns null when nothing matches.
 */
export function pickSegment(lines: Line[], terms: string[], targetMin = 20): { start: number; end: number } | null {
  if (!lines.length) return null
  const words = [...new Set(terms.flatMap(t => t.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) ?? []))]
    .filter(w => !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'how', 'what', 'why'].includes(w))
  if (!words.length) return null
  const end = lines[lines.length - 1].t
  const buckets = Math.ceil(end / 60) + 1
  const score = new Array<number>(buckets).fill(0)
  for (const l of lines) {
    const text = l.text.toLowerCase()
    for (const w of words) if (text.includes(w)) score[Math.floor(l.t / 60)] += 1
  }
  const span = Math.max(3, Math.min(targetMin, buckets))
  let best = -1, bestAt = 0
  for (let i = 0; i + span <= buckets; i++) {
    const s = score.slice(i, i + span).reduce((a, b) => a + b, 0)
    if (s > best) { best = s; bestAt = i }
  }
  if (best <= 0) return null
  return { start: bestAt * 60, end: Math.min(end, (bestAt + span) * 60) }
}
