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

/** Compact "[mm:ss] text" form, capped so it fits the fast model's context comfortably. */
export function transcriptToText(lines: Line[], from = 0, to = Infinity, maxChars = 60_000) {
  const out = lines
    .filter(l => l.t >= from && l.t <= to)
    .map(l => `[${Math.floor(l.t / 60)}:${String(Math.floor(l.t % 60)).padStart(2, '0')}] ${l.text}`)
    .join('\n')
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n[transcript truncated]` : out
}
