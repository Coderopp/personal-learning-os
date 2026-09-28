import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import { Card, Empty, ErrorBanner, Spinner } from '../components/ui'

interface VideoRow {
  id: string; title: string; channel: string | null; position: number; duration: number | null
  note_count: number; has_transcript: number; has_ai_notes: number; updated_at: string
}

export const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`
}

export default function Videos() {
  const navigate = useNavigate()
  const { data, loading, error } = useApi<VideoRow[]>('/videos')
  const [url, setUrl] = useState('')
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
          <p className="muted">Timestamped notes, transcript → notes, and "quiz me on the last 10 minutes". Progress syncs between PC and tab.</p>
        </div>
      </header>
      <Card>
        <form className="chat-input" onSubmit={e => { e.preventDefault(); if (url.trim()) open() }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a YouTube link" />
          <button className="primary" disabled={!url.trim() || action.busy}>Open</button>
        </form>
        <ErrorBanner error={action.error} />
        <p className="muted small-text">Agent-suggested videos live in the <Link to="/library?type=video">library</Link>.</p>
      </Card>
      <ErrorBanner error={error} />
      {loading ? <Spinner /> : data?.length ? (
        <div className="grid-cards">
          {data.map(v => (
            <Link key={v.id} to={`/videos/${v.id}`} className="card video-card">
              <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
              {v.duration ? <div className="bar thin"><span style={{ width: `${Math.min(100, (100 * v.position) / v.duration)}%` }} /></div> : null}
              <h3>{v.title}</h3>
              <small className="muted">
                {v.channel}{v.position > 5 ? ` · at ${fmtTime(v.position)}` : ''}{v.note_count ? ` · ${v.note_count} notes` : ''}{v.has_ai_notes ? ' · AI notes' : ''}
              </small>
            </Link>
          ))}
        </div>
      ) : <Empty>No videos yet.</Empty>}
    </div>
  )
}
