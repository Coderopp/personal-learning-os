import { Link, useNavigate } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { Competency, Mission, Session } from '../lib/types'
import { Card, Chip, Empty, ErrorBanner, Metric, Score, Spinner } from '../components/ui'

interface Dash {
  mission: Mission | null
  competencies: Competency[]
  milestones: { id: string; title: string; status: string }[]
  bottleneck: { id: string; name: string; why: string } | null
  next_resource: { id: string; title: string; type: string; url: string; reason: string } | null
  errors: { id: string; concept: string; category: string; occurrences: number; status: string; next_action: string }[]
  due: number
  total_due: number
  open_session: { id: string; kind: string; stage: number; started_at: string } | null
  last_session: { summary: string | null; ended_at: string } | null
  exploration: { id: string; title: string; mode: string; status: string; milestone_count: number; milestone_done: number; due: number }[]
  weekly: { minutes: number; sessions: number }
  benchmark_due: { competency_id: string; name: string; reason: string }[]
  metrics: {
    capability: number | null
    benchmarked: number
    coverage: string
    practice_accuracy: { value: number | null; n: number }
    recall7: { value: number | null; n: number }
    recall30: { value: number | null; n: number }
  }
}

const notYet = (n: number, need: number) => `not enough data (${n}/${need})`

export function useStartSession() {
  const navigate = useNavigate()
  const action = useAction()
  const start = (missionId: string, kind: 'full' | 'review' = 'full') => action.run(async () => {
    const s = await api<Session>('/sessions', { body: { mission_id: missionId, kind } })
    navigate(`/session/${s.id}`)
  })
  return { ...action, start }
}

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<Dash>('/dashboard')
  const session = useStartSession()

  if (loading && !data) return <div className="page"><Spinner label="Loading your mission…" /></div>
  if (error) return <div className="page"><ErrorBanner error={error} onRetry={reload} /></div>
  if (!data?.mission) {
    return (
      <div className="page">
        <Empty>
          <h2>No active mission</h2>
          <p>Pick one skill to get excellent at. The agent builds the skill map, finds the best sources and plans your first session.</p>
          <Link className="button primary" to="/missions/new">Create a mission</Link>
        </Empty>
      </div>
    )
  }

  const { mission, metrics } = data
  const isProject = mission.mode === 'project'
  const nextMilestone = data.milestones.find(m => m.status !== 'done')
  const practiced = data.competencies.filter(c => c.practice_n > 0).length

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">{mission.role === 'primary' ? 'Primary mission' : 'Mission'} · {mission.mode}</span>
          <h1><Link to={`/missions/${mission.id}`}>{mission.title}</Link></h1>
          <p className="muted">{mission.goal}</p>
        </div>
        <div className="head-stats">
          <Metric label="Capability" value={metrics.capability ?? '—'} note={metrics.capability == null ? 'no benchmark yet' : `benchmarked ${metrics.coverage}`} dim={metrics.capability == null} />
          <Metric label="Target" value={mission.target} note={metrics.capability == null ? '' : `gap ${mission.target - metrics.capability}`} />
        </div>
      </header>

      <ErrorBanner error={session.error} />

      {data.benchmark_due.length > 0 && !data.open_session && (
        <div className="banner info bench-due">
          <span><strong>Benchmark ready:</strong> {data.benchmark_due.map(b => `${b.name} (${b.reason})`).join(' · ')}. Prove it on unseen tasks to turn practice into capability.</span>
          <Link className="button secondary small" to={`/missions/${mission.id}?c=${encodeURIComponent(data.benchmark_due[0].competency_id)}`}>Open</Link>
        </div>
      )}

      <section className="hero">
        <div className="hero-main">
          {data.open_session ? (
            <>
              <span className="kicker">In progress</span>
              <h2>You have an unfinished {data.open_session.kind === 'review' ? 'review' : 'session'}</h2>
              <p className="muted">Started {new Date(`${data.open_session.started_at}Z`).toLocaleString()}. It picks up exactly where you left off, on any device.</p>
              <div className="actions">
                <Link className="button primary" to={`/session/${data.open_session.id}`}>Resume →</Link>
              </div>
            </>
          ) : (
            <>
              <span className="kicker">{isProject ? 'Next milestone' : 'Bottleneck'}</span>
              <h2>{isProject ? nextMilestone?.title ?? 'All milestones done' : data.bottleneck?.name ?? '—'}</h2>
              {!isProject && data.bottleneck && <p className="muted">Why: {data.bottleneck.why}</p>}
              <ol className="plan-preview">
                {isProject ? (
                  <>
                    <li><b>Plan</b> the milestone and what you need to learn for it</li>
                    <li><b>Build</b>, then log what worked and what failed</li>
                    <li><b>Recall</b> 2 questions on what you just used</li>
                  </>
                ) : (
                  <>
                    <li><b>Recall</b> {data.due ? `${Math.min(2, data.due)} due review${data.due > 1 ? 's' : ''} + ` : ''}questions on {data.bottleneck?.name}</li>
                    <li><b>Learn</b> only the gap your answers expose{data.next_resource && <> · <a href={data.next_resource.url} target="_blank" rel="noreferrer">{data.next_resource.title}</a></>}</li>
                    <li><b>Practice</b> 3 calibrated problems</li>
                    <li><b>Build</b> a ≤30 min micro-task</li>
                    <li><b>Diagnose</b>{data.errors.find(e => e.status === 'recurring') ? <> incl. recurring “{data.errors.find(e => e.status === 'recurring')!.concept}”</> : ' your mistakes'} → <b>Reflect</b></li>
                  </>
                )}
              </ol>
              <div className="actions">
                <button className="primary big" disabled={session.busy} onClick={() => session.start(mission.id)}>
                  {session.busy ? 'Planning your session…' : 'Start session →'}
                </button>
                {data.due > 0 && (
                  <button className="secondary big" disabled={session.busy} onClick={() => session.start(mission.id, 'review')}>
                    Review {data.due} due · ~{Math.max(5, Math.round(data.due * 1.5))} min
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <div className="metrics">
        <Metric label="Focused this week" value={`${(data.weekly.minutes / 60).toFixed(1)} h`} note={`${data.weekly.sessions} session${data.weekly.sessions === 1 ? '' : 's'} · goal ${mission.hours_per_week} h`} />
        <Metric label="Recall · 7 day" value={metrics.recall7.value != null ? `${metrics.recall7.value}%` : '—'} note={metrics.recall7.value != null ? `n=${metrics.recall7.n}` : notYet(metrics.recall7.n, 20)} dim={metrics.recall7.value == null} />
        <Metric label="Recall · 30 day" value={metrics.recall30.value != null ? `${metrics.recall30.value}%` : '—'} note={metrics.recall30.value != null ? `n=${metrics.recall30.n}` : notYet(metrics.recall30.n, 20)} dim={metrics.recall30.value == null} />
        <Metric label="Practice accuracy · 30d" value={metrics.practice_accuracy.value != null ? `${metrics.practice_accuracy.value}` : '—'} note={metrics.practice_accuracy.value != null ? 'practice ≠ capability' : notYet(metrics.practice_accuracy.n, 5)} dim={metrics.practice_accuracy.value == null} />
      </div>

      <div className="grid-2">
        <Card title="Skill map" subtitle={`${practiced}/${data.competencies.length} competencies practiced`} actions={<Link to={`/missions/${mission.id}`} className="link">Open</Link>}>
          <ul className="skill-bars">
            {data.competencies.map(c => (
              <li key={c.id} className={data.bottleneck?.id === c.id ? 'focus' : ''}>
                <Link to={`/missions/${mission.id}?c=${encodeURIComponent(c.id)}`}>{c.name}</Link>
                <div className="bar"><span style={{ width: `${c.practice_score ?? 0}%` }} /></div>
                <Score value={c.benchmark_score ?? c.practice_score} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="stack">
          <Card title="Open errors" subtitle="What you repeatedly get wrong gets trained first." actions={<Link to="/errors" className="link">Error Lab</Link>}>
            {data.errors.length ? (
              <ul className="list">
                {data.errors.map(e => (
                  <li key={e.id}>
                    <div><strong>{e.concept}</strong><small className="muted">{e.next_action}</small></div>
                    <Chip tone={e.status === 'recurring' ? 'bad' : 'warn'}>{e.occurrences}×</Chip>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No errors recorded yet. They appear as soon as a graded answer exposes a misunderstanding.</p>}
          </Card>

          <Card title="Exploration" actions={<Link to="/missions/new" className="link">+ New mission</Link>}>
            {data.exploration.length ? (
              <ul className="list">
                {data.exploration.map(m => (
                  <li key={m.id}>
                    <div>
                      <Link to={`/missions/${m.id}`}><strong>{m.title}</strong></Link>
                      <small className="muted">
                        {m.mode}{m.milestone_count ? ` · milestone ${m.milestone_done}/${m.milestone_count}` : ''}{m.status === 'draft' ? ' · draft' : ''}{m.due ? ` · ${m.due} due` : ''}
                      </small>
                    </div>
                    {m.status === 'active' && <button className="secondary small" disabled={session.busy} onClick={() => session.start(m.id)}>Start</button>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Hobbies and side quests live here without diluting the primary mission.</p>}
          </Card>

          {data.last_session?.summary && (
            <Card title="Last session">
              <p>{data.last_session.summary}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
