import { Hono } from 'hono'
import { type AppEnv, type Env, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run } from '../db'
import { discoverFeed, fetchFeed, type FeedItem, stripTags } from '../feeds'
import { cleanHtml, countWords, looksPaywalled } from '../content'
import { sourceOf } from './paths'
import { llm, SCHEMAS } from '../llm'

export const feeds = new Hono<AppEnv>()

interface Target { competency_id: string; name: string; mission_id: string; terms: string[] }

const STOP = new Set('the and for with from that this into your you are how what why when using use build building learn learning guide intro introduction part new best 2025 2026 vs'.split(' '))
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9+.-]{2,}/g) ?? []).filter(w => !STOP.has(w))

/** Terms per competency of active missions: its name, description keywords and concept tags. */
async function targets(env: Env): Promise<Target[]> {
  const comps = await all<{ id: string; name: string; description: string; mission_id: string; concepts: string | null }>(env,
    `SELECT k.id, k.name, k.description, k.mission_id,
       (SELECT GROUP_CONCAT(c.name, '|') FROM competency_concepts cc JOIN concepts c ON c.id = cc.concept_id WHERE cc.competency_id = k.id) AS concepts
     FROM competencies k JOIN missions m ON m.id = k.mission_id WHERE m.status != 'archived'`)
  return comps.map(k => ({
    competency_id: k.id, name: k.name, mission_id: k.mission_id,
    terms: [...new Set([...words(k.name), ...(k.concepts ?? '').split('|').filter(Boolean).map(c => c.toLowerCase()), ...words(k.description).slice(0, 8)])],
  }))
}

/** Score a post against each competency by term hits (multi-word concepts count double). No LLM: free and instant. */
export function matchItem(item: { title: string; summary: string }, tg: Target[]) {
  const text = `${item.title} ${item.title} ${item.summary}`.toLowerCase()
  return tg.map(t => ({
    competency_id: t.competency_id, name: t.name, mission_id: t.mission_id,
    score: t.terms.reduce((s, term) => s + (text.includes(term) ? (term.includes(' ') ? 2 : 1) : 0), 0),
  })).filter(m => m.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3)
}

/**
 * Relevance by one fast-model call per batch (posts arrive a few a day, so this is cheap); keyword overlap is only a
 * fallback when the model is unavailable, because shared buzzwords ("python", "agents") produced false matches.
 */
async function matchBatch(env: Env, items: FeedItem[], tg: Target[]) {
  const byId = new Map(tg.map(t => [t.competency_id, t]))
  try {
    const out = await llm<{ posts: { index: number; matches: { competency_id: string; why: string }[] }[] }>(env, {
      prompt: 'feed-matcher', schema: SCHEMAS.feedMatches,
      input: {
        competencies: tg.map(t => ({ id: t.competency_id, name: t.name, mission: t.mission_id })),
        posts: items.map((it, index) => ({ index, title: it.title, summary: it.summary.slice(0, 240) })),
      },
    })
    return items.map((_, i) => (out.posts.find(p => p.index === i)?.matches ?? [])
      .filter(m => byId.has(m.competency_id)).slice(0, 2)
      .map(m => ({ competency_id: m.competency_id, name: byId.get(m.competency_id)!.name, mission_id: byId.get(m.competency_id)!.mission_id, why: m.why })))
  } catch (e) {
    console.error('feed matcher failed, using keywords', e)
    return items.map(it => matchItem(it, tg).filter(m => m.score >= 3))
  }
}

async function storeItems(env: Env, feedId: string, items: FeedItem[], tg: Target[], max: number) {
  let added = 0
  const fresh = []
  for (const it of items.slice(0, max)) {
    if (!(await first(env, 'SELECT 1 AS x FROM feed_items WHERE url = ?', it.url))) fresh.push(it)
  }
  const matches = fresh.length && tg.length ? await matchBatch(env, fresh, tg) : fresh.map(() => [])
  for (const [k, it] of fresh.entries()) {
    const text = it.content ? stripTags(it.content) : it.summary
    const paid = it.content ? looksPaywalled(text, countWords(text)) : false
    const res = await run(env,
      `INSERT OR IGNORE INTO feed_items (id, feed_id, url, title, author, published, summary, paid, matches) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('fi'), feedId, it.url, it.title, it.author, it.published, it.summary, paid ? 1 : 0, JSON.stringify(matches[k] ?? []))
    added += res.meta.changes ?? 0
    // Feed content is the best readable copy (Medium/beehiiv pages often block fetching): cache it for the reader.
    if (it.content) {
      await run(env, `INSERT OR IGNORE INTO contents (url, format, body, title, author, published, words, paid, via) VALUES (?, 'html', ?, ?, ?, ?, ?, ?, 'feed')`,
        it.url, cleanHtml(it.content, it.url), it.title, it.author, it.published, countWords(text), paid ? 1 : 0)
    }
  }
  return added
}

/** Daily: fetch every followed feed, store new posts, match them to your competencies. */
export async function pollFeeds(env: Env) {
  const list = await all<{ id: string; feed_url: string }>(env, 'SELECT id, feed_url FROM feeds')
  const tg = await targets(env)
  let added = 0
  for (const f of list) {
    try {
      const feed = await fetchFeed(f.feed_url)
      added += feed ? await storeItems(env, f.id, feed.items, tg, 15) : 0
      await run(env, 'UPDATE feeds SET last_checked_at = ?, last_error = NULL WHERE id = ?', nowIso(), f.id)
    } catch (e) {
      await run(env, 'UPDATE feeds SET last_checked_at = ?, last_error = ? WHERE id = ?', nowIso(), String(e).slice(0, 200), f.id)
    }
  }
  return { feeds: list.length, added }
}

feeds.get('/feeds', async c => c.json(await all(c.env,
  `SELECT f.*, (SELECT COUNT(*) FROM feed_items i WHERE i.feed_id = f.id) AS items,
     (SELECT COUNT(*) FROM feed_items i WHERE i.feed_id = f.id AND i.status = 'new') AS unread
   FROM feeds f ORDER BY f.created_at DESC`)))

/** Follow any site: Substack, Medium (@user or publication), beehiiv, or a blog. The feed is discovered automatically. */
feeds.post('/feeds', async c => {
  const { url } = await c.req.json<{ url: string }>()
  let u: URL
  try { u = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`) } catch { throw new UserFacingError('That is not a valid URL') }
  // A post URL works too: follow its publication.
  const site = /\/p\/|\/\d{4}\/|medium\.com\/@[^/]+\/./.test(u.pathname) && !u.hostname.endsWith('medium.com') ? u.origin : u.toString()
  const found = await discoverFeed(site)
  if (!found) throw new UserFacingError('Could not find a feed (RSS/Atom) for that site.', 404)
  const existing = await first<{ id: string }>(c.env, 'SELECT id FROM feeds WHERE feed_url = ?', found.feed_url)
  if (existing) return c.json({ id: existing.id, already: true })
  const id = newId('feed')
  await run(c.env, 'INSERT INTO feeds (id, feed_url, site_url, title, platform, last_checked_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, found.feed_url, found.feed.site_url, found.feed.title.slice(0, 120), found.platform, nowIso())
  const added = await storeItems(c.env, id, found.feed.items, await targets(c.env), 10)
  return c.json({ id, title: found.feed.title, platform: found.platform, added })
})

feeds.delete('/feeds/:id', async c => {
  await run(c.env, 'DELETE FROM feed_items WHERE feed_id = ?', c.req.param('id'))
  await run(c.env, 'DELETE FROM feeds WHERE id = ?', c.req.param('id'))
  return c.json({ ok: true })
})

feeds.post('/feeds/refresh', async c => c.json(await pollFeeds(c.env)))

feeds.get('/feeds/items', async c => {
  const q = c.req.query()
  const rows = await all(c.env,
    `SELECT i.*, f.title AS feed_title, f.platform FROM feed_items i JOIN feeds f ON f.id = i.feed_id
     WHERE (? IS NULL OR i.status = ?) AND (? IS NULL OR i.feed_id = ?) AND (? IS NULL OR i.matches != '[]')
     ORDER BY COALESCE(i.published, i.created_at) DESC LIMIT ?`,
    q.status ?? null, q.status ?? null, q.feed ?? null, q.feed ?? null, q.matched ? 1 : null, Math.min(100, Number(q.limit ?? 50)))
  return c.json(rows.map(r => parseJson(r, ['matches'])))
})

feeds.patch('/feeds/items/:id', async c => {
  const { status } = await c.req.json<{ status: string }>()
  if (!['new', 'added', 'dismissed', 'read'].includes(status)) throw new UserFacingError('Invalid status')
  await run(c.env, 'UPDATE feed_items SET status = ? WHERE id = ?', status, c.req.param('id'))
  return c.json({ ok: true })
})

/** Put a followed post into a competency's path as its "Latest" step (the previous latest moves to the bench). */
feeds.post('/feeds/items/:id/add', async c => {
  const { competency_id } = await c.req.json<{ competency_id: string }>()
  const it = await first<{ id: string; url: string; title: string; author: string | null; published: string | null; summary: string; feed_title: string }>(c.env,
    'SELECT i.*, f.title AS feed_title FROM feed_items i JOIN feeds f ON f.id = i.feed_id WHERE i.id = ?', c.req.param('id'))
  if (!it) throw new UserFacingError('Post not found', 404)
  const comp = await first<{ mission_id: string; name: string }>(c.env, 'SELECT mission_id, name FROM competencies WHERE id = ?', competency_id)
  if (!comp) throw new UserFacingError('Competency not found', 404)
  let path = await first<{ id: string }>(c.env, 'SELECT id FROM paths WHERE competency_id = ?', competency_id)
  if (!path) {
    path = { id: newId('path') }
    await run(c.env, 'INSERT INTO paths (id, mission_id, competency_id, rationale) VALUES (?, ?, ?, ?)', path.id, comp.mission_id, competency_id, 'Started from a followed post.')
  }
  await run(c.env, `UPDATE units SET role = 'bench', position = 9 WHERE path_id = ? AND role = 'latest'`, path.id)
  await run(c.env,
    `INSERT INTO units (id, path_id, mission_id, competency_id, role, position, kind, title, url, source, author, publication, published, minutes, why)
     VALUES (?, ?, ?, ?, 'latest', 3, 'read', ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('unit'), path.id, comp.mission_id, competency_id, it.title, it.url, sourceOf(it.url), it.author, it.feed_title, it.published, 15,
    `Brings in current practice on ${comp.name} from ${it.feed_title}.`)
  await run(c.env, `UPDATE feed_items SET status = 'added' WHERE id = ?`, it.id)
  return c.json({ ok: true, path_id: path.id })
})
