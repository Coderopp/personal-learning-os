import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { Grade, Item, Moment, Resource, Session } from '../lib/types'
import { MomentList } from './Videos'
import type { Path } from '../lib/types'
import { unitHref } from '../components/PathView'
import { Card, Chip, Empty, ErrorBanner, Spinner, verdictTone } from '../components/ui'
import { AnswerBox } from '../components/AnswerBox'
import { CodeRunner } from '../components/CodeRunner'
import { AskTutor } from '../components/AskTutor'
import { Md } from '../components/Md'

type State = Record<string, unknown>
type Results = Record<string, Grade>

const MASTERY = ['Recall', 'Learn', 'Practice', 'Build', 'Diagnose', 'Reflect']
const PROJECT = ['Milestone', 'Learn', 'Build & log', 'Recall']
const REVIEW = ['Review']
const PRACTICE_TARGET = 3

/** Counts a focused minute only while the page is visible and the learner touched it in the last 3 minutes. */
function useFocusHeartbeat(sessionId: string, active: boolean) {
  const last = useRef(Date.now())
  useEffect(() => {
    if (!active) return
    const mark = () => { last.current = Date.now() }
    const events = ['keydown', 'pointerdown', 'scroll'] as const
    events.forEach(e => window.addEventListener(e, mark, { passive: true }))
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - last.current < 180_000) {
        api(`/sessions/${sessionId}/heartbeat`, { body: {} }).catch(() => {})
      }
    }, 60_000)
    return () => { clearInterval(t); events.forEach(e => window.removeEventListener(e, mark)) }
  }, [sessionId, active])
}

export default function SessionPage() {
  const { id = '' } = useParams()
  const { data, error, loading, reload, setData } = useApi<Session>(`/sessions/${id}`)
  useFocusHeartbeat(id, Boolean(data && !data.ended_at))
  const [saveError, setSaveError] = useState<string | null>(null)
  const latest = useRef<State>({})
  if (data) latest.current = data.state

  if (loading && !data) return <div className="page"><Spinner label="Loading session…" /></div>
  if (error || !data) return <div className="page"><ErrorBanner error={error ?? 'Session not found'} onRetry={reload} /></div>

  const stages = data.kind === 'review' ? REVIEW : data.mode === 'project' ? PROJECT : MASTERY
  const state = data.state

  /** Update locally and persist, so the other device resumes at the same point. */
  const patch = (p: State, stage?: number) => {
    latest.current = { ...latest.current, ...p }
    setData(s => s && { ...s, state: { ...s.state, ...p }, stage: stage ?? s.stage })
    api(`/sessions/${id}/state`, { body: { patch: p, stage } })
      .then(() => setSaveError(null))
      .catch(e => setSaveError(`Not saved: ${(e as Error).message}`))
  }
  const go = (stage: number) => { patch({}, stage); window.scrollTo(0, 0) }
  const results = (state.results ?? {}) as Results
  // Read from the ref so two answers graded close together don't overwrite each other.
  const setResult = (itemId: string, g: Grade) => patch({ results: { ...((latest.current.results ?? {}) as Results), [itemId]: g } })

  if (data.ended_at) return <Done session={data} />

  const focus = state.focus as { id: string; name: string; reason: string } | undefined
  const milestone = state.milestone as { id: string; title: string; description: string; competency_id: string | null } | undefined

  return (
    <div className="page session-page">
      <header className="page-head">
        <div>
          <span className="kicker">
            {data.kind === 'review' ? 'Spaced review' : data.mode === 'project' ? 'Project session' : 'Mastery session'}
            {' · '}{stages[data.stage]} ({data.stage + 1}/{stages.length})
          </span>
          <h1>{data.kind === 'review' ? 'Recall before you forget' : focus?.name ?? milestone?.title}</h1>
          {focus && <p className="muted">{focus.reason}</p>}
          {milestone && <p className="muted">{milestone.description}</p>}
        </div>
        <div className="head-stats"><span className="muted">{data.focused_minutes} focused min</span></div>
      </header>

      {stages.length > 1 && (
        <ol className="stepper">
          {stages.map((s, i) => (
            <li key={s} className={i === data.stage ? 'current' : i < data.stage ? 'past' : ''}>
              <button onClick={() => go(i)}><span>{i + 1}</span>{s}</button>
            </li>
          ))}
        </ol>
      )}
      <ErrorBanner error={saveError} />

      {data.kind === 'review' && <ReviewStage session={data} results={results} setResult={setResult} />}
      {data.kind === 'full' && data.mode === 'mastery' && (
        <MasteryStage session={data} stage={data.stage} results={results} setResult={setResult} patch={patch} go={go} reload={reload} />
      )}
      {data.kind === 'full' && data.mode === 'project' && (
        <ProjectStage session={data} stage={data.stage} results={results} setResult={setResult} patch={patch} go={go} reload={reload} />
      )}
    </div>
  )
}

interface StageProps {
  session: Session
  stage: number
  results: Results
  setResult: (id: string, g: Grade) => void
  patch: (p: State, stage?: number) => void
  go: (stage: number) => void
  reload: () => void
}

function Next({ onClick, label, note }: { onClick: () => void; label: string; note?: string }) {
  return (
    <div className="next-bar">
      {note && <span className="muted">{note}</span>}
      <button className="primary big" onClick={onClick}>{label} →</button>
    </div>
  )
}

function Items({ items, session, stage, results, setResult }: { items: Item[]; session: Session; stage: string; results: Results; setResult: (id: string, g: Grade) => void }) {
  return (
    <div className="stack">
      {items.map((it, i) => (
        <AnswerBox key={it.id} item={it} index={i} missionId={session.mission_id} sessionId={session.id} stage={stage}
          result={results[it.id]} onGraded={g => setResult(it.id, g)} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Mastery

function MasteryStage({ session, stage, results, setResult, patch, go, reload }: StageProps) {
  const s = session.state
  const focus = s.focus as { id: string; name: string }
  const retrieve = (s.retrieve ?? []) as Item[]
  const answered = retrieve.filter(i => results[i.id]).length

  switch (stage) {
    case 0:
      return (
        <>
          <Card title="Recall from memory" subtitle="No sources yet. Retrieval before rereading is where the learning happens." />
          <Items items={retrieve} session={session} stage="retrieve" results={results} setResult={setResult} />
          <Next onClick={() => go(1)} label="Learn what's missing"
            note={answered < retrieve.length ? `${retrieve.length - answered} unanswered: skipping them hides your gaps` : undefined} />
        </>
      )
    case 1:
      return <LearnStage session={session} focus={focus} patch={patch} onNext={() => go(2)} />
    case 2:
      return <PracticeStage session={session} focus={focus} results={results} setResult={setResult} patch={patch} onNext={() => go(3)} />
    case 3: {
      const task = s.build_task as { title: string; instructions: string; definition_of_done: string; runs_in_browser?: boolean }
      const item: Item = {
        id: 'build', type: 'build', competency_id: focus.id,
        prompt: `**${task.title}**\n\n${task.instructions}\n\n**Done when:** ${task.definition_of_done}`,
        expected: task.definition_of_done,
      }
      // Browser execution by default; the coach marks GPU/framework/document tasks as local-only.
      const local = (s.build_mode as string | undefined) === 'local' || (task.runs_in_browser === false && s.build_mode !== 'browser')
      return (
        <>
          <Card title="Build: make it executable"
            subtitle={local ? 'Run it on your machine, then paste the code and its output (or a repo link + results).' : 'Write and run Python right here. The real output is what gets graded.'}
            actions={!results.build && (
              <button className="ghost small" onClick={() => patch({ build_mode: local ? 'browser' : 'local' })}>
                {local ? 'Run in browser instead' : "I'll run it locally"}
              </button>
            )} />
          {local
            ? <AnswerBox item={item} missionId={session.mission_id} sessionId={session.id} stage="build" result={results.build}
                onGraded={g => setResult('build', g)} placeholder={'```python\n# your code\n```\n\nOutput / measurements:\n'} />
            : <CodeRunner item={item} missionId={session.mission_id} sessionId={session.id} result={results.build}
                onGraded={g => setResult('build', g)} />}
          <Next onClick={() => { reload(); go(4) }} label="Diagnose" note={results.build ? undefined : 'You can skip the build if you are out of time'} />
        </>
      )
    }
    case 4:
      return <DiagnoseStage session={session} onNext={() => go(5)} />
    default:
      return <ReflectStage session={session} reload={reload} />
  }
}

function LearnStage({ session, focus, patch, onNext }: { session: Session; focus: { id: string; name: string }; patch: StageProps['patch']; onNext: () => void }) {
  const learn = session.state.learn as string | undefined
  const moments = (session.state.learn_videos ?? []) as Moment[]
  const action = useAction()
  const resources = useApi<Resource[]>(`/resources?competency=${encodeURIComponent(focus.id)}&status=accepted`)
  const path = useApi<Path | null>(`/paths/${focus.id.split('/').map(encodeURIComponent).join('/')}`)
  const core = path.data?.units.filter(u => ['foundation', 'deepen', 'practice', 'latest'].includes(u.role)) ?? []
  const nextUnit = core.find(u => u.status !== 'done')
  const picked = (session.state.learn_resource_ids ?? []) as string[]
  const shown = (resources.data ?? []).sort((a, b) => Number(picked.includes(b.id)) - Number(picked.includes(a.id))).slice(0, 4)

  const explain = () => action.run(async () => {
    const r = await api<{ markdown: string; moments: Moment[] }>(`/sessions/${session.id}/learn`, { body: {} })
    patch({ learn: r.markdown, learn_videos: r.moments })
  })
  // Generate the targeted explanation on arrival.
  useEffect(() => { if (!learn && !action.busy) explain() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Card title="Learn: only the gap" subtitle="The smallest explanation that fixes what your recall exposed.">
        {action.busy && <Spinner label="Finding your gap…" />}
        <ErrorBanner error={action.error} onRetry={explain} />
        {learn && <Md>{learn}</Md>}
      </Card>
      {nextUnit && (
        <Card title={`Continue your path: step ${core.indexOf(nextUnit) + 1} of ${core.length}`} subtitle={nextUnit.why}>
          <div className="actions">
            <Link className="button primary" to={unitHref(nextUnit, path.data?.project_id)}>{nextUnit.title}</Link>
            <span className="muted small-text">{nextUnit.role}{nextUnit.minutes ? ` · ~${nextUnit.minutes} min` : ''} · this session stays open to resume</span>
          </div>
        </Card>
      )}
      {moments.length > 0 && (
        <Card title="Watch the exact moment" subtitle="Where your saved videos explain this gap.">
          <MomentList moments={moments} />
        </Card>
      )}
      {shown.length > 0 && (
        <Card title="Go to the source" subtitle="Read only the section that covers the gap.">
          <ul className="list">
            {shown.map(r => (
              <li key={r.id}>
                <div>
                  <a href={r.url} target="_blank" rel="noreferrer"><strong>{r.title}</strong></a>
                  <small className="muted">{r.reason}</small>
                </div>
                {picked.includes(r.id) && <Chip tone="info">suggested</Chip>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Ask a follow-up"><AskTutor competencyId={focus.id} /></Card>
      <Next onClick={onNext} label="Practice" />
    </>
  )
}

function PracticeStage({ session, focus, results, setResult, patch, onNext }: {
  session: Session; focus: { id: string; name: string }; results: Results; setResult: (id: string, g: Grade) => void; patch: StageProps['patch']; onNext: () => void
}) {
  const practice = (session.state.practice ?? []) as (Item & { difficulty: number })[]
  const action = useAction()

  /** Calibrate: ≥80 → harder, <50 → easier (toward prerequisites), else hold. */
  const nextDifficulty = () => {
    const last = practice[practice.length - 1]
    if (!last) return 3
    const r = results[last.id]
    if (!r) return last.difficulty
    return Math.max(1, Math.min(5, last.difficulty + (r.score >= 80 ? 1 : r.score < 50 ? -1 : 0)))
  }
  const generate = () => action.run(async () => {
    const q = await api<Item & { difficulty: number }>('/questions/generate', {
      body: { mission_id: session.mission_id, competency_id: focus.id, difficulty: nextDifficulty(), asked: practice.map(p => p.prompt) },
    })
    patch({ practice: [...practice, { ...q, id: q.id, competency_id: focus.id }] })
  })
  const lastAnswered = !practice.length || Boolean(results[practice[practice.length - 1].id])
  useEffect(() => { if (!practice.length && !action.busy) generate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Card title="Practice at the edge" subtitle={`Difficulty adapts to your answers. ${practice.length}/${PRACTICE_TARGET} done.`} />
      <div className="stack">
        {practice.map((q, i) => (
          <div key={q.id}>
            <span className="muted">difficulty {q.difficulty}/5</span>
            <AnswerBox item={q} index={i} missionId={session.mission_id} sessionId={session.id} stage="practice" result={results[q.id]} onGraded={g => setResult(q.id, g)} />
          </div>
        ))}
      </div>
      {action.busy && <Spinner label="Generating a calibrated question…" />}
      <ErrorBanner error={action.error} onRetry={generate} />
      <div className="next-bar">
        {lastAnswered && !action.busy && (
          <button className={practice.length >= PRACTICE_TARGET ? 'ghost' : 'secondary big'} onClick={generate}>
            {practice.length >= PRACTICE_TARGET ? 'One more' : 'Next question'}
          </button>
        )}
        {(practice.length >= PRACTICE_TARGET || practice.length > 0) && <button className="primary big" onClick={onNext}>Build →</button>}
      </div>
    </>
  )
}

function DiagnoseStage({ session, onNext }: { session: Session; onNext: () => void }) {
  const attempts = session.attempts ?? []
  const errors = attempts.filter(a => a.error_id)
  const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / attempts.length) : null
  return (
    <>
      <Card title="Diagnose" subtitle="Classify the failure before searching for a fix. Every real misunderstanding is now training data.">
        <div className="metrics compact">
          <div className="metric"><span className="metric-label">Attempts</span><strong>{attempts.length}</strong></div>
          <div className="metric"><span className="metric-label">Average</span><strong>{avg ?? '—'}</strong></div>
          <div className="metric"><span className="metric-label">Errors captured</span><strong>{errors.length}</strong></div>
        </div>
        {errors.length ? (
          <ul className="list">
            {errors.map(a => (
              <li key={a.id}>
                <div>
                  <strong>{a.concept}</strong>
                  <small className="muted">{a.feedback}</small>
                </div>
                <div className="chips">
                  <Chip>{a.category}</Chip>
                  <Chip tone={a.error_status === 'recurring' ? 'bad' : 'warn'}>{a.error_status === 'recurring' ? `recurring · ${a.occurrences}×` : 'new'}</Chip>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No misunderstandings captured this session.{attempts.some(a => a.verdict !== 'correct') ? ' Partial answers were gaps of detail, not wrong models.' : ''}</p>}
        <p className="muted small-text">Missed items were added to your review queue for tomorrow. Recurring errors are injected into future sessions automatically. <Link to="/errors">Error Lab →</Link></p>
      </Card>
      <Card title="This session's attempts">
        <ul className="list">
          {attempts.map(a => (
            <li key={a.id}>
              <div><Md inline>{a.prompt.length > 160 ? `${a.prompt.slice(0, 160)}…` : a.prompt}</Md><small className="muted">{a.stage}{a.gap ? ` · gap: ${a.gap}` : ''}</small></div>
              <Chip tone={verdictTone(a.verdict)}>{Math.round(a.score)}</Chip>
            </li>
          ))}
        </ul>
      </Card>
      <Next onClick={onNext} label="Reflect" />
    </>
  )
}

function ReflectStage({ session, reload }: { session: Session; reload: () => void }) {
  const prompts = (session.state.reflect_prompts ?? [
    'What did you misunderstand?', 'What evidence changed your model?', 'Explain it without the implementation.',
  ]) as string[]
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const action = useAction()
  const submit = () => action.run(async () => {
    await api(`/sessions/${session.id}/reflect`, { body: { answers: Object.fromEntries(prompts.map((p, i) => [p, answers[i] ?? ''])) } })
    reload()
  })
  return (
    <Card title="Reflect" subtitle="Your answers become retention items on the D1 → D60 ladder.">
      {prompts.map((p, i) => (
        <label key={i} className="field">
          <span>{p}</span>
          <textarea rows={3} value={answers[i] ?? ''} onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))} />
        </label>
      ))}
      <ErrorBanner error={action.error} />
      <div className="actions">
        <button className="primary big" disabled={action.busy || !Object.values(answers).some(a => a.trim())} onClick={submit}>
          {action.busy ? 'Scheduling retention…' : 'Finish session'}
        </button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- Project

function ProjectStage({ session, stage, results, setResult, patch, go, reload }: StageProps) {
  const s = session.state
  const ms = s.milestone as { id: string; title: string; description: string; competency_id: string | null }
  const recall = (s.recall ?? []) as Item[]
  const logResult = s.log_result as { feedback: string; errors: { concept: string; category: string }[]; milestone_done: boolean } | undefined
  const [form, setForm] = useState({ built: '', worked: '', failed: '', next: '' })
  const action = useAction()
  const finish = useAction()
  const resources = useApi<Resource[]>(ms.competency_id ? `/resources?competency=${encodeURIComponent(ms.competency_id)}&status=accepted` : null)

  const submitLog = () => action.run(async () => {
    const r = await api<{ feedback: string; errors: { concept: string; category: string }[]; recall: Item[]; milestone_done: boolean }>(
      `/milestones/${ms.id}/log`, { body: { session_id: session.id, ...form } })
    patch({ log_result: { feedback: r.feedback, errors: r.errors, milestone_done: r.milestone_done }, recall: [...recall, ...r.recall] })
  })

  switch (stage) {
    case 0:
      return (
        <>
          <Card title={ms.title} subtitle="The milestone for this session. Decide what 'working' looks like before you start.">
            <p>{ms.description}</p>
          </Card>
          <Next onClick={() => go(1)} label="What do I need to know?" />
        </>
      )
    case 1:
      return (
        <>
          <Card title="Learn just enough" subtitle="Ask the guide what you need for this milestone. Keep it to what you'll use today.">
            <AskTutor competencyId={ms.competency_id ?? ''} />
          </Card>
          {resources.data && resources.data.length > 0 && (
            <Card title="Relevant resources">
              <ul className="list">
                {resources.data.slice(0, 5).map(r => (
                  <li key={r.id}><div><a href={r.url} target="_blank" rel="noreferrer"><strong>{r.title}</strong></a><small className="muted">{r.reason}</small></div></li>
                ))}
              </ul>
            </Card>
          )}
          <Next onClick={() => go(2)} label="Build" />
        </>
      )
    case 2:
      return (
        <>
          <Card title="Build, then log it" subtitle="Evidence over impressions: what ran, what the output was, what broke.">
            {(['built', 'worked', 'failed', 'next'] as const).map(k => (
              <label key={k} className="field">
                <span>{{ built: 'What did you build / try?', worked: 'What worked (evidence)?', failed: 'What failed or confused you?', next: 'What would you try next?' }[k]}</span>
                <textarea rows={k === 'built' ? 4 : 2} value={form[k]} disabled={Boolean(logResult)} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
              </label>
            ))}
            <ErrorBanner error={action.error} />
            {!logResult && (
              <button className="primary" disabled={action.busy || !form.built.trim()} onClick={submitLog}>{action.busy ? 'Reviewing your log…' : 'Log & get feedback'}</button>
            )}
          </Card>
          {logResult && (
            <Card title={logResult.milestone_done ? 'Milestone complete ✓' : 'Coach feedback'}>
              <Md>{logResult.feedback}</Md>
              {logResult.errors.length > 0 && (
                <div className="chips">{logResult.errors.map((e, i) => <Chip key={i} tone="warn">{e.category}: {e.concept}</Chip>)}</div>
              )}
            </Card>
          )}
          {logResult && <Next onClick={() => go(3)} label="Quick recall" />}
        </>
      )
    default:
      return (
        <>
          <Card title="Recall" subtitle="Two questions on what you just used, so the project leaves knowledge behind." />
          {recall.length ? <Items items={recall} session={session} stage="recall" results={results} setResult={setResult} /> : <Empty>No recall items. Log your build first.</Empty>}
          <ErrorBanner error={finish.error} />
          <div className="next-bar">
            <button className="primary big" disabled={finish.busy} onClick={() => finish.run(async () => {
              await api(`/sessions/${session.id}/finish-project`, { body: { summary: logResult?.feedback } })
              reload()
            })}>Finish session</button>
          </div>
        </>
      )
  }
}

// ---------------------------------------------------------------- Review + done

function ReviewStage({ session, results, setResult }: { session: Session; results: Results; setResult: (id: string, g: Grade) => void }) {
  const navigate = useNavigate()
  const items = (session.state.items ?? []) as Item[]
  const done = items.filter(i => results[i.id]).length
  const correct = items.filter(i => results[i.id]?.verdict === 'correct').length
  const end = useAction()
  return (
    <>
      <Card title={`${done}/${items.length} reviewed · ${correct} correct`} subtitle="Correct moves an item up the ladder (D1 → D3 → D7 → D14 → D30 → D60). A miss sends it back to D1." />
      <Items items={items} session={session} stage="review" results={results} setResult={setResult} />
      <ErrorBanner error={end.error} />
      <div className="next-bar">
        <button className="primary big" disabled={end.busy} onClick={() => end.run(async () => {
          await api(`/sessions/${session.id}/end`, { body: {} })
          navigate('/')
        })}>{done < items.length ? 'Stop here' : 'Done'}</button>
      </div>
    </>
  )
}

function Done({ session }: { session: Session }) {
  const s = session.state
  return (
    <div className="page narrow">
      <Empty>
        <span className="kicker">Session complete</span>
        <h2>{(s.summary as string) ?? 'Nice work.'}</h2>
        <p className="muted">
          {session.focused_minutes} focused minutes · {session.attempts?.length ?? 0} graded attempts
          {s.new_reviews ? ` · ${s.new_reviews as number} new review items` : ''}
        </p>
        <div className="actions center"><Link className="button primary" to="/">Back to Today</Link><Link className="button ghost" to="/errors">Error Lab</Link></div>
      </Empty>
    </div>
  )
}
