import { useState } from 'react'
import { api, useAction } from '../lib/api'
import { useDraft } from '../lib/draft'
import { type RunPhase, type RunResult, runPython } from '../lib/python'
import type { Grade, Item } from '../lib/types'
import { Chip, ErrorBanner, verdictTone } from './ui'
import { Md } from './Md'

const PHASE_LABEL: Record<RunPhase, string> = {
  loading: 'Loading Python (~8 MB, first run only)…',
  installing: 'Installing imported packages…',
  running: 'Running…',
}

const STARTER = `import numpy as np

# Print the evidence your definition of done asks for.
`

/**
 * Build stage with real execution: Python runs in the browser, and the captured output (not a pasted claim)
 * is what gets graded.
 */
export function CodeRunner({ item, missionId, sessionId, result, onGraded }: {
  item: Item
  missionId: string
  sessionId: string
  result?: Grade & { artifact?: RunResult & { code: string } }
  onGraded: (g: Grade & { artifact: RunResult & { code: string } }) => void
}) {
  const [code, setCode] = useDraft(result ? null : `${sessionId}:build-code`, result?.artifact?.code ?? STARTER)
  const [run, setRun] = useState<RunResult | null>(result?.artifact ?? null)
  const [phase, setPhase] = useState<RunPhase | null>(null)
  const submit = useAction()

  const execute = async () => {
    setPhase('running')
    const r = await runPython(code, setPhase)
    setRun(r)
    setPhase(null)
  }

  const grade = () => submit.run(async () => {
    const r = run ?? (await runPython(code, setPhase))
    setPhase(null)
    setRun(r)
    const answer = `\`\`\`python\n${code}\n\`\`\`\n\nCaptured output (ran in browser, ${r.runtime_ms} ms):\n\`\`\`\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}\n\`\`\``
    const g = await api<Grade>('/attempts', {
      body: {
        session_id: sessionId, mission_id: missionId, competency_id: item.competency_id ?? null, stage: 'build',
        prompt: item.prompt, expected: item.expected, answer, artifact: { code, ...r },
      },
    })
    onGraded({ ...g, answer, artifact: { code, ...r } })
  })

  /** Tab indents instead of leaving the field; Ctrl/⌘+Enter runs. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!phase) execute(); return }
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: a, selectionEnd: b } = el
    setCode(code.slice(0, a) + '    ' + code.slice(b))
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4 })
  }

  const busy = Boolean(phase) || submit.busy
  return (
    <article className={`answer code-runner ${result ? `graded ${result.verdict}` : ''}`}>
      <div className="answer-meta"><Chip>build</Chip><Chip tone="info">runs in your browser</Chip></div>
      <div className="answer-prompt"><Md>{item.prompt}</Md></div>

      <div className="runner">
        <textarea className="code" value={code} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          readOnly={Boolean(result)} rows={16} onChange={e => { setCode(e.target.value); setRun(null) }} onKeyDown={onKeyDown}
          aria-label="Python code" />
        <div className="output" aria-live="polite">
          <div className="output-head">
            <strong>Output</strong>
            {run && <span className="muted">{run.runtime_ms} ms{run.timed_out ? ' · timed out' : ''}</span>}
          </div>
          {phase ? <p className="muted">{PHASE_LABEL[phase]}</p> : run ? (
            <>
              {run.stdout && <pre>{run.stdout}</pre>}
              {run.stderr && <pre className="stderr">{run.stderr}</pre>}
              {!run.stdout && !run.stderr && <p className="muted">No output. Print the evidence your definition of done asks for.</p>}
            </>
          ) : <p className="muted">Run to see output. numpy · pandas · scipy · scikit-learn · tiktoken available. No GPU or PyTorch; 20 s limit.</p>}
        </div>
      </div>

      {!result ? (
        <>
          <ErrorBanner error={submit.error} />
          <div className="actions">
            <button className="secondary" disabled={busy} onClick={execute}>▶ Run</button>
            <button className="primary" disabled={busy || !code.trim()} onClick={grade}>
              {submit.busy ? 'Grading against real output…' : run ? 'Submit code + output' : 'Run & submit'}
            </button>
            <span className="muted kbd-hint">Ctrl/⌘ + Enter to run · Tab indents</span>
          </div>
        </>
      ) : (
        <div className="feedback">
          <div className="feedback-head">
            <Chip tone={verdictTone(result.verdict)}>{result.verdict} · {Math.round(result.score)}</Chip>
            {result.verified ? <Chip tone="good">✓ verified by real output</Chip> : <Chip>not verified</Chip>}
            {result.error && <Chip tone="warn">error: {result.error.concept}</Chip>}
          </div>
          <Md>{result.feedback}</Md>
        </div>
      )}
    </article>
  )
}
