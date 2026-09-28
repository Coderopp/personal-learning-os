import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { Moment, Resource } from '../lib/types'
import { Card, Empty, ErrorBanner, Spinner } from '../components/ui'
import { VideoCard } from '../components/VideoCard'
import { fmtTime } from '../lib/time'

interface VideoRow {
  id: string; title: string; channel: string | null; position: number; duration: number | null
  note_count: number; has_transcript: number; has_ai_notes: number; updated_at: string
}

interface Suggested {
  competency: { id: string; name: string } | null
  videos: (Pick<Resource, 'id' | 'title' | 'url' | 'author' | 'duration_s' | 'reason'> & { video_id: string | null; position: number | null; duration: number | null })[]
}

/** Transcript search results: each hit jumps straight to the moment. */
export function MomentList({ moments, showTitle = true }: { moments: Moment[]; showTitle?: boolean }) {
  return (
    <ul className="moments">
      {moments.map((m, i) => (
        <li key={`${m.video_id}-${m.t}-${i}`}>
          <Link className="stamp" to={`/videos/${m.video_id}?t=${Math.floor(m.t)}`}>{fmtTime(m.t)}</Link>
          <div>
            {showTitle && <strong>{m.title}</strong>}
            {/* snippet() marks matches with **…** */}
            <p className="muted">{m.snippet.split('**').map((part, j) => (j % 2 ? <mark key={j}>{part}</mark> : part))}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function Videos() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [query, setQuery] = useState(q)
  const [url, setUrl] = useState('')
  const { data, loading, error } = useApi<VideoRow[]>('/videos')
  const suggested = useApi<Suggested>('/videos/suggested')
  const results = useApi<Moment[]>(q ? `/videos/search?q=${encodeURIComponent(q)}` : null)
  const action = useAction()
  const open = () => action.run(async () => {
    const v = await api<{ id: string }>('/videos', { body: { url } })
    navigate(`/videos/${v.id}`)
  })

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Video</span>
          <h1>Watch actively</h1>
          <p className="muted">Search inside everything you've saved, take timestamped notes, and quiz yourself on what you just watched. Progress syncs between PC and tab.</p>
        </div>
      </header>

      <Card>
        <form className="chat-input" onSubmit={e => { e.preventDefault(); setParams(query.trim() ? { q: query.trim() } : {}) }}>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search inside your videos, e.g. “kv cache memory”" />
          <button className="primary">Search</button>
        </form>
        {q && (
          results.loading ? <Spinner /> : results.data?.length
            ? <MomentList moments={results.data} />
            : <p className="muted">No moments match “{q}”. Only videos with a transcript are searchable; open a video and use “Transcript → notes” to add one.</p>
        )}
        <ErrorBanner error={results.error} />
      </Card>

      {suggested.data?.competency && suggested.data.videos.length > 0 && (
        <section className="stack">
          <h2>For your bottleneck: {suggested.data.competency.name}</h2>
          <div className="grid-cards">
            {suggested.data.videos.map(v => (
              <VideoCard key={v.id} r={{ ...v, views: null, status: 'accepted' }}
                progress={v.position && v.duration ? v.position / v.duration : null} />
            ))}
          </div>
        </section>
      )}

      <Card title="Open any video">
        <form className="chat-input" onSubmit={e => { e.preventDefault(); if (url.trim()) open() }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a YouTube link" />
          <button className="secondary" disabled={!url.trim() || action.busy}>Open</button>
        </form>
        <ErrorBanner error={action.error} />
        <p className="muted small-text">The agent's picks live on each competency's <b>Videos</b> tab and in the <Link to="/library?type=video">library</Link>.</p>
      </Card>

      <ErrorBanner error={error} />
      <h2>Recently watched</h2>
      {loading ? <Spinner /> : data?.length ? (
        <div className="grid-cards">
          {data.map(v => (
            <Link key={v.id} to={`/videos/${v.id}`} className="card video-card">
              <span className="thumb"><img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" /></span>
              {v.duration ? <div className="bar thin"><span style={{ width: `${Math.min(100, (100 * v.position) / v.duration)}%` }} /></div> : null}
              <div className="video-body">
                <h3>{v.title}</h3>
                <small className="muted">
                  {v.channel}{v.position > 5 ? ` · at ${fmtTime(v.position)}` : ''}{v.note_count ? ` · ${v.note_count} notes` : ''}
                  {v.has_transcript ? ' · searchable' : ''}
                </small>
              </div>
            </Link>
          ))}
        </div>
      ) : <Empty>No videos yet.</Empty>}
    </div>
  )
}
