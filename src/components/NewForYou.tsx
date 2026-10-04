import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { FeedPost } from '../lib/types'
import { Card, Chip, ErrorBanner } from './ui'

const ago = (d: string | null) => {
  if (!d) return ''
  const days = Math.round((Date.now() - Date.parse(d)) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : d.slice(0, 7)
}

/** A followed post: open it in the reader, add it to a path as "Latest", or dismiss. */
export function PostRow({ post, onChange, allCompetencies }: { post: FeedPost; onChange: () => void; allCompetencies?: { id: string; name: string }[] }) {
  const navigate = useNavigate()
  const [picking, setPicking] = useState(false)
  const action = useAction()
  const add = (competencyId: string) => action.run(async () => {
    await api(`/feeds/items/${post.id}/add`, { body: { competency_id: competencyId } })
    onChange()
  })
  const options = post.matches.length ? post.matches : (allCompetencies ?? []).map(c => ({ competency_id: c.id, name: c.name, mission_id: '' }))
  return (
    <li className="post-row">
      <div className="stack-tight">
        <a href={post.url} target="_blank" rel="noreferrer"><strong>{post.title}</strong></a>
        <small className="muted">{post.feed_title} · {post.platform} · {ago(post.published)}{post.paid ? ' · paid (preview)' : ''}</small>
        {post.matches.length > 0 && (
          <small>{post.matches.map(m => <span key={m.competency_id} className="match">→ <b>{m.name}</b>{m.why ? `: ${m.why}` : ''}</span>)}</small>
        )}
      </div>
      <ErrorBanner error={action.error} />
      <div className="row-actions wrap">
        {post.status === 'added' ? <Chip tone="good">in a path</Chip> : picking || options.length === 1 ? (
          options.slice(0, 6).map(o => (
            <button key={o.competency_id} className="secondary small" disabled={action.busy} onClick={() => add(o.competency_id)}>+ {o.name}</button>
          ))
        ) : options.length > 0 && <button className="secondary small" onClick={() => setPicking(true)}>+ Add to path</button>}
        {post.status === 'new' && (
          <button className="ghost small" disabled={action.busy} onClick={() => action.run(async () => { await api(`/feeds/items/${post.id}`, { method: 'PATCH', body: { status: 'dismissed' } }); onChange() })}>Dismiss</button>
        )}
        {post.status === 'added' && <button className="ghost small" onClick={() => navigate('/missions')}>Open path</button>}
      </div>
    </li>
  )
}

/** Today: new posts from followed writers that match your competencies. */
export function NewForYou() {
  const { data, reload } = useApi<FeedPost[]>('/feeds/items?status=new&matched=1&limit=4')
  if (!data?.length) return null
  return (
    <Card title="New for you" subtitle="From writers you follow, matched to your skills" actions={<Link to="/sources" className="link">Sources</Link>}>
      <ul className="list">{data.map(p => <PostRow key={p.id} post={p} onChange={reload} />)}</ul>
    </Card>
  )
}
