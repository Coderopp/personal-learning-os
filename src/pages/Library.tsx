import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, enc, useAction, useApi } from '../lib/api'
import type { Mission, MissionDetail, Resource } from '../lib/types'
import { Card, Empty, ErrorBanner, Spinner } from '../components/ui'
import { ResourceCard } from '../components/ResourceCard'

const TYPES = ['paper', 'book', 'course', 'documentation', 'repository', 'lecture', 'article', 'video']

export default function Library() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'queue' ? 'queue' : 'library'
  const mission = params.get('mission') ?? ''
  const type = params.get('type') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }

  const missions = useApi<Mission[]>('/missions')
  const query = new URLSearchParams({ status: tab === 'queue' ? 'candidate' : 'accepted', ...(mission && { mission }), ...(type && { type }), ...(params.get('q') && { q: params.get('q')! }) })
  const { data, loading, error, reload } = useApi<Resource[]>(`/resources?${query}`)
  const queue = useApi<Resource[]>(`/resources?status=candidate${mission ? `&mission=${encodeURIComponent(mission)}` : ''}`)
  const bulk = useAction()

  const refresh = () => { reload(); queue.reload() }
  const approveAll = () => bulk.run(async () => {
    if (!data || !window.confirm(`Approve all ${data.length} candidates shown?`)) return
    for (const r of data) await api(`/resources/${r.id}`, { method: 'PATCH', body: { status: 'accepted' } })
    refresh()
  })

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Resource repository</span>
          <h1>Every resource has a job</h1>
          <p className="muted">Curated, never hoarded. Candidates enter the canonical repo only when you approve them.</p>
        </div>
      </header>

      <div className="tabs big">
        <button className={tab === 'library' ? 'on' : ''} onClick={() => set('tab', '')}>Library</button>
        <button className={tab === 'queue' ? 'on' : ''} onClick={() => set('tab', 'queue')}>
          Review queue{queue.data?.length ? <span className="badge">{queue.data.length}</span> : null}
        </button>
      </div>

      <div className="filters">
        <select value={mission} onChange={e => set('mission', e.target.value)}>
          <option value="">All missions</option>
          {missions.data?.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
        <select value={type} onChange={e => set('type', e.target.value)}>
          <option value="">All types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <form onSubmit={e => { e.preventDefault(); set('q', q) }} className="search">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles and reasons" />
        </form>
        {tab === 'queue' && data && data.length > 1 && (
          <button className="ghost small" disabled={bulk.busy} onClick={approveAll}>{bulk.busy ? 'Approving…' : 'Approve all shown'}</button>
        )}
      </div>

      <ErrorBanner error={error ?? bulk.error} />
      {tab === 'library' && <AddResource missions={missions.data ?? []} defaultMission={mission} onAdded={refresh} />}
      {loading && !data ? <Spinner /> : data?.length ? (
        <div className="grid-cards">{data.map(r => <ResourceCard key={r.id} r={r} onChange={refresh} showMission={!mission} />)}</div>
      ) : (
        <Empty>{tab === 'queue' ? 'Nothing to review. Run "Find more" on a competency or create a mission.' : 'No accepted resources match.'}</Empty>
      )}
    </div>
  )
}

function AddResource({ missions, defaultMission, onAdded }: { missions: Mission[]; defaultMission: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ url: '', mission_id: defaultMission, competency_id: '', type: 'article', level: 'intermediate', reason: '' })
  const mission = useApi<MissionDetail>(form.mission_id ? `/missions/${enc(form.mission_id)}` : null)
  const action = useAction()
  const f = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(s => ({ ...s, [k]: e.target.value }))

  if (!open) return <button className="link add-link" onClick={() => setOpen(true)}>+ Add a resource you found</button>
  return (
    <Card title="Add resource" subtitle="You are the curator here, so it's accepted immediately, but it still needs a reason to exist.">
      <div className="field-row">
        <label className="field grow"><span>URL</span><input value={form.url} onChange={f('url')} placeholder="https://…" /></label>
        <label className="field"><span>Type</span><select value={form.type} onChange={f('type')}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="field"><span>Level</span>
          <select value={form.level} onChange={f('level')}><option>beginner</option><option>intermediate</option><option>advanced</option></select>
        </label>
      </div>
      <div className="field-row">
        <label className="field grow"><span>Mission</span>
          <select value={form.mission_id} onChange={f('mission_id')}>
            <option value="">Choose…</option>
            {missions.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
        <label className="field grow"><span>Competency</span>
          <select value={form.competency_id} onChange={f('competency_id')} disabled={!mission.data}>
            <option value="">General</option>
            {mission.data?.competencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>Why does this resource exist?</span>
        <input value={form.reason} onChange={f('reason')} placeholder="Included because…" />
      </label>
      <ErrorBanner error={action.error} />
      <div className="actions">
        <button className="primary" disabled={action.busy || !form.url || !form.mission_id || !form.reason.trim()} onClick={() => action.run(async () => {
          await api('/resources', { body: { ...form, competency_id: form.competency_id || undefined } })
          setForm(s => ({ ...s, url: '', reason: '' })); setOpen(false); onAdded()
        })}>Add to library</button>
        <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </Card>
  )
}
