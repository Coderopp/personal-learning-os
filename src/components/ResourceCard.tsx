import { useNavigate } from 'react-router-dom'
import { api, useAction } from '../lib/api'
import type { Resource } from '../lib/types'
import { Chip, ErrorBanner } from './ui'

const isVideo = (r: Resource) => r.type === 'video' || /youtube\.com|youtu\.be/.test(r.url)

export function ResourceCard({ r, onChange, showMission }: { r: Resource; onChange: () => void; showMission?: boolean }) {
  const navigate = useNavigate()
  const action = useAction()

  const setStatus = (status: Resource['status']) => action.run(async () => {
    await api(`/resources/${r.id}`, { method: 'PATCH', body: { status } })
    onChange()
  })

  const watch = () => action.run(async () => {
    const v = await api<{ id: string }>('/videos', { body: { url: r.url, mission_id: r.mission_id, competency_id: r.competency_id } })
    navigate(`/videos/${v.id}`)
  })

  return (
    <article className={`resource ${r.status}`}>
      <div className="resource-top">
        <Chip>{r.type}</Chip>
        <Chip>{r.level}</Chip>
        {Boolean(r.official) && <Chip tone="good">official</Chip>}
        {Boolean(r.hands_on) && <Chip tone="info">hands-on</Chip>}
        {r.status !== 'accepted' && <Chip tone={r.status === 'candidate' ? 'warn' : undefined}>{r.status}</Chip>}
        {r.est_minutes ? <span className="muted">~{r.est_minutes >= 90 ? `${Math.round(r.est_minutes / 60)} h` : `${r.est_minutes} min`}</span> : null}
      </div>
      <h3><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></h3>
      <p className="reason">{r.reason}</p>
      <div className="resource-meta muted">
        {showMission && <span>{r.mission_title}</span>}
        {r.competency_name && <span>{r.competency_name}</span>}
        {r.author && <span>{r.author}</span>}
        <span>via {r.source}</span>
        {r.committed_sha && <span title={r.committed_sha}>✓ in repo</span>}
      </div>
      <ErrorBanner error={action.error} />
      <div className="actions">
        {r.status === 'candidate' || r.status === 'deferred' ? (
          <>
            <button className="primary small" disabled={action.busy} onClick={() => setStatus('accepted')}>Approve</button>
            {r.status === 'candidate' && <button className="secondary small" disabled={action.busy} onClick={() => setStatus('deferred')}>Defer</button>}
            <button className="ghost small" disabled={action.busy} onClick={() => setStatus('rejected')}>Reject</button>
          </>
        ) : (
          <>
            {isVideo(r) && <button className="primary small" disabled={action.busy} onClick={watch}>▶ Watch with notes</button>}
            <button className="ghost small" disabled={action.busy} onClick={() => setStatus('deprecated')}>Deprecate</button>
          </>
        )}
      </div>
    </article>
  )
}
