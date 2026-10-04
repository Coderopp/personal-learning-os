import { useState } from 'react'
import { api, useAction, useApi } from '../lib/api'
import type { Feed, FeedPost } from '../lib/types'
import { Card, Chip, Empty, ErrorBanner, Spinner } from '../components/ui'
import { PostRow } from '../components/NewForYou'

const SUGGESTED = [
  { url: 'https://cameronrwolfe.substack.com', label: 'Cameron R. Wolfe: Deep (Learning) Focus', note: 'LLM research, evals, RL' },
  { url: 'https://eugeneyan.com', label: 'Eugene Yan', note: 'Applied ML/LLM systems, evals' },
  { url: 'https://simonwillison.net', label: 'Simon Willison', note: 'LLM tooling, daily' },
  { url: 'https://www.latent.space', label: 'Latent Space', note: 'AI engineering' },
  { url: 'https://www.lennysnewsletter.com', label: "Lenny's Newsletter", note: 'Product management (many posts paid)' },
  { url: 'https://medium.com/@karpathy', label: 'Andrej Karpathy (Medium)', note: 'Deep learning from first principles' },
]

export default function Sources() {
  const feeds = useApi<Feed[]>('/feeds')
  const [tab, setTab] = useState<'matched' | 'all'>('matched')
  const [feedFilter, setFeedFilter] = useState('')
  const items = useApi<FeedPost[]>(`/feeds/items?${tab === 'matched' ? 'matched=1&' : ''}${feedFilter ? `feed=${feedFilter}&` : ''}limit=60`)
  const graph = useApi<{ competencies: { id: string; name: string }[] }>('/graph')
  const [url, setUrl] = useState('')
  const follow = useAction()
  const refresh = useAction()
  const reloadAll = () => { feeds.reload(); items.reload() }

  const add = (u: string) => follow.run(async () => {
    await api('/feeds', { body: { url: u } })
    setUrl('')
    reloadAll()
  })
  const followed = new Set(feeds.data?.map(f => new URL(f.site_url).hostname.replace(/^www\./, '')) ?? [])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Sources</span>
          <h1>Writers you follow</h1>
          <p className="muted">Substack, Medium, beehiiv or any blog with a feed. New posts are checked daily, matched to your skills, and can join a path as its <b>Latest</b> step.</p>
        </div>
        <button className="secondary" disabled={refresh.busy} onClick={() => refresh.run(async () => { await api('/feeds/refresh', { body: {} }); reloadAll() })}>
          {refresh.busy ? 'Checking…' : 'Check now'}
        </button>
      </header>

      <Card title="Follow a writer" subtitle="Paste a newsletter, Medium profile (medium.com/@name), blog, or any post from it">
        <form className="chat-input" onSubmit={e => { e.preventDefault(); if (url.trim()) add(url.trim()) }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.substack.com" />
          <button className="primary" disabled={!url.trim() || follow.busy}>{follow.busy ? 'Finding feed…' : 'Follow'}</button>
        </form>
        <ErrorBanner error={follow.error ?? refresh.error} />
        <div className="suggested">
          {SUGGESTED.filter(s => !followed.has(new URL(s.url).hostname.replace(/^www\./, ''))).map(s => (
            <button key={s.url} className="ghost small suggest" disabled={follow.busy} onClick={() => add(s.url)} title={s.note}>+ {s.label}</button>
          ))}
        </div>
      </Card>

      <div className="grid-2 wide-left">
        <section className="card">
          <div className="tabs">
            <button className={tab === 'matched' ? 'on' : ''} onClick={() => setTab('matched')}>Matched to my skills</button>
            <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All posts</button>
          </div>
          {items.loading && !items.data ? <Spinner /> : items.data?.length ? (
            <ul className="list">{items.data.map(p => <PostRow key={p.id} post={p} onChange={items.reload} allCompetencies={graph.data?.competencies} />)}</ul>
          ) : <Empty>{tab === 'matched' ? 'No matched posts yet. Follow a few writers in your fields.' : 'No posts yet.'}</Empty>}
        </section>
        <Card title={`Following (${feeds.data?.length ?? 0})`}>
          <ul className="list">
            {feeds.data?.map(f => (
              <li key={f.id}>
                <div>
                  <button className="link" onClick={() => { setFeedFilter(f.id === feedFilter ? '' : f.id); setTab('all') }}><strong>{f.title}</strong></button>
                  <small className="muted">{f.platform} · {f.items} posts{f.unread ? ` · ${f.unread} new` : ''}{f.last_error ? ' · last check failed' : ''}</small>
                </div>
                <div className="row-actions">
                  {feedFilter === f.id && <Chip tone="info">filtered</Chip>}
                  <button className="ghost small" onClick={() => follow.run(async () => { await api(`/feeds/${f.id}`, { method: 'DELETE' }); reloadAll() })}>Unfollow</button>
                </div>
              </li>
            ))}
            {!feeds.data?.length && <li className="muted">Not following anyone yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  )
}
