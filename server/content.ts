// Readable content for in-app units. Tries the cheapest, most faithful route per platform:
// Substack post API → the author's feed (Medium, beehiiv, blogs) → the page's article HTML → Tavily extract.
// Paid posts are detected and kept to their public preview; nothing works around a paywall.
import type { Env } from './env'
import { first, run } from './db'
import { decodeEntities } from './search'
import { discoverFeed, platformOf, stripTags, type Platform } from './feeds'

export interface Readable {
  format: 'html' | 'markdown' | 'none'
  body: string | null
  title: string | null
  author: string | null
  published: string | null
  words: number
  paid: boolean
  via: string
}

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; LearningOS/1.0; personal reader)' }
const MAX_BODY = 400_000
const PAYWALL = [/this post is for paid subscribers/i, /subscribe to (?:continue|keep) reading/i, /member-only story/i, /upgrade to paid/i, /become a (?:paid )?member to read/i, /premium subscribers? only/i]

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length
export const looksPaywalled = (text: string, words: number) => words < 350 && PAYWALL.some(re => re.test(text))

/**
 * Remove scripts, styles, forms, inline handlers and site chrome (nav/header/footer/aside), and make relative
 * links and images absolute so they work inside the app. The client sanitizes again before rendering.
 */
export function cleanHtml(html: string, base?: string) {
  let out = html
    .replace(/<(script|style|noscript|iframe|form|svg|button|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+=["'][^"']*["']/gi, '')
  if (base) {
    out = out.replace(/\s(src|href)=(["'])(?!https?:|data:|mailto:|#)([^"']*)\2/gi, (m, attr, q, url) => {
      try { return ` ${attr}=${q}${new URL(url, base).toString()}${q}` } catch { return m }
    })
  }
  return out.slice(0, MAX_BODY)
}

/** Best-effort main-content extraction from a server-rendered page (no DOM in Workers). */
export function extractArticle(html: string, base?: string): string | null {
  const pick = (re: RegExp) => html.match(re)?.[0] ?? null
  const candidate =
    pick(/<article[\s\S]*?<\/article>/i) ??
    pick(/<div[^>]+(?:id|class)=["'][^"']*(?:content-blocks|post-content|entry-content|article-body|post-body|markdown-body)[^"']*["'][\s\S]*?<\/div>\s*<\/div>/i) ??
    pick(/<main[\s\S]*?<\/main>/i)
  if (candidate && countWords(stripTags(candidate)) > 200) return cleanHtml(candidate, base)
  // Fallback: keep headings, paragraphs, lists and code from the whole page.
  const blocks = [...html.matchAll(/<(h[1-4]|p|pre|blockquote|ul|ol)[\s>][\s\S]*?<\/\1>/gi)].map(m => m[0])
  const joined = blocks.join('\n')
  return countWords(stripTags(joined)) > 200 ? cleanHtml(joined, base) : null
}

async function viaSubstack(url: string): Promise<Readable | null> {
  const u = new URL(url)
  const slug = u.pathname.match(/^\/p\/([^/?#]+)/)?.[1]
  if (!slug) return null
  const res = await fetch(`${u.origin}/api/v1/posts/${slug}`, { headers: UA, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) return null
  const p = await res.json<{ title: string; body_html: string | null; audience: string; post_date: string; wordcount?: number; truncated_body_text?: string; subtitle?: string; publishedBylines?: { name: string }[] }>()
  const paid = p.audience === 'only_paid' || p.audience === 'founding' || !p.body_html
  const preview = p.truncated_body_text ?? p.subtitle ?? ''
  return {
    format: paid ? (preview ? 'markdown' : 'none') : 'html',
    body: paid ? (preview || null) : cleanHtml(p.body_html!, url),
    title: p.title, author: p.publishedBylines?.[0]?.name ?? null, published: p.post_date?.slice(0, 10) ?? null,
    words: p.wordcount ?? countWords(stripTags(p.body_html ?? '')), paid, via: 'substack-api',
  }
}

async function viaFeed(url: string): Promise<Readable | null> {
  const found = await discoverFeed(url)
  const norm = (s: string) => s.replace(/[?#].*$/, '').replace(/\/$/, '')
  const item = found?.feed.items.find(i => norm(i.url) === norm(url) || norm(i.url).endsWith(new URL(url).pathname.replace(/\/$/, '')))
  if (!item?.content) return null
  const text = stripTags(item.content)
  const words = countWords(text)
  const paid = looksPaywalled(text, words)
  return { format: 'html', body: cleanHtml(item.content, url), title: item.title, author: item.author, published: item.published, words, paid, via: 'feed' }
}

async function viaPage(url: string): Promise<Readable | null> {
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(12_000) })
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
  const html = await res.text()
  const body = extractArticle(html, res.url || url)
  if (!body) return null
  const text = stripTags(body)
  const words = countWords(text)
  const meta = (p: string) => decodeEntities(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ?? '') || null
  return {
    format: 'html', body, title: meta('og:title') ?? stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    author: meta('author'), published: meta('article:published_time')?.slice(0, 10) ?? null,
    words, paid: looksPaywalled(stripTags(html).slice(0, 20_000), words), via: 'page',
  }
}

async function viaTavily(env: Env, url: string): Promise<Readable | null> {
  if (!env.TAVILY_API_KEY) return null
  const res = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TAVILY_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ urls: [url], format: 'markdown' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) return null
  const d = await res.json<{ results: { raw_content: string }[] }>()
  const md = d.results?.[0]?.raw_content
  if (!md || countWords(md) < 200) return null
  const words = countWords(md)
  return { format: 'markdown', body: md.slice(0, MAX_BODY), title: null, author: null, published: null, words, paid: looksPaywalled(md, words), via: 'tavily' }
}

/** Fetch (or return cached) readable content for a URL. Never throws; `format: 'none'` means read it on the original site. */
export async function readable(env: Env, url: string, opts: { refresh?: boolean } = {}): Promise<Readable> {
  if (!opts.refresh) {
    const cached = await first<Omit<Readable, 'paid'> & { paid: number }>(env, 'SELECT format, body, title, author, published, words, paid, via FROM contents WHERE url = ?', url)
    if (cached) return { ...cached, paid: Boolean(cached.paid) }
  }
  const platform: Platform = platformOf(url)
  const routes: (() => Promise<Readable | null>)[] = [
    ...(platform === 'substack' || new URL(url).pathname.startsWith('/p/') ? [() => viaSubstack(url)] : []),
    () => viaFeed(url),
    ...(platform === 'medium' ? [] : [() => viaPage(url)]), // Medium pages block bots; its feeds work
    () => viaTavily(env, url),
  ]
  let result: Readable = { format: 'none', body: null, title: null, author: null, published: null, words: 0, paid: false, via: 'none' }
  for (const route of routes) {
    try {
      const r = await route()
      if (r) { result = r; break }
    } catch (e) { console.error('readable route failed', url, e) }
  }
  await run(env,
    `INSERT INTO contents (url, format, body, title, author, published, words, paid, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET format = excluded.format, body = excluded.body, title = excluded.title, author = excluded.author,
       published = excluded.published, words = excluded.words, paid = excluded.paid, via = excluded.via, fetched_at = datetime('now')`,
    url, result.format, result.body, result.title, result.author, result.published, result.words, result.paid ? 1 : 0, result.via)
  return result
}

/** Plain text for question generation, trimmed to fit the model budget. */
export function textFor(r: Readable, maxChars = 12_000) {
  if (!r.body) return ''
  const t = r.format === 'html' ? stripTags(r.body) : r.body
  return t.length > maxChars ? `${t.slice(0, maxChars)} …` : t
}
