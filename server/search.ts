import type { Env } from './env'

/** A real search hit. The curator may only pick from these; it never invents URLs. */
export interface Hit {
  title: string
  url: string
  snippet: string
  source: 'tavily' | 'youtube' | 'arxiv' | 'github'
  author?: string
}

export function searchProviders(env: Env) {
  return { web: Boolean(env.TAVILY_API_KEY), youtube: Boolean(env.YOUTUBE_API_KEY), arxiv: true, github: true }
}

export async function gather(env: Env, webQueries: string[], youtubeQuery: string): Promise<Hit[]> {
  const jobs: Promise<Hit[]>[] = []
  if (env.TAVILY_API_KEY) for (const q of webQueries.slice(0, 2)) jobs.push(tavily(env, q))
  if (webQueries[0]) {
    jobs.push(arxiv(webQueries[0]))
    jobs.push(github(env, webQueries[0]))
  }
  if (env.YOUTUBE_API_KEY && youtubeQuery) jobs.push(youtube(env, youtubeQuery))

  const settled = await Promise.allSettled(jobs)
  const seen = new Set<string>()
  const hits: Hit[] = []
  for (const s of settled) {
    if (s.status === 'rejected') { console.error('search provider failed', s.reason); continue }
    for (const h of s.value) {
      const key = h.url.replace(/[#?].*$/, '').replace(/\/$/, '')
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

export async function youtube(env: Env, query: string, max = 4): Promise<Hit[]> {
  const u = new URL('https://www.googleapis.com/youtube/v3/search')
  u.search = new URLSearchParams({
    part: 'snippet', type: 'video', q: query, maxResults: String(max),
    relevanceLanguage: 'en', videoEmbeddable: 'true', key: env.YOUTUBE_API_KEY!,
  }).toString()
  const res = await fetch(u)
  if (!res.ok) throw new Error(`youtube ${res.status}`)
  const data = await res.json<{ items: { id: { videoId: string }; snippet: { title: string; description: string; channelTitle: string } }[] }>()
  return data.items.map(i => ({
    title: decodeEntities(i.snippet.title),
    url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
    snippet: decodeEntities(i.snippet.description).slice(0, 300),
    author: i.snippet.channelTitle,
    source: 'youtube' as const,
  }))
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
