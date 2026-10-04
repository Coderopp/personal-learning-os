// Feeds: discovery for any site (Substack, Medium, beehiiv, blogs) and a small RSS/Atom parser.
import { decodeEntities } from './search'

export type Platform = 'substack' | 'medium' | 'beehiiv' | 'blog'

export interface FeedItem { title: string; url: string; published: string | null; author: string | null; summary: string; content: string | null }
export interface Feed { title: string; site_url: string; items: FeedItem[] }

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; LearningOS/1.0; personal reader)' }

export function platformOf(url: string, html?: string): Platform {
  const host = new URL(url).hostname
  if (host.endsWith('substack.com') || html?.includes('substackcdn.com')) return 'substack'
  if (host === 'medium.com' || host.endsWith('.medium.com') || html?.includes('cdn-client.medium.com')) return 'medium'
  if (host.endsWith('beehiiv.com') || html?.includes('beehiiv')) return 'beehiiv'
  return 'blog'
}

/** Candidate feed URLs for a site/page URL, most likely first. */
export function feedCandidates(input: string, html?: string): string[] {
  const u = new URL(input)
  const out: string[] = []
  if (u.hostname === 'medium.com') {
    const seg = u.pathname.split('/').filter(Boolean)[0]
    if (seg) out.push(`https://medium.com/feed/${seg}`)
  } else if (u.hostname.endsWith('.medium.com')) {
    out.push(`https://${u.hostname}/feed`)
  }
  if (html) {
    for (const m of html.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)) {
      const href = m[0].match(/href=["']([^"']+)["']/i)?.[1]
      if (href) out.push(new URL(decodeEntities(href), u).toString())
    }
  }
  for (const p of ['/feed', '/rss', '/feed.xml', '/atom.xml', '/index.xml', '/rss.xml']) out.push(`${u.origin}${p}`)
  return [...new Set(out)]
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  if (!m) return null
  return m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()
}
const attr = (xml: string, name: string, a: string) =>
  xml.match(new RegExp(`<${name}[^>]*\\s${a}=["']([^"']+)["'][^>]*>`, 'i'))?.[1] ?? null
const toIso = (d: string | null) => {
  if (!d) return null
  const t = Date.parse(d)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}
export const stripTags = (html: string) =>
  decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Parse RSS 2.0 or Atom. Returns null if the text isn't a feed. */
export function parseFeed(xml: string, feedUrl: string): Feed | null {
  if (!/<(rss|feed)[\s>]/i.test(xml)) return null
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml)
  const head = xml.split(isAtom ? /<entry[\s>]/i : /<item[\s>]/i)[0]
  const title = decodeEntities(stripTags(tag(head, 'title') ?? 'Untitled feed'))
  const site = isAtom ? (attr(head, 'link[^>]*rel=["\']alternate["\']', 'href') ?? attr(head, 'link', 'href')) : tag(head, 'link')
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map(m => m[0])
  const items = blocks.map(b => {
    const link = isAtom ? (attr(b, 'link[^>]*rel=["\']alternate["\']', 'href') ?? attr(b, 'link', 'href')) : tag(b, 'link')
    const content = tag(b, 'content:encoded') ?? (isAtom ? tag(b, 'content') : null)
    const summary = tag(b, 'description') ?? tag(b, 'summary') ?? ''
    return {
      title: decodeEntities(stripTags(tag(b, 'title') ?? '')),
      url: decodeEntities(link ?? '').trim(),
      published: toIso(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date')),
      author: (() => { const a = tag(b, 'dc:creator') ?? tag(b, 'author'); return a ? decodeEntities(stripTags(a)) : null })(),
      summary: stripTags(decodeEntities(summary)).slice(0, 400),
      content: content ? decodeEntities(content) : null,
    }
  }).filter(i => i.url && i.title)
  return { title, site_url: site ? decodeEntities(site) : new URL(feedUrl).origin, items }
}

/** Find and parse the feed for any site or post URL. */
export async function discoverFeed(input: string): Promise<{ feed_url: string; feed: Feed; platform: Platform } | null> {
  let html = ''
  try {
    const res = await fetch(input, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(10_000) })
    const text = await res.text()
    const direct = parseFeed(text, input)
    if (direct) return { feed_url: input, feed: direct, platform: platformOf(input, text) }
    html = text
  } catch { /* fall through to conventional paths */ }
  for (const candidate of feedCandidates(input, html)) {
    try {
      const res = await fetch(candidate, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const feed = parseFeed(await res.text(), candidate)
      if (feed?.items.length) return { feed_url: candidate, feed, platform: platformOf(candidate, html) }
    } catch { /* try next */ }
  }
  return null
}

export async function fetchFeed(feedUrl: string): Promise<Feed | null> {
  const res = await fetch(feedUrl, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`feed ${res.status}`)
  return parseFeed(await res.text(), feedUrl)
}
