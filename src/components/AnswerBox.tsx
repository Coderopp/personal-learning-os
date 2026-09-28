import { useState } from 'react'
import { api, useAction } from '../lib/api'
import type { Grade, Item } from '../lib/types'
import { Md } from './Md'
import { Chip, ErrorBanner, verdictTone } from './ui'

/**
 * Attempt-first question card: the expected answer stays hidden until the learner has committed to an attempt.
 * Grading goes through /attempts, which records errors and schedules reviews server-side.
 */
export function AnswerBox({ item, missionId, stage, sessionId, result, onGraded, index, placeholder }: {
  item: Item
  missionId: string
  stage: string
  sessionId?: string
  result?: Grade
  onGraded: (g: Grade) => void
  index?: number
  placeholder?: string
}) {
  const [answer, setAnswer] = useState(result?.answer ?? '')
  const [hint, setHint] = useState<string | null>(null)
  const [showExpected, setShowExpected] = useState(false)
  const grade = useAction()
  const hinting = useAction()

  const submit = () => grade.run(async () => {
    const g = await api<Grade>('/attempts', {
      body: {
        session_id: sessionId, mission_id: missionId, competency_id: item.competency_id ?? null, stage,
        prompt: item.prompt, expected: item.expected, answer, review_id: item.review_id, error_id: item.error_id,
      },
    })
    onGraded({ ...g, answer })
  })

  const getHint = () => hinting.run(async () => {
    const r = await api<{ markdown: string }>('/tutor', {
      body: { task: 'hint', competency_id: item.competency_id, question: item.prompt, answer },
    })
    setHint(r.markdown)
  })

  return (
    <article className={`answer ${result ? `graded ${result.verdict}` : ''}`}>
      <div className="answer-meta">
        {index != null && <span className="muted">Q{index + 1}</span>}
        <Chip>{item.type}</Chip>
        {item.review_id && <Chip tone="info">spaced review</Chip>}
        {item.error_id && <Chip tone="warn">targets a known error</Chip>}
      </div>
      <div className="answer-prompt"><Md>{item.prompt}</Md></div>

      {!result ? (
        <>
          <textarea
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder={placeholder ?? 'Answer from memory first. Reasoning beats wording.'}
            rows={5}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer.trim()) submit() }}
          />
          {hint && <div className="hint"><strong>Hint</strong><Md>{hint}</Md></div>}
          <ErrorBanner error={grade.error ?? hinting.error} />
          <div className="actions">
            <button className="primary" disabled={!answer.trim() || grade.busy} onClick={submit}>
              {grade.busy ? 'Grading…' : 'Submit attempt'}
            </button>
            <button className="ghost" disabled={hinting.busy || grade.busy} onClick={getHint}>
              {hinting.busy ? 'Thinking…' : 'Smallest hint'}
            </button>
            <span className="muted kbd-hint">Ctrl/⌘ + Enter to submit</span>
          </div>
        </>
      ) : (
        <div className="feedback">
          <div className="feedback-head">
            <Chip tone={verdictTone(result.verdict)}>{result.verdict} · {Math.round(result.score)}</Chip>
            {result.error && <Chip tone={result.error.recurring ? 'bad' : 'warn'}>{result.error.recurring ? 'recurring error' : 'new error'}: {result.error.concept}</Chip>}
            {result.review && <span className="muted">next review in {result.review.next_in_days}d</span>}
            {!result.review && result.verdict !== 'correct' && <span className="muted">added to reviews (tomorrow)</span>}
          </div>
          <blockquote className="your-answer">{result.answer}</blockquote>
          <Md>{result.feedback}</Md>
          {showExpected
            ? <div className="expected"><strong>A strong answer includes</strong><Md>{item.expected}</Md></div>
            : <button className="link" onClick={() => setShowExpected(true)}>Show what a strong answer includes</button>}
        </div>
      )}
    </article>
  )
}
