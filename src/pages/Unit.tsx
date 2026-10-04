import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { api, useAction, useApi } from '../lib/api'
import type { Grade, Unit } from '../lib/types'
import { Card, Chip, ErrorBanner, Spinner } from '../components/ui'
import { AnswerBox } from '../components/AnswerBox'
import { Md } from '../components/Md'

const PdfViewer = lazy(() => import('../components/PdfViewer'))

interface Readable { format: 'html' | 'markdown' | 'none'; body: string | null; title: string | null; author: string | null; published: string | null; words: number; paid: boolean; via: string }
type UnitDetail = Unit & { content: Readable | null; competency: { name: string; mission_id: string } | null; project_id: string | null }

/** Check questions at the end of a step; answering all of them completes it. */
function UnitCheck({ unit, pdfText, onDone }: { unit: UnitDetail; pdfText?: string; onDone: () => void }) {
  const [questions, setQuestions] = useState(unit.questions)
  const [results, setResults] = useState<Record<string, Grade>>({})
  const load = useAction()
  const get = () => load.run(async () => setQuestions(await api(`/units/${unit.id}/questions`, { body: { text: pdfText } })))
  const answered = questions?.filter(q => results[q.id]).length ?? 0
  useEffect(() => {
    if (questions && answered === questions.length && unit.status !== 'done') {
      api(`/units/${unit.id}/complete`, { body: {} }).then(onDone).catch(() => {})
    }
  }, [answered]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Check yourself" subtitle="Answer from memory. Misses become review items and errors, like the rest of your practice.">
      {!questions ? (
        <>
          <ErrorBanner error={load.error} />
          <div className="actions">
            <button className="primary" disabled={load.busy || (unit.kind === 'pdf' && !pdfText)} onClick={get}>{load.busy ? 'Writing questions…' : "I've studied this: quiz me"}</button>
            <button className="ghost" onClick={() => api(`/units/${unit.id}/complete`, { body: {} }).then(onDone)}>Mark done without quiz</button>
          </div>
        </>
      ) : (
        <div className="stack">
          {questions.map((q, i) => (
            <AnswerBox key={q.id} item={q} index={i} missionId={unit.mission_id} stage="unit" result={results[q.id]}
              onGraded={g => setResults(r => ({ ...r, [q.id]: g }))} />
          ))}
          {answered === questions.length && <p className="banner info">Step complete ✓ <Link to={`/missions/${unit.mission_id}?c=${encodeURIComponent(unit.competency_id)}`}>Back to the path</Link></p>}
        </div>
      )}
    </Card>
  )
}

function Reader({ unit, onProgress }: { unit: UnitDetail; onProgress: (p: number) => void }) {
  const c = unit.content
  const ref = useRef<HTMLDivElement>(null)
  // Untrusted third-party HTML: sanitize, and make every link open in a new tab.
  const html = useMemo(() => {
    if (c?.format !== 'html' || !c.body) return ''
    const clean = DOMPurify.sanitize(c.body, { FORBID_TAGS: ['style', 'form', 'input', 'iframe'], FORBID_ATTR: ['style'] })
    return clean.replace(/<a /g, '<a target="_blank" rel="noreferrer noopener" ')
  }, [c])
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([])
  useEffect(() => {
    if (!ref.current) return
    const hs = [...ref.current.querySelectorAll('h1, h2, h3')] as HTMLElement[]
    hs.forEach((h, i) => { h.id = `sec-${i}` })
    setToc(hs.map((h, i) => ({ id: `sec-${i}`, text: h.innerText.slice(0, 80), level: Number(h.tagName[1]) })).filter(t => t.text))
    const onScroll = () => {
      const r = ref.current?.getBoundingClientRect()
      if (r) onProgress(Math.max(0, Math.min(1, (window.innerHeight - r.top) / r.height)))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [html, c]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!c || c.format === 'none') {
    return (
      <Card>
        <p>This source can't be shown inside Learning OS{c?.paid ? ' (paid post)' : ''}. Read it on the original site, then come back for the check questions.</p>
        <a className="button primary" href={unit.url} target="_blank" rel="noreferrer">Open original ↗</a>
      </Card>
    )
  }
  return (
    <div className="reader-layout">
      {toc.length > 2 && (
        <nav className="reader-toc">
          <strong className="muted small-text">Sections</strong>
          {toc.map(t => <a key={t.id} href={`#${t.id}`} style={{ paddingLeft: (t.level - 1) * 10 }}>{t.text}</a>)}
        </nav>
      )}
      <article className="card reader" ref={ref}>
        {c.paid && <p className="banner warn">Paid post: this is the public preview. <a href={unit.url} target="_blank" rel="noreferrer">Read the full post on the original site ↗</a></p>}
        {c.format === 'html' ? <div className="reader-body" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="reader-body"><Md>{c.body ?? ''}</Md></div>}
      </article>
    </div>
  )
}

function CodeUnit({ unit }: { unit: UnitDetail }) {
  const info = unit.data.info
  const [file, setFile] = useState<{ path: string; text: string | null } | null>(null)
  const action = useAction()
  if (!info) return <Card><p>Couldn't load this repository. <a href={unit.url} target="_blank" rel="noreferrer">Open on GitHub ↗</a></p></Card>
  return (
    <div className="stack">
      <Card title={info.repo} subtitle={`${info.description ?? ''} · ${info.stars.toLocaleString()} stars`}
        actions={<a className="button ghost small" href={unit.url} target="_blank" rel="noreferrer">GitHub ↗</a>}>
        {info.notebooks.length > 0 && (
          <div className="stack">
            <strong>Notebooks: run them in Google Colab (free GPU)</strong>
            <ul className="list plain">{info.notebooks.map(n => <li key={n.path}><div><a href={n.colab} target="_blank" rel="noreferrer">{n.path}</a></div></li>)}</ul>
          </div>
        )}
        {info.code_files.length > 0 && (
          <details>
            <summary className="link">Browse source files ({info.code_files.length})</summary>
            <ul className="list plain">{info.code_files.map(f => (
              <li key={f}><button className="link" onClick={() => action.run(async () => setFile(await api(`/units/${unit.id}/file?path=${encodeURIComponent(f)}`)))}>{f}</button></li>
            ))}</ul>
          </details>
        )}
        <ErrorBanner error={action.error} />
        {file && <div className="code-file"><strong>{file.path}</strong><pre>{file.text ?? 'Could not load file.'}</pre></div>}
      </Card>
      {info.readme && <article className="card reader"><div className="reader-body"><Md>{info.readme}</Md></div></article>}
    </div>
  )
}

export default function UnitPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: unit, error, loading, reload } = useApi<UnitDetail>(`/units/${id}`)
  const [pdfText, setPdfText] = useState<string>()
  const lastSent = useRef(0)
  const progress = (p: number) => {
    if (p - lastSent.current < 0.15 && p < 1) return
    lastSent.current = p
    api(`/units/${id}/progress`, { body: { progress: p } }).catch(() => {})
  }

  // Videos and projects have their own screens.
  useEffect(() => {
    if (!unit) return
    if (unit.kind === 'watch' && unit.data.video_id) {
      const seg = unit.data.segment
      navigate(`/videos/${unit.data.video_id}?unit=${unit.id}${seg ? `&t=${seg.start}` : ''}`, { replace: true })
    } else if (unit.kind === 'project' && unit.project_id) navigate(`/projects/${unit.project_id}`, { replace: true })
  }, [unit, navigate])

  if (loading && !unit) return <div className="page"><Spinner label="Preparing this step…" /></div>
  if (error || !unit) return <div className="page"><ErrorBanner error={error ?? 'Step not found'} /></div>
  const c = unit.content

  return (
    <div className="page narrow-wide">
      <header className="page-head">
        <div>
          <span className="kicker">
            <Link to={`/missions/${unit.mission_id}?c=${encodeURIComponent(unit.competency_id)}`}>{unit.competency?.name ?? 'Path'}</Link> · {unit.role} step
          </span>
          <h1>{c?.title || unit.title}</h1>
          <p className="muted">
            {[...new Set([unit.publication, c?.author ?? unit.author].filter(Boolean)), (c?.published ?? unit.published)?.slice(0, 10), c?.words ? `${Math.max(1, Math.round(c.words / 230))} min read` : null].filter(Boolean).join(' · ')}
            {' · '}<a href={unit.url} target="_blank" rel="noreferrer">original ↗</a>
          </p>
          <p className="muted small-text">{unit.why}</p>
        </div>
        {unit.status === 'done' && <Chip tone="good">done</Chip>}
      </header>
      {unit.kind === 'read' && <Reader unit={unit} onProgress={progress} />}
      {unit.kind === 'pdf' && (
        <Suspense fallback={<Spinner label="Loading PDF reader…" />}>
          <PdfViewer src={`/api/units/${unit.id}/pdf`} onProgress={progress} onText={setPdfText} />
        </Suspense>
      )}
      {unit.kind === 'code' && <CodeUnit unit={unit} />}
      {unit.kind === 'link' && <Card><a className="button primary" href={unit.url} target="_blank" rel="noreferrer">Open ↗</a></Card>}
      {['read', 'pdf', 'code'].includes(unit.kind) && <UnitCheck unit={unit} pdfText={pdfText} onDone={reload} />}
    </div>
  )
}
