import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { Grade, Item, Mission, Moment } from '../lib/types'
import { MomentList } from './Videos'
import { Card, Chip, ErrorBanner, Spinner } from '../components/ui'
import { AnswerBox } from '../components/AnswerBox'
import { fmtTime } from '../lib/time'
import { setMediaPlaying } from '../lib/activity'

interface Note { id: string; t: number; text: string }
interface AiNotes { summary: string; concepts: { t: number; name: string; note: string }[]; questions: Omit<Item, 'id'>[] }
interface Video {
  id: string; title: string; channel: string | null; mission_id: string | null; competency_id: string | null
  position: number; duration: number | null; has_transcript: boolean; ai_notes: AiNotes | null; notes: Note[]
}

// Minimal typing for the YouTube IFrame API.
interface YTPlayer {
  getCurrentTime(): number; getDuration(): number; getPlayerState(): number; seekTo(s: number, allow: boolean): void
  playVideo(): void; pauseVideo(): void; setPlaybackRate(r: number): void; destroy(): void
}
declare global {
  interface Window { YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer }; onYouTubeIframeAPIReady?: () => void }
}

let ytReady: Promise<void> | null = null
function loadYouTubeApi() {
  ytReady ??= new Promise(resolve => {
    if (window.YT?.Player) return resolve()
    window.onYouTubeIframeAPIReady = () => resolve()
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return ytReady
}

const PLAYING = 1

export default function VideoPlayer() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const deepLink = params.get('t') != null ? Number(params.get('t')) : null
  const unitId = params.get('unit')
  const { data: video, error, loading, reload, setData } = useApi<Video>(`/videos/${id}`)
  const missions = useApi<Mission[]>('/missions')
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  const [rate, setRate] = useState(1)
  const [noteText, setNoteText] = useState('')
  const [noteAt, setNoteAt] = useState<number | null>(null)
  const noteInput = useRef<HTMLInputElement>(null)
  const saving = useAction()

  // Create the player once the video row (and its saved position) is known.
  useEffect(() => {
    if (!video || player.current || !host.current) return
    let alive = true
    loadYouTubeApi().then(() => {
      if (!alive || !host.current || !window.YT) return
      player.current = new window.YT.Player(host.current, {
        videoId: video.id,
        // A ?t= deep link (search hit, Learn stage, tutor citation) wins over the saved position.
        playerVars: { start: Math.floor(deepLink ?? video.position ?? 0), rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onStateChange: (e: { data: number }) => { setMediaPlaying(e.data === PLAYING); if (e.data !== PLAYING) saveProgress() } },
      })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id])

  useEffect(() => () => { setMediaPlaying(false); saveProgress(); player.current?.destroy(); player.current = null }, [id])

  // Jumping between moments of the same video only changes ?t=, so seek the existing player.
  useEffect(() => {
    if (deepLink != null && player.current?.seekTo) { player.current.seekTo(deepLink, true); player.current.playVideo() }
  }, [deepLink])

  // Save position every 15 s while playing so the tab can resume where the PC stopped.
  useEffect(() => {
    const t = setInterval(() => { if (player.current?.getPlayerState?.() === PLAYING) saveProgress() }, 15_000)
    return () => clearInterval(t)
  }, [id])

  function saveProgress() {
    const p = player.current
    if (!p?.getCurrentTime) return
    const position = p.getCurrentTime()
    if (!Number.isFinite(position)) return
    api(`/videos/${id}/progress`, { method: 'PUT', body: { position, duration: p.getDuration?.() || undefined } }).catch(() => {})
  }

  const now = () => player.current?.getCurrentTime?.() ?? 0
  const seek = (t: number) => { player.current?.seekTo(t, true); player.current?.playVideo() }

  // Keyboard shortcuts (PC): n = note, space = play/pause, j/l = ∓10 s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return
      const p = player.current
      if (!p) return
      if (e.key === 'n') { e.preventDefault(); setNoteAt(now()); noteInput.current?.focus() }
      else if (e.key === ' ') { e.preventDefault(); if (p.getPlayerState() === PLAYING) p.pauseVideo(); else p.playVideo() }
      else if (e.key === 'j') p.seekTo(Math.max(0, now() - 10), true)
      else if (e.key === 'l') p.seekTo(now() + 10, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const addNote = () => saving.run(async () => {
    const t = noteAt ?? now()
    const { id: noteId } = await api<{ id: string }>(`/videos/${id}/notes`, { body: { t, text: noteText } })
    setData(v => v && { ...v, notes: [...v.notes, { id: noteId, t, text: noteText }].sort((a, b) => a.t - b.t) })
    setNoteText('')
    setNoteAt(null)
  })
  const deleteNote = (noteId: string) => saving.run(async () => {
    await api(`/video-notes/${noteId}`, { method: 'DELETE' })
    setData(v => v && { ...v, notes: v.notes.filter(n => n.id !== noteId) })
  })
  const linkMission = (missionId: string) => saving.run(async () => {
    await api('/videos', { body: { url: id, mission_id: missionId } })
    reload()
  })

  if (loading && !video) return <div className="page"><Spinner /></div>
  if (error || !video) return <div className="page"><ErrorBanner error={error ?? 'Video not found'} /></div>

  return (
    <div className="page video-page">
      <header className="page-head">
        <div>
          <span className="kicker"><Link to="/videos">Videos</Link> · {video.channel}</span>
          <h1>{video.title}</h1>
        </div>
        <label className="field inline">
          <span>Mission</span>
          <select value={video.mission_id ?? ''} disabled={Boolean(video.mission_id)} onChange={e => e.target.value && linkMission(e.target.value)}>
            <option value="">Link to a mission…</option>
            {missions.data?.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
      </header>

      {unitId && <UnitBanner unitId={unitId} seek={seek} />}
      <div className="video-layout">
        <div className="video-main">
          <div className="player-frame"><div ref={host} /></div>
          <div className="player-controls">
            {[1, 1.25, 1.5, 1.75, 2].map(r => (
              <button key={r} className={`small ${rate === r ? 'secondary' : 'ghost'}`} onClick={() => { setRate(r); player.current?.setPlaybackRate(r) }}>{r}×</button>
            ))}
            <button className="ghost small" onClick={() => player.current?.seekTo(Math.max(0, now() - 10), true)}>⟲ 10</button>
            <button className="ghost small" onClick={() => player.current?.seekTo(now() + 10, true)}>10 ⟳</button>
            <span className="muted kbd-hint">n note · space play · j/l ±10s</span>
          </div>
        </div>
        <div className="video-ai">
          <AiPanel video={video} now={now} seek={seek} onNotes={ai => setData(v => v && { ...v, ai_notes: ai, has_transcript: true })} />
        </div>

        <Card className="notes-card" title="Notes" subtitle="Tap a timestamp to jump back.">
          <FindInVideo videoId={video.id} searchable={video.has_transcript} />
          <form className="note-input" onSubmit={e => { e.preventDefault(); if (noteText.trim()) addNote() }}>
            <span className="stamp">{fmtTime(noteAt ?? 0)}</span>
            <input ref={noteInput} value={noteText} placeholder="Note at this moment…"
              onFocus={() => { if (noteAt == null) setNoteAt(now()) }}
              onChange={e => { if (noteAt == null) setNoteAt(now()); setNoteText(e.target.value) }} />
            <button className="primary small" disabled={!noteText.trim() || saving.busy}>Add</button>
          </form>
          <ErrorBanner error={saving.error} />
          <ul className="notes">
            {video.notes.map(n => (
              <li key={n.id}>
                <button className="stamp" onClick={() => seek(n.t)}>{fmtTime(n.t)}</button>
                <span>{n.text}</span>
                <button className="ghost small" aria-label="Delete note" onClick={() => deleteNote(n.id)}>✕</button>
              </li>
            ))}
            {!video.notes.length && <li className="muted">No notes yet. Press <kbd>n</kbd> or tap the box above while watching.</li>}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function AiPanel({ video, now, seek, onNotes }: { video: Video; now: () => number; seek: (t: number) => void; onNotes: (n: AiNotes) => void }) {
  const [needPaste, setNeedPaste] = useState(false)
  const [pasted, setPasted] = useState('')
  const [quiz, setQuiz] = useState<{ window: string; items: Item[] } | null>(null)
  const [results, setResults] = useState<Record<string, Grade>>({})
  const [added, setAdded] = useState<Set<number>>(new Set())
  const action = useAction()

  /** Make sure a transcript exists: automatic fetch first, pasted text as the fallback. */
  async function ensureTranscript(text?: string) {
    if (video.has_transcript && !text) return true
    const r = await api<{ available: boolean }>(`/videos/${video.id}/transcript`, { body: text ? { text } : {} })
    if (!r.available) setNeedPaste(true)
    else { video.has_transcript = true; setNeedPaste(false) }
    return r.available
  }

  const makeNotes = (text?: string) => action.run(async () => {
    const ok = await ensureTranscript(text)
    // Without a transcript the notes are based on the learner's own notes; the server rejects if there are none.
    if (!ok && !video.notes.length) return
    onNotes(await api<AiNotes>(`/videos/${video.id}/ai-notes`, { body: {} }))
  })

  const quizMe = () => action.run(async () => {
    const to = Math.max(now(), 60)
    const from = Math.max(0, to - 600)
    await ensureTranscript()
    const r = await api<{ questions: Omit<Item, 'id'>[] }>(`/videos/${video.id}/quiz`, { body: { from, to } })
    setResults({})
    setQuiz({
      window: `${fmtTime(from)}–${fmtTime(to)}`,
      items: r.questions.map((q, i) => ({ ...q, id: `vq${Date.now()}${i}`, competency_id: video.competency_id })),
    })
  })

  const addToReviews = (i: number, q: Omit<Item, 'id'>) => action.run(async () => {
    await api('/reviews', { body: { mission_id: video.mission_id, competency_id: video.competency_id, prompt: q.prompt, expected: q.expected, source: 'video' } })
    setAdded(s => new Set(s).add(i))
  })

  const ai = video.ai_notes
  return (
    <Card title="Learn from this video" actions={
      <>
        <button className="secondary small" disabled={action.busy || !video.mission_id} title={video.mission_id ? '' : 'Link a mission first'} onClick={quizMe}>Quiz me on last 10 min</button>
        <button className="ghost small" disabled={action.busy} onClick={() => makeNotes()}>{ai ? 'Regenerate AI notes' : 'Transcript → notes'}</button>
      </>
    }>
      {!video.mission_id && <p className="muted small-text">Link this video to a mission to get graded quizzes and review items.</p>}
      {action.busy && <Spinner label="Working…" />}
      <ErrorBanner error={action.error} />

      {needPaste && (
        <div className="banner warn">
          <p>YouTube didn't return captions automatically{video.notes.length ? ', so the notes above are based on your own notes' : ''}. To use the transcript: on YouTube open <b>⋯ → Show transcript</b>, select all the lines, copy, and paste here.</p>
          <textarea rows={4} value={pasted} onChange={e => setPasted(e.target.value)} placeholder="0:00 Intro…" />
          <button className="primary small" disabled={!pasted.trim() || action.busy} onClick={() => makeNotes(pasted)}>Use pasted transcript</button>
        </div>
      )}

      {quiz && (
        <div className="quiz">
          <h3>Quiz · {quiz.window}</h3>
          {quiz.items.map((it, i) => (
            <AnswerBox key={it.id} item={it} index={i} missionId={video.mission_id!} stage="video" result={results[it.id]}
              onGraded={g => setResults(r => ({ ...r, [it.id]: g }))} />
          ))}
        </div>
      )}

      {ai && (
        <div className="ai-notes">
          <p>{ai.summary}</p>
          <h3>Key concepts</h3>
          <ul className="notes">
            {ai.concepts.map((c, i) => (
              <li key={i}>
                <button className="stamp" onClick={() => seek(c.t)}>{fmtTime(c.t)}</button>
                <span><strong>{c.name}</strong> · {c.note}</span>
              </li>
            ))}
          </ul>
          <h3>Questions worth keeping</h3>
          <ul className="list">
            {ai.questions.map((q, i) => (
              <li key={i}>
                <div><Chip>{q.type}</Chip> {q.prompt}</div>
                {video.mission_id && (added.has(i)
                  ? <Chip tone="good">in reviews</Chip>
                  : <button className="ghost small" disabled={action.busy} onClick={() => addToReviews(i, q)}>+ Review</button>)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function FindInVideo({ videoId, searchable }: { videoId: string; searchable: boolean }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Moment[] | null>(null)
  const action = useAction()
  if (!searchable) return <p className="muted small-text">Load the transcript (“Transcript → notes”) to search inside this video.</p>
  return (
    <div className="find-in-video">
      <form className="note-input" onSubmit={e => { e.preventDefault(); if (q.trim()) action.run(async () => setHits(await api<Moment[]>(`/videos/search?q=${encodeURIComponent(q)}&video=${videoId}`))) }}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find in this video…" />
        <button className="secondary small" disabled={!q.trim() || action.busy}>Find</button>
      </form>
      <ErrorBanner error={action.error} />
      {hits && (hits.length ? <MomentList moments={hits} showTitle={false} /> : <p className="muted small-text">Not mentioned in the transcript.</p>)}
    </div>
  )
}

/** When opened from a learning path: the step's segment, its course context, and completion. */
function UnitBanner({ unitId, seek }: { unitId: string; seek: (t: number) => void }) {
  const { data: unit, reload } = useApi<import('../lib/types').Unit & { competency: { name: string } | null }>(`/units/${unitId}`)
  const action = useAction()
  const [quiz, setQuiz] = useState<{ items: Item[]; results: Record<string, Grade> } | null>(null)
  if (!unit) return null
  const seg = unit.data.segment
  const pl = unit.data.playlist
  const idx = pl && unit.data.video_id ? pl.episodes.findIndex(e => e.id === unit.data.video_id) : -1
  const getQuiz = () => action.run(async () => {
    const qs = await api<(Item & { id: string })[]>(`/units/${unitId}/questions`, { body: {} })
    setQuiz({ items: qs, results: {} })
  })
  const answered = quiz ? quiz.items.filter(q => quiz.results[q.id]).length : 0
  return (
    <Card className="unit-banner" title={<><Link to={`/missions/${unit.mission_id}?c=${encodeURIComponent(unit.competency_id)}`}>{unit.competency?.name ?? 'Path'}</Link> · {unit.role} step</>}
      subtitle={unit.why}
      actions={unit.status === 'done' ? <Chip tone="good">done</Chip> : (
        <button className="ghost small" disabled={action.busy} onClick={() => action.run(async () => { await api(`/units/${unitId}/complete`, { body: {} }); reload() })}>Mark done</button>
      )}>
      {seg && (
        <p className="small-text">Watch <button className="stamp" onClick={() => seek(seg.start)}>{fmtTime(seg.start)}</button> → <b>{fmtTime(seg.end)}</b>: the part that covers this skill.</p>
      )}
      {pl && (
        <details className="course-strip">
          <summary className="muted small-text">{idx >= 0 ? `Episode ${idx + 1} of ${pl.episodes.length}` : `${pl.episodes.length} episodes`} · {pl.title}{idx > 0 ? ': earlier episodes build up to this one' : ''}</summary>
          <ol>{pl.episodes.map((e, i) => (
            <li key={e.id} className={i === idx ? 'current' : ''}><Link to={`/videos/${e.id}`}>{e.title}</Link></li>
          ))}</ol>
        </details>
      )}
      {!quiz ? (
        <div className="actions"><button className="secondary small" disabled={action.busy} onClick={getQuiz}>{action.busy ? 'Writing questions…' : 'I watched it: quiz me'}</button></div>
      ) : (
        <div className="stack">
          {quiz.items.map((q, i) => (
            <AnswerBox key={q.id} item={q} index={i} missionId={unit.mission_id} stage="unit" result={quiz.results[q.id]}
              onGraded={g => {
                const results = { ...quiz.results, [q.id]: g }
                setQuiz({ ...quiz, results })
                if (quiz.items.every(x => results[x.id])) api(`/units/${unitId}/complete`, { body: {} }).then(reload).catch(() => {})
              }} />
          ))}
          {answered === quiz.items.length && <p className="banner info">Step complete ✓</p>}
        </div>
      )}
      <ErrorBanner error={action.error} />
    </Card>
  )
}
