import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, enc } from '../lib/api'
import type { MissionDetail, Mode } from '../lib/types'
import { Card, ErrorBanner } from '../components/ui'

interface PlanResponse {
  mission_id: string
  providers: { web: boolean; youtube: boolean; arxiv: boolean; github: boolean }
  search_plan: { competency_id: string; web: string[]; youtube: string }[]
}

type Step = { label: string; state: 'pending' | 'running' | 'done' | 'failed'; detail?: string }

export default function NewMission() {
  const navigate = useNavigate()
  const [topic, setTopic] = useState('')
  const [mode, setMode] = useState<Mode>('mastery')
  const [level, setLevel] = useState('intermediate')
  const [hours, setHours] = useState(5)
  const [notes, setNotes] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  const update = (i: number, patch: Partial<Step>) => setSteps(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function research() {
    setRunning(true)
    setError(null)
    setSteps([{ label: 'Planning skill tree, excellence criteria and search queries', state: 'running' }])
    try {
      const plan = await api<PlanResponse>('/missions/plan', { body: { topic, mode, level, hours_per_week: hours, notes } })
      const missing = [!plan.providers.web && 'web search (TAVILY_API_KEY)', !plan.providers.youtube && 'YouTube (YOUTUBE_API_KEY)'].filter(Boolean)
      if (missing.length) setWarning(`Searching with arXiv + GitHub only. Add ${missing.join(' and ')} for docs, courses, articles and videos.`)

      const mission = await api<MissionDetail>(`/missions/${plan.mission_id}`)
      const names = Object.fromEntries(mission.competencies.map(c => [c.id, c.name]))
      setSteps([
        { label: `Planned ${mission.competencies.length} competencies${mission.milestones.length ? ` and ${mission.milestones.length} milestones` : ''}`, state: 'done' },
        ...plan.search_plan.map(q => ({ label: `Searching & curating: ${names[q.competency_id] ?? q.competency_id}`, state: 'pending' as const })),
      ])

      // One competency at a time: Groq's free tier allows ~8k tokens/minute per model.
      // The server absorbs short rate limits; if Groq is still busy, wait once more and retry.
      for (const [i, q] of plan.search_plan.entries()) {
        update(i + 1, { state: 'running' })
        for (let attempt = 0; ; attempt++) {
          try {
            const r = await api<{ added: number; searched: number }>(`/missions/${plan.mission_id}/gather`, { body: q })
            update(i + 1, { state: 'done', detail: `${r.added} picked from ${r.searched} results` })
            break
          } catch (e) {
            const busy = e instanceof ApiError && e.status === 429
            if (busy && attempt === 0) {
              update(i + 1, { detail: 'Groq is busy, retrying in 20s…' })
              await new Promise(r => setTimeout(r, 20_000))
              continue
            }
            update(i + 1, { state: 'failed', detail: `${(e as Error).message} Use "Find more" on this skill later.` })
            break
          }
        }
      }
      navigate(`/missions/${enc(plan.mission_id)}?review=1`)
    } catch (e) {
      setError((e as Error).message)
      setSteps(s => s.map(x => (x.state === 'running' ? { ...x, state: 'failed' } : x)))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="kicker">New mission</span>
          <h1>What do you want to get excellent at?</h1>
          <p className="muted">The agent plans a skill tree, runs real searches for each competency, and proposes resources. Nothing enters your library until you approve it.</p>
        </div>
      </header>

      <Card>
        <label className="field">
          <span>Target skill</span>
          <textarea rows={2} value={topic} disabled={running} onChange={e => setTopic(e.target.value)}
            placeholder="e.g. Production LLM engineering · Product management for AI products · Controlling a drone with an LLM" />
        </label>

        <div className="field">
          <span>Mode</span>
          <div className="segmented">
            <button className={mode === 'mastery' ? 'on' : ''} disabled={running} onClick={() => setMode('mastery')}>
              <strong>Mastery</strong><small>Graded recall → practice → build loop, error tracking, spaced review.</small>
            </button>
            <button className={mode === 'project' ? 'on' : ''} disabled={running} onClick={() => setMode('project')}>
              <strong>Project</strong><small>Build-first milestones, an AI guide, a log of what worked. Lighter grading.</small>
            </button>
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Current level</span>
            <select value={level} disabled={running} onChange={e => setLevel(e.target.value)}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Some background</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label className="field">
            <span>Hours / week</span>
            <input type="number" min={1} max={40} value={hours} disabled={running} onChange={e => setHours(Number(e.target.value))} />
          </label>
        </div>

        <label className="field">
          <span>Context (optional)</span>
          <input value={notes} disabled={running} onChange={e => setNotes(e.target.value)} placeholder="What you already know, constraints, what 'done' looks like for you" />
        </label>

        <ErrorBanner error={error} />
        <div className="actions">
          <button className="primary big" disabled={!topic.trim() || running} onClick={research}>
            {running ? 'Researching…' : 'Research & plan →'}
          </button>
        </div>
      </Card>

      {warning && <div className="banner warn">{warning}</div>}
      {steps.length > 0 && (
        <Card title="Agent progress">
          <ul className="steps">
            {steps.map((s, i) => (
              <li key={i} className={s.state}>
                <span className="step-icon">{s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : s.state === 'running' ? <span className="spinner" /> : '○'}</span>
                <span>{s.label}{s.detail && <small className="muted"> · {s.detail}</small>}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
