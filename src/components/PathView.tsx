import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, enc, useAction, useApi } from '../lib/api'
import type { Path, Unit, UnitRole } from '../lib/types'
import { Chip, Empty, ErrorBanner, Spinner } from './ui'

const ROLE_LABEL: Record<UnitRole, string> = { foundation: 'Foundation', deepen: 'Deepen', practice: 'Practice', latest: 'Latest', bench: 'Bench', reference: 'Reference' }
const KIND_ICON: Record<string, string> = { read: '📖', watch: '▶', pdf: '📄', code: '⌨', project: '🛠', link: '↗' }
const SOURCE_LABEL: Record<string, string> = { substack: 'Substack', medium: 'Medium', beehiiv: 'beehiiv', blog: 'Blog', web: 'Web', youtube: 'YouTube', arxiv: 'arXiv', pdf: 'PDF', github: 'GitHub', project: 'Your project' }

export const unitHref = (u: Unit, projectId?: string | null) =>
  u.kind === 'project' && projectId ? `/projects/${projectId}` : `/unit/${u.id}`

const fmtMin = (m: number | null) => (m == null ? '' : m >= 90 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`)

function UnitMeta({ u }: { u: Unit }) {
  const pl = u.data.playlist
  const ep = pl && u.data.video_id ? pl.episodes.findIndex(e => e.id === u.data.video_id) : -1
  return (
    <small className="muted unit-meta">
      {[SOURCE_LABEL[u.source] ?? u.source, u.publication, u.author, u.published?.slice(0, 7),
        pl && (ep >= 0 ? `episode ${ep + 1} of ${pl.episodes.length} · ${pl.title}` : `${pl.title} (${pl.episodes.length} episodes)`),
        fmtMin(u.minutes)].filter(Boolean).join(' · ')}
      {u.data.paid ? ' · paid (preview)' : ''}
    </small>
  )
}

function StepCard({ u, index, projectId, bench, onChange }: { u: Unit; index: number; projectId: string | null; bench: Unit[]; onChange: () => void }) {
  const [swapping, setSwapping] = useState(false)
  const action = useAction()
  const swap = (benchId: string) => action.run(async () => {
    await api(`/units/${u.id}/swap`, { body: { with: benchId } })
    setSwapping(false)
    onChange()
  })
  return (
    <li className={`step-card ${u.status}`}>
      <div className="step-index">{u.status === 'done' ? '✓' : index + 1}</div>
      <div className="step-body">
        <div className="step-top"><Chip tone={u.role === 'latest' ? 'info' : undefined}>{ROLE_LABEL[u.role]}</Chip><span aria-hidden>{KIND_ICON[u.kind]}</span></div>
        <Link to={unitHref(u, projectId)} className="step-title">{u.title}</Link>
        <UnitMeta u={u} />
        <p className="muted step-why">{u.why}</p>
        {u.progress > 0 && u.status !== 'done' && <div className="bar thin"><span style={{ width: `${Math.round(u.progress * 100)}%` }} /></div>}
        <ErrorBanner error={action.error} />
        <div className="actions">
          <Link className={`button small ${u.status === 'done' ? 'ghost' : 'primary'}`} to={unitHref(u, projectId)}>
            {u.status === 'done' ? 'Review' : u.status === 'doing' ? 'Continue' : u.kind === 'project' ? 'Open brief' : 'Start'}
          </Link>
          {u.role !== 'practice' && bench.length > 0 && u.status !== 'done' && (
            <button className="ghost small" onClick={() => setSwapping(s => !s)}>{swapping ? 'Cancel' : 'Swap'}</button>
          )}
        </div>
        {swapping && (
          <ul className="list swap-list">
            {bench.map(b => (
              <li key={b.id}>
                <div><strong>{KIND_ICON[b.kind]} {b.title}</strong><UnitMeta u={b} /></div>
                <button className="secondary small" disabled={action.busy} onClick={() => swap(b.id)}>Use this</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

/** A competency's learning path: ≤ 4 steps you do inside the app, plus bench and reference shelf. */
export function PathView({ competencyId, active }: { competencyId: string; active: boolean }) {
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<Path | null>(`/paths/${enc(competencyId)}`)
  const build = useAction()
  const accept = useAction()

  const rebuild = () => build.run(async () => {
    if (data && !window.confirm('Rebuild this path? Progress on its steps is reset (your edited project brief is kept).')) return
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await api('/paths/build', { body: { competency_id: competencyId } }); break } catch (e) {
        if (attempt === 0 && (e as { status?: number }).status === 429) { await new Promise(r => setTimeout(r, 20_000)); continue }
        throw e
      }
    }
    reload()
  })

  if (loading && !data) return <Spinner />
  if (!data) {
    return (
      <Empty>
        <p>No path yet. The agent searches lectures, articles, newsletters (Substack, Medium, beehiiv), blogs, papers and repos, then builds <b>4 steps you can do here</b>: Foundation → Deepen → Practice project → Latest.</p>
        <ErrorBanner error={error ?? build.error} />
        <button className="primary" disabled={build.busy} onClick={rebuild}>{build.busy ? 'Researching & composing… (~20 s)' : 'Build my path'}</button>
      </Empty>
    )
  }
  const core = data.units.filter(u => ['foundation', 'deepen', 'practice', 'latest'].includes(u.role))
  const bench = data.units.filter(u => u.role === 'bench')
  const reference = data.units.filter(u => u.role === 'reference')
  const done = core.filter(u => u.status === 'done').length
  const minutes = core.reduce((m, u) => m + (u.minutes ?? 0), 0)
  const next = core.find(u => u.status !== 'done')

  return (
    <div className="path-view">
      <div className="path-head">
        <div>
          <strong>{done}/{core.length} steps · ~{fmtMin(minutes)}</strong>
          {data.rationale && <small className="muted">{data.rationale}</small>}
        </div>
        <div className="row-actions wrap">
          {data.status === 'proposed' && active && (
            <button className="primary small" disabled={accept.busy} onClick={() => accept.run(async () => { await api(`/paths/${data.id}/accept`, { body: {} }); reload() })}>Accept path</button>
          )}
          {data.status === 'accepted' && <Chip tone="good">accepted</Chip>}
          {next && <button className="secondary small" onClick={() => navigate(unitHref(next, data.project_id))}>Continue: step {core.indexOf(next) + 1}</button>}
          <button className="ghost small" disabled={build.busy} onClick={rebuild}>{build.busy ? 'Rebuilding…' : 'Rebuild'}</button>
        </div>
      </div>
      <ErrorBanner error={build.error ?? accept.error} />
      <ol className="steps-list">
        {core.map((u, i) => <StepCard key={u.id} u={u} index={i} projectId={data.project_id} bench={bench} onChange={reload} />)}
      </ol>
      {reference.length > 0 && (
        <details className="shelf">
          <summary className="muted">Reference shelf ({reference.length}): useful, but nothing to do in the app</summary>
          <ul className="list">
            {reference.map(r => <li key={r.id}><div><a href={r.url} target="_blank" rel="noreferrer"><strong>{r.title}</strong></a><small className="muted">{r.why}</small></div></li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
