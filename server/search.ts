import type { Env } from './env'

/** A real search hit. The curator may only pick from these; it never invents URLs. */
export interface Hit {
  title: string
  url: string
  snippet: string
  source: 'tavily' | 'youtube' | 'arxiv' | 'github'
  author?: string
  duration_s?: number
  views?: number
  published?: string
}

export function searchProviders(env: Env) {
  // YouTube works without a key (InnerTube); the official API is used when a key is configured.
  return { web: Boolean(env.TAVILY_API_KEY), youtube: true, youtube_api: Boolean(env.YOUTUBE_API_KEY), arxiv: true, github: true }
}

export async function gather(env: Env, webQueries: string[], youtubeQuery: string, only?: 'video'): Promise<Hit[]> {
  const jobs: Promise<Hit[]>[] = []
  if (only !== 'video') {
    if (env.TAVILY_API_KEY) for (const q of webQueries.slice(0, 2)) jobs.push(tavily(env, q))
    if (webQueries[0]) {
      jobs.push(arxiv(webQueries[0]))
      jobs.push(github(env, webQueries[0]))
    }
  }
  if (youtubeQuery) jobs.push(youtube(env, youtubeQuery, only === 'video' ? 10 : 6))

  const settled = await Promise.allSettled(jobs)
  const seen = new Set<string>()
  const hits: Hit[] = []
  for (const s of settled) {
    if (s.status === 'rejected') { console.error('search provider failed', s.reason); continue }
    for (const h of s.value) {
      // YouTube URLs differ only in ?v=, so key them by video id; other URLs by path.
      const key = h.url.match(/[?&]v=([\w-]{11})/)?.[1] ?? h.url.replace(/[#?].*$/, '').replace(/\/$/, '')
      if (!seen.has(key)) { seen.add(key); hits.push(h) }
    }
  }
  return hits
}

async function tavily(env: Env, query: string): Promise<Hit[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TAVILY_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, max_results: 6, search_depth: 'basic' }),
  })
  if (!res.ok) throw new Error(`tavily ${res.status}`)
  const data = await res.json<{ results: { title: string; url: string; content: string }[] }>()
  return data.results.map(r => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 400), source: 'tavily' as const }))
}

/** Official Data API when a key is set; otherwise YouTube's own (keyless) search endpoint. */
export async function youtube(env: Env, query: string, max = 6): Promise<Hit[]> {
  if (env.YOUTUBE_API_KEY) {
    try { return await youtubeDataApi(env, query, max) } catch (e) { console.error('youtube data api failed, falling back', e) }
  }
  return youtubeKeyless(query, max)
}

async function youtubeDataApi(env: Env, query: string, max: number): Promise<Hit[]> {
  const u = new URL('https://www.googleapis.com/youtube/v3/search')
  u.search = new URLSearchParams({
    part: 'snippet', type: 'video', q: query, maxResults: String(max),
    relevanceLanguage: 'en', videoEmbeddable: 'true', key: env.YOUTUBE_API_KEY!,
  }).toString()
  const res = await fetch(u)
  if (!res.ok) throw new Error(`youtube ${res.status}`)
  const data = await res.json<{ items: { id: { videoId: string }; snippet: { title: string; description: string; channelTitle: string; publishedAt: string } }[] }>()
  const ids = data.items.map(i => i.id.videoId)
  // One extra quota unit buys duration and views, which the curator needs to judge quality.
  const details = new Map<string, { duration: string; views: string }>()
  if (ids.length) {
    const d = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids.join(',')}&key=${env.YOUTUBE_API_KEY}`)
    if (d.ok) {
      const dd = await d.json<{ items: { id: string; contentDetails: { duration: string }; statistics: { viewCount?: string } }[] }>()
      for (const it of dd.items) details.set(it.id, { duration: it.contentDetails.duration, views: it.statistics.viewCount ?? '0' })
    }
  }
  return data.items.map(i => ({
    title: decodeEntities(i.snippet.title),
    url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
    snippet: decodeEntities(i.snippet.description).slice(0, 300),
    author: i.snippet.channelTitle,
    duration_s: isoDuration(details.get(i.id.videoId)?.duration),
    views: Number(details.get(i.id.videoId)?.views ?? 0) || undefined,
    published: i.snippet.publishedAt.slice(0, 10),
    source: 'youtube' as const,
  }))
}

interface VideoRenderer {
  videoId: string
  title?: { runs?: { text: string }[] }
  ownerText?: { runs?: { text: string }[] }
  lengthText?: { simpleText?: string }
  viewCountText?: { simpleText?: string }
  publishedTimeText?: { simpleText?: string }
  detailedMetadataSnippets?: { snippetText?: { runs?: { text: string }[] } }[]
}

async function youtubeKeyless(query: string, max: number): Promise<Hit[]> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // params = "videos only" filter
    body: JSON.stringify({ query, params: 'EgIQAQ%3D%3D', context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en' } } }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`youtube keyless ${res.status}`)
  const found: VideoRenderer[] = []
  const walk = (o: unknown): void => {
    if (found.length >= max || !o || typeof o !== 'object') return
    if (Array.isArray(o)) { o.forEach(walk); return }
    const rec = o as Record<string, unknown>
    if (rec.videoRenderer) { found.push(rec.videoRenderer as VideoRenderer); return }
    Object.values(rec).forEach(walk)
  }
  walk(await res.json())
  return found.filter(v => v.videoId && v.lengthText?.simpleText).map(v => ({
    title: v.title?.runs?.map(r => r.text).join('') ?? 'YouTube video',
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    snippet: v.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map(r => r.text).join('').slice(0, 300) ?? '',
    author: v.ownerText?.runs?.[0]?.text,
    duration_s: clockToSeconds(v.lengthText?.simpleText),
    views: Number(v.viewCountText?.simpleText?.replace(/[^\d]/g, '')) || undefined,
    published: v.publishedTimeText?.simpleText,
    source: 'youtube' as const,
  }))
}

const clockToSeconds = (s?: string) => (s ? s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0) : undefined)

function isoDuration(s?: string) {
  const m = s?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : undefined
}

async function arxiv(query: string): Promise<Hit[]> {
  const q = query.split(/\s+/).filter(w => w.length > 2).slice(0, 6).map(w => `all:${w.replace(/[^\w-]/g, '')}`).join('+AND+')
  const res = await fetch(`https://export.arxiv.org/api/query?search_query=${q}&max_results=3&sortBy=relevance`)
  if (!res.ok) throw new Error(`arxiv ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    title: tag(e, 'title').replace(/\s+/g, ' '),
    url: tag(e, 'id').replace('http://', 'https://'),
    snippet: tag(e, 'summary').replace(/\s+/g, ' ').slice(0, 400),
    author: [...e.matchAll(/<name>(.*?)<\/name>/g)].slice(0, 3).map(m => m[1]).join(', '),
    source: 'arxiv' as const,
  }))
}

async function github(env: Env, query: string): Promise<Hit[]> {
  const q = encodeURIComponent(query.split(/\s+/).slice(0, 5).join(' '))
  const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=3`, {
    headers: {
      'user-agent': 'personal-learning-os',
      accept: 'application/vnd.github+json',
      ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`github ${res.status}`)
  const data = await res.json<{ items: { full_name: string; html_url: string; description: string | null; stargazers_count: number }[] }>()
  return data.items.map(r => ({
    title: r.full_name,
    url: r.html_url,
    snippet: `${r.description ?? ''} (${r.stargazers_count.toLocaleString()} stars)`,
    source: 'github' as const,
  }))
}

const tag = (xml: string, name: string) => decodeEntities(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? '')

export const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
