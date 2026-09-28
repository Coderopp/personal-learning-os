import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import { useDraft } from '../lib/draft'
import { Card, Chip, ErrorBanner, Score, Spinner } from '../components/ui'
import { Md } from '../components/Md'

type Dim = 'concept' | 'implementation' | 'reasoning' | 'transfer'
const DIMS: Dim[] = ['concept', 'implementation', 'reasoning', 'transfer']

interface Task { id: string; kind: string; prompt: string; expected?: string; rubric?: Record<Dim, string> }
interface Run {
  id: string
  mission_id: string
  competency_id: string
  competency_name: string
  started_at: string
  submitted_at: string | null
  duration_s: number | null
  score: number | null
  dims: Record<Dim, number> | null
  answers: Record<string, string> | null
  results: { task_id: string; dims: Record<Dim, number>; score: number; feedback: string }[] | null
  tasks: Task[]
}

const SUGGESTED_MIN = 30

function Elapsed({ since }: { since: string }) {
  const start = Date.parse(`${since.replace(' ', 'T')}Z`)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const s = Math.max(0, Math.floor((now - start) / 1000))
  const over = s > SUGGESTED_MIN * 60
  return <span className={`timer ${over ? 'over' : ''}`}>⏱ {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}{over ? ' · past suggested 30 min' : ''}</span>
}

export default function Benchmark() {
  const { id = '' } = useParams()
  const { data: run, error, loading, setData } = useApi<Run>(`/benchmarks/runs/${id}`)
  if (loading && !run) return <div className="page"><Spinner label="Unsealing tasks…" /></div>
  if (error || !run) return <div className="page"><ErrorBanner error={error ?? 'Benchmark not found'} /></div>
  return run.submitted_at ? <Results run={run} /> : <Exam run={run} onSubmitted={setData} />
}

function TaskAnswer({ runId, task, index }: { runId: string; task: Task; index: number }) {
  const [value, setValue] = useDraft(`bm:${runId}:${task.id}`)
  return (
    <Card>
      <div className="answer-meta"><span className="muted">Task {index + 1}</span><Chip>{task.kind}</Chip></div>
      <div className="answer-prompt"><Md>{task.prompt}</Md></div>
      <textarea rows={10} value={value} onChange={e => setValue(e.target.value)} data-task={task.id}
        placeholder="Work it out here. No hints, no sources. Reasoning and checks count." />
    </Card>
  )
}

function Exam({ run, onSubmitted }: { run: Run; onSubmitted: (r: Run) => void }) {
  const navigate = useNavigate()
  const submit = useAction()
  const readAnswers = () => Object.fromEntries(run.tasks.map(t => {
    try { return [t.id, localStorage.getItem(`draft:bm:${run.id}:${t.id}`) ?? ''] } catch { return [t.id, ''] }
  }))

  const doSubmit = () => submit.run(async () => {
    const answers = readAnswers()
    const empty = run.tasks.filter(t => !answers[t.id]?.trim()).length
    if (empty && !window.confirm(`${empty} task${empty > 1 ? 's are' : ' is'} empty and will score 0. Submit anyway?`)) return
    const graded = await api<Run>(`/benchmarks/runs/${run.id}/submit`, { body: { answers } })
    run.tasks.forEach(t => { try { localStorage.removeItem(`draft:bm:${run.id}:${t.id}`) } catch { /* ignore */ } })
    onSubmitted(graded)
  })
  const abandon = () => submit.run(async () => {
    if (!window.confirm('Leave this benchmark? These tasks are burned (you have seen them), and no score is recorded.')) return
    await api(`/benchmarks/runs/${run.id}/abandon`, { body: {} })
    navigate(`/missions/${run.mission_id}?c=${encodeURIComponent(run.competency_id)}`)
  })

  return (
    <div className="page narrow benchmark-page">
      <header className="page-head">
        <div>
          <span className="kicker">Benchmark · held-out · {run.competency_name}</span>
          <h1>Show what you can do unaided</h1>
          <p className="muted">
            {run.tasks.length} unseen tasks, graded on concept, implementation, reasoning and transfer. No hints, primer, tutor or sources.
            Answers save on this device as you type. Suggested time: {SUGGESTED_MIN} minutes.
          </p>
        </div>
        <Elapsed since={run.started_at} />
      </header>
      <div className="banner info">Your score becomes this competency's capability, the only number the app treats as demonstrated ability.</div>
      {run.tasks.map((t, i) => <TaskAnswer key={t.id} runId={run.id} task={t} index={i} />)}
      <ErrorBanner error={submit.error} />
      <div className="next-bar">
        <button className="ghost" disabled={submit.busy} onClick={abandon}>Abandon</button>
        <button className="primary big" disabled={submit.busy} onClick={doSubmit}>{submit.busy ? 'Grading strictly…' : 'Submit benchmark'}</button>
      </div>
    </div>
  )
}

function DimBars({ dims }: { dims: Record<Dim, number> }) {
  return (
    <ul className="dim-bars">
      {DIMS.map(d => (
        <li key={d}>
          <span>{d}</span>
          <div className="bar"><span style={{ width: `${dims[d]}%` }} className={dims[d] >= 80 ? 'good' : dims[d] >= 60 ? 'mid' : 'low'} /></div>
          <b>{dims[d]}</b>
        </li>
      ))}
    </ul>
  )
}

function Results({ run }: { run: Run }) {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="kicker">Benchmark result · {run.competency_name}</span>
          <h1>Demonstrated capability: {run.score}</h1>
          <p className="muted">
            {run.duration_s != null ? `${run.duration_s < 60 ? '<1' : Math.round(run.duration_s / 60)} min · ` : ''}submitted {new Date(`${run.submitted_at!.replace(' ', 'T')}Z`).toLocaleString()}.
            These tasks are now retired; the next benchmark uses fresh ones.
          </p>
        </div>
        <Score value={run.score} />
      </header>
      {run.dims && <Card title="By dimension"><DimBars dims={run.dims} /></Card>}
      {run.tasks.map((t, i) => {
        const r = run.results?.find(x => x.task_id === t.id)
        return (
          <Card key={t.id} title={<>Task {i + 1} <Chip>{t.kind}</Chip></>} actions={r && <Score value={r.score} />}>
            <div className="answer-prompt"><Md>{t.prompt}</Md></div>
            <blockquote className="your-answer">{run.answers?.[t.id] || '(no answer)'}</blockquote>
            {r && <><DimBars dims={r.dims} /><Md>{r.feedback}</Md></>}
            {t.expected && (
              <details>
                <summary className="link">What full marks looked like</summary>
                <Md>{t.expected}</Md>
                {t.rubric && <ul className="list plain">{DIMS.map(d => <li key={d}><div><strong>{d}</strong><small className="muted">{t.rubric![d]}</small></div></li>)}</ul>}
              </details>
            )}
          </Card>
        )
      })}
      <div className="actions">
        <Link className="button primary" to={`/missions/${run.mission_id}?c=${encodeURIComponent(run.competency_id)}`}>Back to the skill</Link>
        <Link className="button ghost" to="/">Today</Link>
      </div>
    </div>
  )
}
