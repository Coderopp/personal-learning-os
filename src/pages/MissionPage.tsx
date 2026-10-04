import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, enc, useAction, useApi } from '../lib/api'
import type { BenchmarkStatus, Competency, Mission, MissionDetail, Resource } from '../lib/types'
import { Card, Chip, Empty, ErrorBanner, Score, Spinner } from '../components/ui'
import { Md } from '../components/Md'
import { ResourceCard } from '../components/ResourceCard'
import { AskTutor } from '../components/AskTutor'
import { VideoCard } from '../components/VideoCard'
import { PathView } from '../components/PathView'
import { useStartSession } from './Dashboard'

export default function MissionPage() {
  const { id } = useParams()
  return id ? <Workspace id={id} /> : <MissionList />
}

function MissionList() {
  const { data, error, loading } = useApi<Mission[]>('/missions')
  return (
    <div className="page">
      <header className="page-head">
        <div><span className="kicker">Missions</span><h1>One primary, many explorations</h1></div>
        <div className="row-actions">
          <Link className="button secondary" to="/connections">Connections</Link>
          <Link className="button primary" to="/missions/new">+ New mission</Link>
        </div>
      </header>
      <ErrorBanner error={error} />
      {loading && <Spinner />}
      <div className="grid-cards">
        {data?.map(m => (
          <Link key={m.id} to={`/missions/${m.id}`} className="card mission-card">
            <div className="resource-top">
              {m.role === 'primary' && <Chip tone="good">primary</Chip>}
              <Chip>{m.mode}</Chip>
              {m.status === 'draft' && <Chip tone="warn">draft</Chip>}
            </div>
            <h3>{m.title}</h3>
            <p className="muted">{m.goal}</p>
            <small className="muted">
              {m.competency_count} competencies · {m.accepted_count} resources
              {m.candidate_count ? ` · ${m.candidate_count} to review` : ''}
              {m.milestone_count ? ` · milestone ${m.milestone_done}/${m.milestone_count}` : ''}
            </small>
          </Link>
        ))}
      </div>
      {data && !data.length && <Empty>No missions yet. <Link to="/missions/new">Create your first one.</Link></Empty>}
    </div>
  )
}

/** Depth = longest prerequisite chain, so the tree reads left→right from foundations to integration. */
function layers(comps: Competency[]) {
  const byId = new Map(comps.map(c => [c.id, c]))
  const depth = new Map<string, number>()
  const d = (c: Competency, seen = new Set<string>()): number => {
    if (depth.has(c.id)) return depth.get(c.id)!
    if (seen.has(c.id)) return 0
    seen.add(c.id)
    const pre = c.prerequisites.map(p => byId.get(p)).filter(Boolean) as Competency[]
    const v = pre.length ? 1 + Math.max(...pre.map(p => d(p, seen))) : 0
    depth.set(c.id, v)
    return v
  }
  comps.forEach(c => d(c))
  const cols: Competency[][] = []
  for (const c of comps) (cols[depth.get(c.id)!] ??= []).push(c)
  return cols
}

function Workspace({ id }: { id: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { data: m, error, loading, reload } = useApi<MissionDetail>(`/missions/${enc(id)}`)
  const candidates = useApi<Resource[]>(`/resources?mission=${encodeURIComponent(id)}&status=candidate`)
  const bench = useApi<{ competencies: BenchmarkStatus[] }>(`/benchmarks?mission=${encodeURIComponent(id)}`)
  const session = useStartSession()
  const action = useAction()
  const selectedId = params.get('c')
  const cols = useMemo(() => (m ? layers(m.competencies) : []), [m])

  if (loading && !m) return <div className="page"><Spinner /></div>
  if (error || !m) return <div className="page"><ErrorBanner error={error ?? 'Not found'} onRetry={reload} /></div>

  const selected = m.competencies.find(c => c.id === selectedId)
  const pending = candidates.data?.length ?? 0

  const patch = (body: Record<string, unknown>) => action.run(async () => {
    await api(`/missions/${enc(id)}`, { method: 'PATCH', body })
    reload()
  })
  const remove = () => action.run(async () => {
    if (!window.confirm(m.status === 'draft' ? 'Delete this draft mission?' : 'Archive this mission? History is kept.')) return
    await api(`/missions/${enc(id)}`, { method: 'DELETE' })
    navigate('/missions')
  })

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">
            {m.role === 'primary' ? 'Primary mission' : 'Exploration'} · {m.mode} · {m.level}
          </span>
          <h1>{m.title}</h1>
          <p className="muted">{m.goal}</p>
        </div>
        <div className="row-actions wrap">
          {m.status === 'active' && (
            <button className="primary" disabled={session.busy} onClick={() => session.start(m.id)}>
              {session.busy ? 'Planning…' : 'Start session →'}
            </button>
          )}
          {m.status === 'draft' && <button className="primary" disabled={action.busy} onClick={() => patch({ status: 'active' })}>Activate mission</button>}
          {m.role !== 'primary' && m.status === 'active' && <button className="secondary" disabled={action.busy} onClick={() => patch({ role: 'primary' })}>Make primary</button>}
          <BuildAllPaths missionId={m.id} competencies={m.competencies} />
          <button className="ghost" disabled={action.busy} onClick={remove}>{m.status === 'draft' ? 'Delete draft' : 'Archive'}</button>
        </div>
      </header>

      <ErrorBanner error={action.error ?? session.error} />

      {(m.status === 'draft' || params.get('review')) && (
        <div className="banner info">
          <strong>Review the plan.</strong> Edit or remove competencies, then approve the resources you trust
          ({pending} waiting in the <Link to={`/library?tab=queue&mission=${encodeURIComponent(id)}`}>review queue</Link>).
          {m.status === 'draft' ? ' Activate when it looks right. Activation commits the mission to the repo.' : ''}
        </div>
      )}

      <Card title="Skill map" subtitle="Foundations on the left, integration on the right. Tap a competency to work on it.">
        <div className="tree">
          {cols.map((col, i) => (
            <div className="tree-col" key={i}>
              {col.map(c => {
                const s = c.benchmark_score ?? c.practice_score
                return (
                  <button key={c.id}
                    className={`node ${selectedId === c.id ? 'selected' : ''} ${s == null ? 'fresh' : s >= 80 ? 'strong' : s >= 60 ? 'ok' : 'weak'}`}
                    onClick={() => setParams({ c: c.id })}>
                    <span>{c.name}</span>
                    <Score value={s} />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <AddCompetency missionId={id} competencies={m.competencies} onAdded={reload} />
      </Card>

      {selected && <CompetencyPanel key={selected.id} c={selected} all={m.competencies} onChange={reload} onClose={() => setParams({})}
        bench={bench.data?.competencies.find(b => b.competency_id === selected.id)} active={m.status === 'active'} />}

      <div className="grid-2">
        <Card title="Excellence means…" subtitle="Observable criteria. Benchmarks will test these.">
          <ul className="list plain">
            {m.excellence.map(e => <li key={e.name}><div><strong>{e.name}</strong><small className="muted">{e.description}</small></div></li>)}
          </ul>
        </Card>
        {m.mode === 'project' && <Milestones mission={m} onChange={reload} />}
      </div>
    </div>
  )
}

/** Build a path for every competency that doesn't have one yet (one at a time: Groq's free tier is per-minute). */
function BuildAllPaths({ missionId, competencies }: { missionId: string; competencies: Competency[] }) {
  const paths = useApi<{ competency_id: string }[]>(`/missions/${enc(missionId)}/paths`)
  const [state, setState] = useState<{ done: number; total: number; current: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const missing = competencies.filter(c => !paths.data?.some(p => p.competency_id === c.id))
  if (!paths.data || !missing.length) return null
  const run = async () => {
    setError(null)
    for (const [i, c] of missing.entries()) {
      setState({ done: i, total: missing.length, current: c.name })
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await api('/paths/build', { body: { competency_id: c.id } }); break } catch (e) {
          if (attempt === 0 && (e as { status?: number }).status === 429) { await new Promise(r => setTimeout(r, 20_000)); continue }
          setError(`${c.name}: ${(e as Error).message}`)
          break
        }
      }
    }
    setState(null)
    paths.reload()
  }
  return (
    <>
      <button className="secondary" disabled={Boolean(state)} onClick={run} title={error ?? ''}>
        {state ? `Building paths ${state.done + 1}/${state.total}: ${state.current}…` : `Build ${missing.length} learning path${missing.length > 1 ? 's' : ''}`}
      </button>
      {error && <span className="bad-text small-text">{error}</span>}
    </>
  )
}

function Milestones({ mission, onChange }: { mission: MissionDetail; onChange: () => void }) {
  const action = useAction()
  const cycle = { todo: 'doing', doing: 'done', done: 'todo' } as const
  return (
    <Card title="Milestones" subtitle="Each one ends in a visible artifact.">
      <ErrorBanner error={action.error} />
      <ol className="milestones">
        {mission.milestones.map(ms => (
          <li key={ms.id} className={ms.status}>
            <button className="check" aria-label={`Mark ${cycle[ms.status]}`} disabled={action.busy}
              onClick={() => action.run(async () => { await api(`/milestones/${ms.id}`, { method: 'PATCH', body: { status: cycle[ms.status] } }); onChange() })}>
              {ms.status === 'done' ? '✓' : ms.status === 'doing' ? '◐' : ''}
            </button>
            <div>
              <strong>{ms.title}</strong>
              <small className="muted">{ms.description}</small>
              {ms.log.length > 0 && (
                <details><summary className="muted">{ms.log.length} log entr{ms.log.length > 1 ? 'ies' : 'y'}</summary>
                  {ms.log.map((l, i) => (
                    <div key={i} className="log-entry">
                      <small className="muted">{l.at}</small>
                      <p><b>Built:</b> {l.built}</p>
                      {l.failed && <p><b>Failed:</b> {l.failed}</p>}
                      <p className="muted">{l.feedback}</p>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function AddCompetency({ missionId, competencies, onAdded }: { missionId: string; competencies: Competency[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prereq, setPrereq] = useState('')
  const action = useAction()
  if (!open) return <button className="link" onClick={() => setOpen(true)}>+ Add competency</button>
  return (
    <div className="inline-form">
      <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <input placeholder="One-line description" value={description} onChange={e => setDescription(e.target.value)} />
      <select value={prereq} onChange={e => setPrereq(e.target.value)}>
        <option value="">No prerequisite</option>
        {competencies.map(c => <option key={c.id} value={c.id}>after {c.name}</option>)}
      </select>
      <ErrorBanner error={action.error} />
      <div className="actions">
        <button className="primary small" disabled={!name.trim() || action.busy} onClick={() => action.run(async () => {
          await api(`/missions/${enc(missionId)}/competencies`, { body: { name, description, prerequisites: prereq ? [prereq] : [] } })
          setOpen(false); setName(''); setDescription(''); onAdded()
        })}>Add</button>
        <button className="ghost small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}

type PanelTab = 'path' | 'primer' | 'resources' | 'videos' | 'ask' | 'edit'

function CompetencyPanel({ c, all, onChange, onClose, bench, active }: {
  c: Competency; all: Competency[]; onChange: () => void; onClose: () => void; bench?: BenchmarkStatus; active: boolean
}) {
  const [tab, setTab] = useState<PanelTab>('path')
  const navigate = useNavigate()
  const benchAction = useAction()
  const startBenchmark = () => benchAction.run(async () => {
    const run = await api<{ id: string }>('/benchmarks/runs', { body: { competency_id: c.id } })
    navigate(`/benchmark/${run.id}`)
  })
  const prereqNames = c.prerequisites.map(p => all.find(x => x.id === p)?.name).filter(Boolean)
  return (
    <Card className="panel-card"
      title={c.name}
      subtitle={<>{c.description}{prereqNames.length ? <> · builds on {prereqNames.join(', ')}</> : null}</>}
      actions={<button className="ghost small" onClick={onClose}>Close</button>}>
      <div className={`bench-strip ${bench?.due ? 'due' : ''}`}>
        <div>
          <strong>Capability {c.benchmark_score == null ? '— not benchmarked' : Math.round(c.benchmark_score)}</strong>
          <small className="muted">
            Practice {c.practice_score == null ? '—' : Math.round(c.practice_score)} ({c.practice_n} graded; practice ≠ capability)
            {bench?.runs ? ` · ${bench.runs} benchmark${bench.runs > 1 ? 's' : ''}` : ''}
            {bench?.due ? ` · ready: ${bench.reason}` : ''}
          </small>
        </div>
        {active && (
          <button className={bench?.due ? 'primary' : 'secondary'} disabled={benchAction.busy} onClick={startBenchmark}>
            {benchAction.busy ? 'Preparing sealed tasks…' : 'Run benchmark'}
          </button>
        )}
      </div>
      <ErrorBanner error={benchAction.error} />
      <AlsoIn id={c.id} onTestOut={active ? startBenchmark : undefined} />
      <div className="tabs">
        {(['path', 'primer', 'resources', 'videos', 'ask', 'edit'] as PanelTab[]).map(t =>
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'path' && <PathView competencyId={c.id} active={active} />}
      {tab === 'primer' && <Primer id={c.id} />}
      {tab === 'resources' && <CompetencyResources c={c} />}
      {tab === 'videos' && <CompetencyVideos c={c} />}
      {tab === 'ask' && <AskTutor competencyId={c.id} />}
      {tab === 'edit' && <EditCompetency c={c} onChange={onChange} onDeleted={onClose} />}
    </Card>
  )
}

function Primer({ id }: { id: string }) {
  const { data, loading, error, setData } = useApi<{ content: string; citations: { n: number; title: string; url: string }[]; created_at?: string } | null>(`/primer/${enc(id)}`)
  const action = useAction()
  const generate = () => action.run(async () => setData(await api(`/primer/${enc(id)}`, { body: {} })))

  if (loading) return <Spinner />
  return (
    <div>
      <ErrorBanner error={error ?? action.error} />
      {data ? (
        <>
          <Md>{data.content}</Md>
          {data.citations.length > 0 && (
            <ol className="citations">
              {data.citations.map(ci => <li key={ci.n} value={ci.n}><a href={ci.url} target="_blank" rel="noreferrer">{ci.title}</a></li>)}
            </ol>
          )}
          <button className="ghost small" disabled={action.busy} onClick={generate}>{action.busy ? 'Rewriting…' : 'Regenerate from current resources'}</button>
        </>
      ) : (
        <Empty>
          <p>A compact primer: the core idea, key concepts, misconceptions and self-check questions, citing your approved resources.</p>
          <button className="primary" disabled={action.busy} onClick={generate}>{action.busy ? 'Writing primer…' : 'Write primer'}</button>
        </Empty>
      )}
    </div>
  )
}

interface Links {
  links: { id: string; name: string; mission_id: string; mission_title: string; benchmark_score: number | null; shared: string[] }[]
  test_out: { from: { name: string; mission_title: string; benchmark_score: number }; shared: string[] } | null
}

/** Cross-mission links for one competency, and a test-out suggestion when you've already proven it elsewhere. */
function AlsoIn({ id, onTestOut }: { id: string; onTestOut?: () => void }) {
  const { data } = useApi<Links>(`/links/${enc(id)}`)
  if (!data?.links.length) return null
  return (
    <div className="also-in">
      {data.test_out && (
        <div className="banner info bench-due">
          <span>You scored <b>{Math.round(data.test_out.from.benchmark_score)}</b> on <b>{data.test_out.from.name}</b> in {data.test_out.from.mission_title}, sharing {data.test_out.shared.join(', ')}. Take a benchmark here to test out.</span>
          {onTestOut && <button className="secondary small" onClick={onTestOut}>Test out</button>}
        </div>
      )}
      <span className="muted small-text">Also in:</span>
      {data.links.slice(0, 4).map(l => (
        <Link key={l.id} className="also-chip" to={`/missions/${l.mission_id}?c=${encodeURIComponent(l.id)}`} title={`Shares ${l.shared.join(', ')}`}>
          <b>{l.mission_title}</b> › {l.name} <span className="muted">· {l.shared.slice(0, 2).join(', ')}</span>
        </Link>
      ))}
      {data.links.length > 4 && <Link to="/connections" className="link small-text">+{data.links.length - 4} more</Link>}
    </div>
  )
}

function CompetencyVideos({ c }: { c: Competency }) {
  const { data, loading, error, reload } = useApi<Resource[]>(`/resources?competency=${encodeURIComponent(c.id)}&type=video`)
  const action = useAction()
  const findVideos = () => action.run(async () => {
    const r = await api<{ added: number; searched: number }>(`/missions/${enc(c.mission_id)}/gather`, { body: { competency_id: c.id, kind: 'video' } })
    reload()
    if (!r.added) action.setError(r.searched ? 'Searched YouTube; nothing good enough to suggest.' : 'YouTube returned no results. Try again later.')
  })
  return (
    <div>
      <div className="actions">
        <button className="secondary small" disabled={action.busy} onClick={findVideos}>{action.busy ? 'Searching YouTube & curating…' : 'Find videos'}</button>
        <span className="muted small-text">The agent picks lectures and talks, not clips. Approved videos become searchable.</span>
      </div>
      <ErrorBanner error={error ?? action.error} />
      {loading ? <Spinner /> : data?.length ? (
        <div className="grid-cards">{data.map(r => <VideoCard key={r.id} r={r} onChange={reload} />)}</div>
      ) : <p className="muted">No videos for this competency yet.</p>}
    </div>
  )
}

function CompetencyResources({ c }: { c: Competency }) {
  const { data: all, loading, error, reload } = useApi<Resource[]>(`/resources?competency=${encodeURIComponent(c.id)}`)
  const data = all?.filter(r => r.type !== 'video')
  const action = useAction()
  const findMore = () => action.run(async () => {
    const r = await api<{ added: number; searched: number }>(`/missions/${enc(c.mission_id)}/gather`, { body: { competency_id: c.id } })
    reload()
    if (!r.added) action.setError(r.searched ? 'Nothing new worth adding from this search.' : 'No new results found.')
  })
  return (
    <div>
      <div className="actions">
        <button className="secondary small" disabled={action.busy} onClick={findMore}>{action.busy ? 'Searching & curating…' : 'Find more for this skill'}</button>
      </div>
      <ErrorBanner error={error ?? action.error} />
      {loading ? <Spinner /> : data?.length ? (
        <div className="grid-cards">{data.map(r => <ResourceCard key={r.id} r={r} onChange={reload} />)}</div>
      ) : <p className="muted">No resources for this competency yet.</p>}
    </div>
  )
}

function EditCompetency({ c, onChange, onDeleted }: { c: Competency; onChange: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(c.name)
  const [description, setDescription] = useState(c.description)
  const action = useAction()
  return (
    <div className="inline-form">
      <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="field"><span>Description</span><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <ErrorBanner error={action.error} />
      <div className="actions">
        <button className="primary small" disabled={action.busy} onClick={() => action.run(async () => {
          await api(`/competencies/${enc(c.id)}`, { method: 'PATCH', body: { name, description } }); onChange()
        })}>Save</button>
        <button className="ghost small danger" disabled={action.busy} onClick={() => action.run(async () => {
          if (!window.confirm(`Remove "${c.name}" from this mission?`)) return
          await api(`/competencies/${enc(c.id)}`, { method: 'DELETE' }); onDeleted(); onChange()
        })}>Remove competency</button>
      </div>
    </div>
  )
}
