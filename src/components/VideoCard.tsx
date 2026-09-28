import { useNavigate } from 'react-router-dom'
import { api, useAction } from '../lib/api'
import type { Resource } from '../lib/types'
import { fmtTime } from '../lib/time'
import { Chip, ErrorBanner } from './ui'

export const videoIdOf = (url: string) => url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1] ?? null

const compact = (n: number) => Intl.NumberFormat(undefined, { notation: 'compact' }).format(n)

/** A curated video: thumbnail first, then why it exists. Candidates can be approved or rejected in place. */
export function VideoCard({ r, onChange, progress }: {
  r: Pick<Resource, 'id' | 'title' | 'url' | 'author' | 'duration_s' | 'views' | 'reason' | 'status'> & Partial<Pick<Resource, 'mission_id' | 'competency_id'>>
  onChange?: () => void
  progress?: number | null
}) {
  const navigate = useNavigate()
  const action = useAction()
  const vid = videoIdOf(r.url)

  const watch = () => action.run(async () => {
    const v = await api<{ id: string }>('/videos', { body: { url: r.url, mission_id: r.mission_id, competency_id: r.competency_id } })
    navigate(`/videos/${v.id}`)
  })
  const setStatus = (status: Resource['status']) => action.run(async () => {
    await api(`/resources/${r.id}`, { method: 'PATCH', body: { status } })
    onChange?.()
  })

  return (
    <article className={`card video-card ${r.status}`}>
      <button className="thumb" onClick={watch} aria-label={`Watch ${r.title}`}>
        {vid && <img src={`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`} alt="" loading="lazy" />}
        {r.duration_s ? <span className="duration">{fmtTime(r.duration_s)}</span> : null}
      </button>
      {progress != null && progress > 0 && <div className="bar thin"><span style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>}
      <div className="video-body">
        <h3>{r.title}</h3>
        <small className="muted">{[r.author, r.views ? `${compact(r.views)} views` : null].filter(Boolean).join(' · ')}</small>
        <p className="reason">{r.reason}</p>
        <ErrorBanner error={action.error} />
        <div className="actions">
          {r.status === 'candidate' ? (
            <>
              <button className="primary small" disabled={action.busy} onClick={() => setStatus('accepted')}>Approve</button>
              <button className="ghost small" disabled={action.busy} onClick={() => setStatus('rejected')}>Reject</button>
              <Chip tone="warn">candidate</Chip>
            </>
          ) : <button className="secondary small" disabled={action.busy} onClick={watch}>▶ Watch with notes</button>}
        </div>
      </div>
    </article>
  )
}
