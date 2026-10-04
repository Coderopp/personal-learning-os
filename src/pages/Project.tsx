import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { ProjectBrief } from '../lib/types'
import { Card, Chip, ErrorBanner, Spinner } from '../components/ui'
import { Md } from '../components/Md'

interface ProjectData {
  id: string
  mission_id: string
  competency: { id: string; name: string; mission_id: string } | null
  brief: ProjectBrief
  progress: Record<string, { done?: boolean; log?: { at: string; note: string; feedback: string }[] }>
  status: 'todo' | 'doing' | 'done'
  updated_at: string
}

const LISTS: { key: keyof ProjectBrief; label: string; hint: string }[] = [
  { key: 'requirements', label: 'Requirements', hint: 'Each one testable' },
  { key: 'deliverables', label: 'Deliverables', hint: 'What exists at the end' },
  { key: 'acceptance_criteria', label: 'Acceptance criteria', hint: 'Project-level definition of done' },
  { key: 'stack', label: 'Stack', hint: 'Languages, libraries, tools' },
  { key: 'stretch_goals', label: 'Stretch goals', hint: 'If you have time' },
]

/** Edit a list of strings as one item per line: quick on PC and tablet alike. */
function LinesField({ label, hint, value, onChange }: { label: string; hint: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'))
  useEffect(() => { setText(value.join('\n')) }, [value.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field">
      <span>{label} <small className="muted">· {hint} · one per line</small></span>
      <textarea rows={Math.max(3, value.length + 1)} value={text} onChange={e => setText(e.target.value)}
        onBlur={() => onChange(text.split('\n').map(s => s.trim()).filter(Boolean))} />
    </label>
  )
}

function Milestone({ project, i, onSaved }: { project: ProjectData; i: number; onSaved: (p: ProjectData['progress']) => void }) {
  const m = project.brief.milestones[i]
  const state = project.progress[i] ?? {}
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ built: '', worked: '', failed: '', next: '' })
  const action = useAction()
  const toggle = () => action.run(async () => {
    const r = await api<{ progress: ProjectData['progress'] }>(`/projects/${project.id}/milestones/${i}`, { body: { done: !state.done } })
    onSaved(r.progress)
  })
  const log = () => action.run(async () => {
    const r = await api<{ progress: ProjectData['progress']; feedback: string }>(`/projects/${project.id}/milestones/${i}/log`, { body: form })
    setForm({ built: '', worked: '', failed: '', next: '' })
    onSaved(r.progress)
  })
  return (
    <li className={`milestone ${state.done ? 'done' : ''}`}>
      <button className="check" aria-label={state.done ? 'Mark not done' : 'Mark done'} disabled={action.busy} onClick={toggle}>{state.done ? '✓' : ''}</button>
      <div className="stack">
        <div><strong>{i + 1}. {m.title}</strong><p className="muted">{m.description}</p><p className="small-text"><b>Done when:</b> {m.acceptance}</p></div>
        {state.log?.map((l, k) => (
          <div key={k} className="log-entry"><small className="muted">{l.at}</small><p style={{ whiteSpace: 'pre-wrap' }}>{l.note}</p><Md>{l.feedback}</Md></div>
        ))}
        {open ? (
          <div className="inline-form">
            {(['built', 'worked', 'failed', 'next'] as const).map(k => (
              <label key={k} className="field">
                <span>{{ built: 'What did you build or try?', worked: 'What worked (evidence)?', failed: 'What failed or confused you?', next: 'Next step?' }[k]}</span>
                <textarea rows={k === 'built' ? 3 : 2} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
              </label>
            ))}
            <ErrorBanner error={action.error} />
            <div className="actions">
              <button className="primary small" disabled={action.busy || !form.built.trim()} onClick={log}>{action.busy ? 'Coach is reviewing…' : 'Log & get feedback'}</button>
              <button className="ghost small" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : <button className="link small-text" onClick={() => setOpen(true)}>+ Log work on this milestone</button>}
      </div>
    </li>
  )
}

/** The Practice step: a structured project brief you own and edit, with milestone progress and coach feedback. */
export default function ProjectPage() {
  const { id = '' } = useParams()
  const { data, error, loading, setData } = useApi<ProjectData>(`/projects/${id}`)
  const [brief, setBrief] = useState<ProjectBrief | null>(null)
  const [editing, setEditing] = useState(false)
  const save = useAction()
  useEffect(() => { if (data) setBrief(data.brief) }, [data])

  if (loading && !data) return <div className="page"><Spinner /></div>
  if (error || !data || !brief) return <div className="page"><ErrorBanner error={error ?? 'Project not found'} /></div>
  const set = <K extends keyof ProjectBrief>(k: K, v: ProjectBrief[K]) => setBrief(b => b && { ...b, [k]: v })
  const dirty = JSON.stringify(brief) !== JSON.stringify(data.brief)
  const doneCount = brief.milestones.filter((_, i) => data.progress[i]?.done).length

  const persist = () => save.run(async () => {
    const r = await api<{ brief: ProjectBrief }>(`/projects/${id}`, { method: 'PUT', body: { brief } })
    setData(d => d && { ...d, brief: r.brief })
    setEditing(false)
  })

  return (
    <div className="page narrow-wide">
      <header className="page-head">
        <div>
          <span className="kicker">
            {data.competency && <Link to={`/missions/${data.competency.mission_id}?c=${encodeURIComponent(data.competency.id)}`}>{data.competency.name}</Link>} · Practice project
          </span>
          <h1>{brief.title}</h1>
          <p className="muted">{brief.summary}</p>
          <div className="chips">
            <Chip>{brief.difficulty}</Chip><Chip>~{brief.estimated_hours} h</Chip>
            <Chip tone="info">{{ browser: 'runs in your browser', local: 'on your machine', colab: 'Google Colab' }[brief.where_to_build]}</Chip>
            <Chip tone={data.status === 'done' ? 'good' : undefined}>{doneCount}/{brief.milestones.length} milestones</Chip>
          </div>
        </div>
        <div className="row-actions wrap">
          <a className="button ghost small" href={`/api/projects/${id}/markdown`} download={`${brief.title.replace(/[^\w-]+/g, '-')}.md`}>Export .md</a>
          {editing
            ? <><button className="primary small" disabled={!dirty || save.busy} onClick={persist}>{save.busy ? 'Saving…' : 'Save brief'}</button>
                <button className="ghost small" onClick={() => { setBrief(data.brief); setEditing(false) }}>Discard</button></>
            : <button className="secondary small" onClick={() => setEditing(true)}>Edit brief</button>}
        </div>
      </header>
      <ErrorBanner error={save.error} />

      {editing ? (
        <Card title="Edit the brief" subtitle="Everything here is yours to change; the agent never overwrites it.">
          <label className="field"><span>Title</span><input value={brief.title} onChange={e => set('title', e.target.value)} /></label>
          <label className="field"><span>Summary</span><textarea rows={2} value={brief.summary} onChange={e => set('summary', e.target.value)} /></label>
          <label className="field"><span>Goal: the capability this proves</span><textarea rows={2} value={brief.goal} onChange={e => set('goal', e.target.value)} /></label>
          <label className="field"><span>Context</span><textarea rows={4} value={brief.context} onChange={e => set('context', e.target.value)} /></label>
          <div className="field-row">
            <label className="field"><span>Difficulty</span>
              <select value={brief.difficulty} onChange={e => set('difficulty', e.target.value as ProjectBrief['difficulty'])}><option>beginner</option><option>intermediate</option><option>advanced</option></select></label>
            <label className="field"><span>Estimated hours</span><input type="number" min={0.5} max={40} step={0.5} value={brief.estimated_hours} onChange={e => set('estimated_hours', Number(e.target.value))} /></label>
            <label className="field"><span>Where to build</span>
              <select value={brief.where_to_build} onChange={e => set('where_to_build', e.target.value as ProjectBrief['where_to_build'])}>
                <option value="browser">Browser (NumPy/pandas)</option><option value="local">My machine</option><option value="colab">Google Colab</option></select></label>
          </div>
          {LISTS.map(l => <LinesField key={l.key} label={l.label} hint={l.hint} value={brief[l.key] as string[]} onChange={v => set(l.key, v as never)} />)}
          <div className="field">
            <span>Milestones</span>
            {brief.milestones.map((m, i) => (
              <div key={i} className="milestone-edit">
                <input value={m.title} placeholder="Title" onChange={e => set('milestones', brief.milestones.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                <textarea rows={2} value={m.description} placeholder="What to do" onChange={e => set('milestones', brief.milestones.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} />
                <input value={m.acceptance} placeholder="Done when…" onChange={e => set('milestones', brief.milestones.map((x, k) => (k === i ? { ...x, acceptance: e.target.value } : x)))} />
                <button className="ghost small danger" onClick={() => set('milestones', brief.milestones.filter((_, k) => k !== i))}>Remove</button>
              </div>
            ))}
            <button className="link" onClick={() => set('milestones', [...brief.milestones, { title: '', description: '', acceptance: '' }])}>+ Add milestone</button>
          </div>
          <div className="field">
            <span>Starter resources</span>
            {brief.starter_resources.map((r, i) => (
              <div key={i} className="field-row">
                <input value={r.title} placeholder="Title" onChange={e => set('starter_resources', brief.starter_resources.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                <input value={r.url} placeholder="https://…" onChange={e => set('starter_resources', brief.starter_resources.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />
                <button className="ghost small danger" onClick={() => set('starter_resources', brief.starter_resources.filter((_, k) => k !== i))}>✕</button>
              </div>
            ))}
            <button className="link" onClick={() => set('starter_resources', [...brief.starter_resources, { title: '', url: '' }])}>+ Add resource</button>
          </div>
          <label className="field"><span>Your notes</span><textarea rows={4} value={brief.notes} onChange={e => set('notes', e.target.value)} /></label>
          <div className="actions"><button className="primary" disabled={!dirty || save.busy} onClick={persist}>{save.busy ? 'Saving…' : 'Save brief'}</button></div>
        </Card>
      ) : (
        <>
          <div className="grid-2">
            <Card title="Goal"><p>{brief.goal}</p><h3 className="sub">Context</h3><Md>{brief.context}</Md></Card>
            <Card title="Definition of done">
              <ul>{brief.acceptance_criteria.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h3 className="sub">Deliverables</h3><ul>{brief.deliverables.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </Card>
          </div>
          <Card title="Milestones" subtitle="Tick when done, or log work and let the coach check it against the acceptance criteria.">
            <ol className="milestones big">
              {brief.milestones.map((_, i) => <Milestone key={i} project={data} i={i} onSaved={progress => setData(d => d && { ...d, progress })} />)}
            </ol>
          </Card>
          <div className="grid-2">
            <Card title="Requirements"><ul>{brief.requirements.map((x, i) => <li key={i}>{x}</li>)}</ul></Card>
            <Card title="Stack & resources">
              <div className="chips">{brief.stack.map(s => <Chip key={s}>{s}</Chip>)}</div>
              <ul>{brief.starter_resources.map((r, i) => <li key={i}><a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a></li>)}</ul>
              {brief.stretch_goals.length > 0 && <><h3 className="sub">Stretch goals</h3><ul>{brief.stretch_goals.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            </Card>
          </div>
          {brief.notes && <Card title="Your notes"><Md>{brief.notes}</Md></Card>}
        </>
      )}
    </div>
  )
}
