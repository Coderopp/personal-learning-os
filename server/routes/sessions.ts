import { Hono } from 'hono'
import { type AppEnv, type Env, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run } from '../db'
import { llm, SCHEMAS } from '../llm'
import { searchTranscripts } from '../transcripts'
import {
  addReview, bumpPracticeScore, competenciesOf, creditError, pickBottleneck, recordError, recurringErrorCounts, rescheduleReview,
} from '../learning'

export const sessions = new Hono<AppEnv>()

interface Item { id: string; prompt: string; expected: string; type: string; review_id?: string; error_id?: string; competency_id?: string | null }

const MAX_OPEN_HOURS = 18

async function loadSession(env: Env, id: string) {
  const s = await first(env, 'SELECT * FROM sessions WHERE id = ?', id)
  if (!s) throw new UserFacingError('Session not found', 404)
  return parseJson(s, ['state']) as Record<string, unknown> & { id: string; mission_id: string; mode: string; kind: string; state: Record<string, unknown> }
}

async function dueReviewItems(env: Env, missionId: string, limit: number): Promise<Item[]> {
  const rows = await all<{ id: string; prompt: string; expected: string; error_id: string | null; competency_id: string | null }>(env,
    `SELECT id, prompt, expected, error_id, competency_id FROM reviews WHERE mission_id = ? AND due_at <= ? ORDER BY due_at LIMIT ?`,
    missionId, nowIso(), limit)
  return rows.map(r => ({ id: newId('it'), prompt: r.prompt, expected: r.expected, type: 'recall', review_id: r.id, error_id: r.error_id ?? undefined, competency_id: r.competency_id }))
}

/** The open (unfinished, recent) session for a mission, if any, so any device can resume it. */
sessions.get('/sessions/open', async c => {
  const mission = c.req.query('mission')
  const s = await first(c.env,
    `SELECT * FROM sessions WHERE ended_at IS NULL AND (? IS NULL OR mission_id = ?) AND last_active_at > datetime('now', ?)
     ORDER BY last_active_at DESC LIMIT 1`, mission ?? null, mission ?? null, `-${MAX_OPEN_HOURS} hours`)
  return c.json(s ? parseJson(s, ['state']) : null)
})

sessions.get('/sessions/:id', async c => {
  const s = await loadSession(c.env, c.req.param('id'))
  const attempts = await all(c.env,
    `SELECT a.id, a.stage, a.prompt, a.score, a.verdict, a.feedback, a.gap, a.error_id, e.category, e.concept, e.status AS error_status, e.occurrences
     FROM attempts a LEFT JOIN errors e ON e.id = a.error_id WHERE a.session_id = ? ORDER BY a.created_at`, s.id)
  return c.json({ ...s, attempts })
})

sessions.post('/sessions', async c => {
  const body = await c.req.json<{ mission_id: string; kind?: 'full' | 'review'; minutes?: number }>()
  const mission = await first<{ id: string; title: string; goal: string; mode: string; excellence: string }>(c.env,
    'SELECT id, title, goal, mode, excellence FROM missions WHERE id = ?', body.mission_id)
  if (!mission) throw new UserFacingError('Mission not found', 404)
  const kind = body.kind === 'review' ? 'review' : 'full'

  // Close stale open sessions for this mission; resume a recent one of the same kind.
  const open = await first<{ id: string; kind: string }>(c.env,
    `SELECT id, kind FROM sessions WHERE mission_id = ? AND ended_at IS NULL AND last_active_at > datetime('now', ?) ORDER BY last_active_at DESC LIMIT 1`,
    mission.id, `-${MAX_OPEN_HOURS} hours`)
  if (open && open.kind === kind) return c.json(await loadSession(c.env, open.id))
  await run(c.env, `UPDATE sessions SET ended_at = ? WHERE mission_id = ? AND ended_at IS NULL`, nowIso(), mission.id)

  let state: Record<string, unknown>
  if (kind === 'review') {
    const items = await dueReviewItems(c.env, mission.id, 15)
    if (!items.length) throw new UserFacingError('Nothing is due for review right now.', 409)
    state = { items, results: {} }
  } else if (mission.mode === 'project') {
    const ms = await first<{ id: string; title: string; description: string; competency_id: string | null }>(c.env,
      `SELECT id, title, description, competency_id FROM milestones WHERE mission_id = ? AND status != 'done' ORDER BY order_idx LIMIT 1`, mission.id)
    if (!ms) throw new UserFacingError('All milestones are done. Add a new milestone or benchmark this mission.', 409)
    await run(c.env, `UPDATE milestones SET status = 'doing' WHERE id = ?`, ms.id)
    state = { milestone: ms, recall: await dueReviewItems(c.env, mission.id, 2), results: {}, chat: [] }
  } else {
    state = await planMasterySession(c.env, mission, body.minutes ?? 50)
  }

  const id = newId('ses')
  await run(c.env, 'INSERT INTO sessions (id, mission_id, mode, kind, state) VALUES (?, ?, ?, ?, ?)',
    id, mission.id, mission.mode, kind, JSON.stringify(state))
  return c.json(await loadSession(c.env, id))
})

async function planMasterySession(env: Env, mission: { id: string; title: string; goal: string; excellence: string }, minutes: number) {
  const comps = await competenciesOf(env, mission.id)
  const recurring = await recurringErrorCounts(env, mission.id)
  const bottleneck = pickBottleneck(comps, recurring)
  if (!bottleneck) throw new UserFacingError('This mission has no competencies yet.', 409)
  const focus = bottleneck.competency

  const [errors, resources, recent, reviews] = await Promise.all([
    all(env, `SELECT id, concept, observed, root_cause, next_action, occurrences FROM errors
      WHERE mission_id = ? AND status != 'resolved' ORDER BY status = 'recurring' DESC, occurrences DESC LIMIT 5`, mission.id),
    all<{ id: string; title: string; type: string; reason: string }>(env,
      `SELECT id, title, type, reason FROM resources WHERE competency_id = ? AND status = 'accepted' LIMIT 8`, focus.id),
    all(env, `SELECT json_extract(state, '$.summary') AS summary, started_at FROM sessions
      WHERE mission_id = ? AND ended_at IS NOT NULL AND json_extract(state, '$.summary') IS NOT NULL ORDER BY started_at DESC LIMIT 3`, mission.id),
    dueReviewItems(env, mission.id, 2),
  ])

  const plan = await llm<{
    focus_reason: string
    retrieve: { prompt: string; expected: string; type: string }[]
    learn_resource_ids: string[]
    build_task: { title: string; instructions: string; definition_of_done: string }
    reflect_prompts: string[]
  }>(env, {
    prompt: 'session-coach',
    schema: SCHEMAS.session,
    input: {
      minutes, mission: { title: mission.title, goal: mission.goal, excellence: JSON.parse(mission.excellence) },
      competencies: comps.map(c => ({ id: c.id, name: c.name, practice_score: c.practice_score, prerequisites: c.prerequisites })),
      focus: { id: focus.id, name: focus.name, description: focus.description, heuristic_reason: bottleneck.why },
      known_errors: errors, due_review_prompts: reviews.map(r => r.prompt), resources, recent_sessions: recent,
    },
  })

  const resourceIds = new Set(resources.map(r => r.id))
  return {
    focus: { id: focus.id, name: focus.name, reason: plan.focus_reason, heuristic: bottleneck.why },
    retrieve: [
      ...reviews,
      ...plan.retrieve.slice(0, 3).map(q => ({ id: newId('it'), ...q, competency_id: focus.id })),
    ] satisfies Item[],
    learn_resource_ids: plan.learn_resource_ids.filter(id => resourceIds.has(id)),
    build_task: plan.build_task,
    reflect_prompts: plan.reflect_prompts.slice(0, 3),
    practice: [],
    results: {},
  }
}

/** Client-driven progress: merge a patch into the session state (so the tab can pick up where the PC left off). */
sessions.post('/sessions/:id/state', async c => {
  const s = await loadSession(c.env, c.req.param('id'))
  const body = await c.req.json<{ stage?: number; patch?: Record<string, unknown> }>()
  const state = { ...s.state, ...(body.patch ?? {}) }
  await run(c.env, 'UPDATE sessions SET state = ?, stage = COALESCE(?, stage), last_active_at = ? WHERE id = ?',
    JSON.stringify(state), body.stage ?? null, nowIso(), s.id)
  return c.json({ ok: true })
})

/** One focused minute. The client only sends this while the page is visible and the learner is active. */
sessions.post('/sessions/:id/heartbeat', async c => {
  await run(c.env, `UPDATE sessions SET focused_minutes = focused_minutes + 1, last_active_at = ? WHERE id = ? AND ended_at IS NULL`,
    nowIso(), c.req.param('id'))
  return c.json({ ok: true })
})

sessions.post('/sessions/:id/end', async c => {
  await run(c.env, 'UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL', nowIso(), c.req.param('id'))
  return c.json({ ok: true })
})

/**
 * Grade an attempt. Side effects: attempt row, practice score, error record (new or recurring),
 * a D1 review item for anything missed, and review-ladder movement when the item came from the queue.
 */
sessions.post('/attempts', async c => {
  const b = await c.req.json<{
    session_id?: string; mission_id: string; competency_id?: string | null; stage: string
    prompt: string; expected?: string; answer: string; question_id?: string; review_id?: string; error_id?: string
    artifact?: { code: string; stdout: string; stderr: string; runtime_ms: number; timed_out?: boolean }
  }>()
  if (!b.answer?.trim()) throw new UserFacingError('Write an attempt first. Retrieval before reading.')

  const knownErrors = await all(c.env,
    `SELECT id, concept, root_cause FROM errors WHERE mission_id = ? AND status != 'resolved' AND (? IS NULL OR competency_id = ?) LIMIT 10`,
    b.mission_id, b.competency_id ?? null, b.competency_id ?? null)
  const g = await llm<{
    score: number; verdict: 'correct' | 'partial' | 'incorrect'; feedback: string; gap: string; verified: boolean
    error: { present: boolean; category: string; concept: string; observed: string; root_cause: string; next_action: string; matches_error_id: string }
  }>(c.env, {
    prompt: 'evaluator',
    schema: SCHEMAS.evaluate,
    tier: b.stage === 'review' ? 'fast' : 'large',
    input: {
      stage: b.stage, question: b.prompt, expected: b.expected ?? '', attempt: b.answer, known_errors: knownErrors,
      // Real captured output from the in-browser runner (trimmed to fit the model budget).
      ...(b.artifact && { execution: {
        stdout: b.artifact.stdout.slice(-4000), stderr: b.artifact.stderr.slice(-2000), runtime_ms: b.artifact.runtime_ms, timed_out: Boolean(b.artifact.timed_out),
      } }),
    },
  })
  const score = Math.max(0, Math.min(100, g.score))

  let errorId: string | null = null
  if (g.error.present && g.verdict !== 'correct') {
    errorId = await recordError(c.env, b.mission_id, b.competency_id ?? null, g.error)
  }
  if (g.verdict === 'correct' && b.error_id && !b.review_id) await creditError(c.env, b.error_id)

  let review: { rung: number; next_in_days: number } | null = null
  if (b.review_id) {
    review = await rescheduleReview(c.env, b.review_id, g.verdict === 'correct')
  } else if (g.verdict !== 'correct' && b.expected) {
    await addReview(c.env, { missionId: b.mission_id, competencyId: b.competency_id, errorId, prompt: b.prompt, expected: b.expected, source: 'wrong-answer' })
  }
  await bumpPracticeScore(c.env, b.competency_id, score)

  const id = newId('att')
  await run(c.env,
    `INSERT INTO attempts (id, session_id, mission_id, competency_id, question_id, review_id, stage, prompt, answer, score, verdict, feedback, gap, error_id, artifact)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.session_id ?? null, b.mission_id, b.competency_id ?? null, b.question_id ?? null, b.review_id ?? null, b.stage,
    b.prompt, b.answer, score, g.verdict, g.feedback, g.gap || null, errorId,
    b.artifact ? JSON.stringify({ ...b.artifact, verified: Boolean(g.verified) }) : null)

  return c.json({
    id, score, verdict: g.verdict, feedback: g.feedback, gap: g.gap, verified: Boolean(b.artifact && g.verified),
    error: errorId ? { id: errorId, category: g.error.category, concept: g.error.concept, recurring: Boolean(g.error.matches_error_id) } : null,
    review,
  })
})

/** Practice question at a difficulty calibrated by the client (up after ≥80, down after <50). */
sessions.post('/questions/generate', async c => {
  const b = await c.req.json<{ mission_id: string; competency_id: string; difficulty: number; asked?: string[] }>()
  const comp = await first<{ name: string; description: string; prerequisites: string }>(c.env,
    'SELECT name, description, prerequisites FROM competencies WHERE id = ?', b.competency_id)
  if (!comp) throw new UserFacingError('Competency not found', 404)
  const [errors, gaps, linked] = await Promise.all([
    all(c.env, `SELECT concept, root_cause FROM errors WHERE competency_id = ? AND status != 'resolved' LIMIT 5`, b.competency_id),
    all(c.env, `SELECT gap FROM attempts WHERE competency_id = ? AND gap IS NOT NULL ORDER BY created_at DESC LIMIT 5`, b.competency_id),
    // The same concepts in the learner's other missions: material for transfer questions.
    all<{ mission: string; competency: string; concept: string }>(c.env,
      `SELECT m.title AS mission, k.name AS competency, cn.name AS concept
       FROM competency_concepts x JOIN competency_concepts y ON y.concept_id = x.concept_id
       JOIN competencies k ON k.id = y.competency_id JOIN missions m ON m.id = k.mission_id JOIN concepts cn ON cn.id = x.concept_id
       WHERE x.competency_id = ? AND k.mission_id != (SELECT mission_id FROM competencies WHERE id = ?) AND m.status != 'archived' LIMIT 6`,
      b.competency_id, b.competency_id),
  ])
  const difficulty = Math.max(1, Math.min(5, Math.round(b.difficulty || 3)))
  const q = await llm<{ type: string; difficulty: number; prompt: string; expected: string; misconceptions: string[] }>(c.env, {
    prompt: 'question-generator',
    schema: SCHEMAS.question,
    input: {
      competency: { name: comp.name, description: comp.description }, difficulty, known_errors: errors, recent_gaps: gaps.map(g => g.gap),
      already_asked: b.asked ?? [], linked_competencies: linked,
    },
  })
  const id = newId('q')
  await run(c.env,
    `INSERT INTO questions (id, mission_id, competency_id, type, difficulty, prompt, expected, misconceptions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.mission_id, b.competency_id, q.type, difficulty, q.prompt, q.expected, JSON.stringify(q.misconceptions))
  return c.json({ id, ...q, difficulty, competency_id: b.competency_id })
})

/** Learn stage: explain only the gaps the Retrieve stage exposed. */
sessions.post('/sessions/:id/learn', async c => {
  const s = await loadSession(c.env, c.req.param('id'))
  const focus = s.state.focus as { id: string; name: string } | undefined
  const attempts = await all(c.env, 'SELECT prompt, answer, verdict, feedback, gap FROM attempts WHERE session_id = ?', s.id)
  const resources = focus
    ? await all(c.env, `SELECT title, type, reason FROM resources WHERE competency_id = ? AND status = 'accepted' LIMIT 6`, focus.id)
    : []
  const { markdown } = await llm<{ markdown: string }>(c.env, {
    prompt: 'tutor',
    schema: SCHEMAS.tutor,
    input: { task: 'learn', competency: focus?.name, attempts, resources },
  })
  // Point at the exact moment in a saved video that covers the gap (keyword search, no LLM call).
  const gaps = attempts.map(a => a.gap).filter(Boolean).join(' ')
  const moments = gaps ? (await searchTranscripts(c.env, `${focus?.name ?? ''} ${gaps}`, { limit: 3 })) : []
  const patch = JSON.stringify({ learn: markdown, learn_videos: moments })
  await run(c.env, `UPDATE sessions SET state = json_patch(state, ?), last_active_at = ? WHERE id = ?`, patch, nowIso(), s.id)
  return c.json({ markdown, moments })
})

/** Reflect: store the learner's model update, turn it into retention items, close the session. */
sessions.post('/sessions/:id/reflect', async c => {
  const s = await loadSession(c.env, c.req.param('id'))
  const body = await c.req.json<{ answers: Record<string, string> }>()
  const attempts = await all(c.env, 'SELECT prompt, verdict, gap FROM attempts WHERE session_id = ?', s.id)
  const out = await llm<{ summary: string; items: { prompt: string; expected: string }[] }>(c.env, {
    prompt: 'reflection',
    schema: SCHEMAS.reflection,
    tier: 'fast',
    input: { reflection: body.answers, attempts },
  })
  const focus = s.state.focus as { id: string } | undefined
  await run(c.env, 'INSERT INTO reflections (id, session_id, mission_id, content) VALUES (?, ?, ?, ?)',
    newId('ref'), s.id, s.mission_id, JSON.stringify(body.answers))
  for (const it of out.items.slice(0, 4)) {
    await addReview(c.env, { missionId: s.mission_id, competencyId: focus?.id, prompt: it.prompt, expected: it.expected, source: 'reflection' })
  }
  const state = { ...s.state, reflection: body.answers, summary: out.summary, new_reviews: out.items.length }
  await run(c.env, 'UPDATE sessions SET state = ?, ended_at = ? WHERE id = ?', JSON.stringify(state), nowIso(), s.id)
  return c.json({ summary: out.summary, new_reviews: out.items.length })
})

/** Project mode: log what was built; the coach diagnoses, extracts errors and recall questions. */
sessions.post('/milestones/:id/log', async c => {
  const b = await c.req.json<{ session_id?: string; built: string; worked: string; failed: string; next: string }>()
  const ms = await first<{ id: string; mission_id: string; title: string; description: string; competency_id: string | null; log: string }>(c.env,
    'SELECT * FROM milestones WHERE id = ?', c.req.param('id'))
  if (!ms) throw new UserFacingError('Milestone not found', 404)
  const log = JSON.parse(ms.log) as unknown[]
  const out = await llm<{
    feedback: string
    errors: { category: string; concept: string; observed: string; root_cause: string; next_action: string }[]
    recall: { prompt: string; expected: string; type: string }[]
    milestone_done: boolean
  }>(c.env, {
    prompt: 'project-coach',
    schema: SCHEMAS.projectLog,
    input: { milestone: { title: ms.title, description: ms.description }, previous_log: log.slice(-5), update: b },
  })
  const entry = { at: nowIso(), ...b, feedback: out.feedback }
  await run(c.env, `UPDATE milestones SET log = ?, status = CASE WHEN ? THEN 'done' ELSE status END WHERE id = ?`,
    JSON.stringify([...log, entry]), out.milestone_done ? 1 : 0, ms.id)
  const errors = []
  for (const e of out.errors.slice(0, 2)) {
    const id = await recordError(c.env, ms.mission_id, ms.competency_id, e)
    errors.push({ id, ...e })
  }
  const recall: Item[] = out.recall.slice(0, 2).map(q => ({ id: newId('it'), ...q, competency_id: ms.competency_id }))
  return c.json({ feedback: out.feedback, errors, recall, milestone_done: out.milestone_done })
})

/** Project-mode sessions end with a lighter reflection: no LLM call, recall answers already graded. */
sessions.post('/sessions/:id/finish-project', async c => {
  const s = await loadSession(c.env, c.req.param('id'))
  const body = await c.req.json<{ summary?: string }>()
  const state = { ...s.state, summary: body.summary ?? (s.state.summary as string | undefined) ?? null }
  await run(c.env, 'UPDATE sessions SET state = ?, ended_at = ? WHERE id = ?', JSON.stringify(state), nowIso(), s.id)
  return c.json({ ok: true })
})
