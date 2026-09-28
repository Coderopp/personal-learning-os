import { useSearchParams } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { LearnError } from '../lib/types'
import { Chip, Empty, ErrorBanner, Spinner } from '../components/ui'

const date = (s: string) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function Errors() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const { data, error, loading, reload } = useApi<LearnError[]>(`/errors${status ? `?status=${status}` : ''}`)
  const action = useAction()
  const setErrStatus = (id: string, s: string) => action.run(async () => {
    await api(`/errors/${id}`, { method: 'PATCH', body: { status: s } })
    reload()
  })

  const counts = { recurring: 0, new: 0, resolved: 0 }
  data?.forEach(e => { counts[e.status]++ })

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Error Lab</span>
          <h1>Your personal failure modes</h1>
          <p className="muted">Every real misunderstanding becomes training data. Recurring errors are injected into future sessions until you answer them correctly 3 times across a week.</p>
        </div>
      </header>
      <div className="tabs big">
        {[['', 'All'], ['recurring', 'Recurring'], ['new', 'New'], ['resolved', 'Resolved']].map(([k, label]) => (
          <button key={k} className={status === k ? 'on' : ''} onClick={() => setParams(k ? { status: k } : {})}>
            {label}{!status && k && counts[k as keyof typeof counts] ? <span className="badge">{counts[k as keyof typeof counts]}</span> : null}
          </button>
        ))}
      </div>
      <ErrorBanner error={error ?? action.error} />
      {loading && !data ? <Spinner /> : data?.length ? (
        <div className="grid-cards">
          {data.map(e => (
            <article key={e.id} className={`card error-card ${e.status}`}>
              <div className="resource-top">
                <Chip tone={e.status === 'recurring' ? 'bad' : e.status === 'resolved' ? 'good' : 'warn'}>{e.status}</Chip>
                <Chip>{e.category}</Chip>
                <span className="muted">{e.occurrences}× · first {date(e.first_seen)} · last {date(e.last_seen)}</span>
              </div>
              <h3>{e.concept}</h3>
              <dl>
                <dt>Observed</dt><dd>{e.observed}</dd>
                <dt>Root cause</dt><dd>{e.root_cause}</dd>
                <dt>Next action</dt><dd>{e.next_action}</dd>
              </dl>
              <div className="resource-meta muted">
                <span>{e.mission_title}</span>{e.competency_name && <span>{e.competency_name}</span>}
                {e.status !== 'resolved' && <span>streak {e.correct_streak}/3</span>}
              </div>
              <div className="actions">
                {e.status !== 'resolved'
                  ? <button className="ghost small" disabled={action.busy} onClick={() => setErrStatus(e.id, 'resolved')}>Mark resolved</button>
                  : <button className="ghost small" disabled={action.busy} onClick={() => setErrStatus(e.id, 'recurring')}>Reopen</button>}
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>No errors {status ? `with status "${status}"` : 'yet'}. They're captured automatically when a graded answer exposes a wrong mental model.</Empty>}
    </div>
  )
}
