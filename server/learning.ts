// Domain rules shared by several routes: bottleneck selection, error bookkeeping, review scheduling.
import type { Env } from './env'
import { all, daysFromNow, first, newId, nowIso, run } from './db'
import { LADDER, nextRung, updatePracticeScore } from './srs'

export interface Competency {
  id: string
  mission_id: string
  name: string
  description: string
  prerequisites: string[]
  order_idx: number
  practice_score: number | null
  practice_n: number
  benchmark_score: number | null
}

export async function competenciesOf(env: Env, missionId: string): Promise<Competency[]> {
  const rows = await all<Omit<Competency, 'prerequisites'> & { prerequisites: string }>(env,
    'SELECT * FROM competencies WHERE mission_id = ? ORDER BY order_idx', missionId)
  return rows.map(r => ({ ...r, prerequisites: JSON.parse(r.prerequisites) as string[] }))
}

const UNLOCK = 60

/**
 * The bottleneck is the weakest competency whose prerequisites are solid enough to build on.
 * Recurring errors count against a competency so they get attacked first. Unpracticed = 0.
 */
export function pickBottleneck(comps: Competency[], recurringByComp: Record<string, number>) {
  const byId = new Map(comps.map(c => [c.id, c]))
  const level = (c: Competency) => c.benchmark_score ?? c.practice_score ?? 0
  const unlocked = comps.filter(c => c.prerequisites.every(p => {
    const pre = byId.get(p)
    return !pre || level(pre) >= UNLOCK
  }))
  const pool = unlocked.length ? unlocked : comps
  let best: Competency | undefined
  let bestKey = Infinity
  for (const c of pool) {
    const key = level(c) - 10 * (recurringByComp[c.id] ?? 0) + c.order_idx * 0.01
    if (key < bestKey) { best = c; bestKey = key }
  }
  if (!best) return null
  const why: string[] = []
  const recurring = recurringByComp[best.id] ?? 0
  if (best.practice_n === 0) why.push('not practiced yet')
  else why.push(`practice score ${Math.round(best.practice_score ?? 0)}`)
  if (recurring) why.push(`${recurring} recurring error${recurring > 1 ? 's' : ''}`)
  const dependents = comps.filter(c => c.prerequisites.includes(best!.id)).map(c => c.name)
  if (dependents.length) why.push(`unlocks ${dependents.slice(0, 2).join(', ')}`)
  return { competency: best, why: why.join(' · ') }
}

export async function recurringErrorCounts(env: Env, missionId: string) {
  const rows = await all<{ competency_id: string; n: number }>(env,
    `SELECT competency_id, COUNT(*) AS n FROM errors WHERE mission_id = ? AND status = 'recurring' GROUP BY competency_id`, missionId)
  return Object.fromEntries(rows.map(r => [r.competency_id, r.n]))
}

export async function bumpPracticeScore(env: Env, competencyId: string | null | undefined, score: number) {
  if (!competencyId) return
  const c = await first<{ practice_score: number | null }>(env, 'SELECT practice_score FROM competencies WHERE id = ?', competencyId)
  if (!c) return
  await run(env, 'UPDATE competencies SET practice_score = ?, practice_n = practice_n + 1 WHERE id = ?',
    updatePracticeScore(c.practice_score, score), competencyId)
}

export interface ErrorInput {
  category: string
  concept: string
  observed: string
  root_cause: string
  next_action: string
  matches_error_id?: string
}

/** Record a mistake: bump the matching error (→ recurring) or create a new one. Returns the error id. */
export async function recordError(env: Env, missionId: string, competencyId: string | null, e: ErrorInput) {
  if (e.matches_error_id) {
    const existing = await first(env, 'SELECT id FROM errors WHERE id = ? AND mission_id = ?', e.matches_error_id, missionId)
    if (existing) {
      await run(env,
        `UPDATE errors SET occurrences = occurrences + 1, status = 'recurring', correct_streak = 0, streak_started = NULL,
         last_seen = ?, observed = ? WHERE id = ?`, nowIso(), e.observed, e.matches_error_id)
      return e.matches_error_id
    }
  }
  const id = newId('err')
  await run(env,
    `INSERT INTO errors (id, mission_id, competency_id, concept, category, observed, root_cause, next_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, missionId, competencyId, e.concept, e.category, e.observed, e.root_cause, e.next_action)
  return id
}

/** An error is resolved after 3 consecutive correct answers spread over at least 7 days. */
export async function creditError(env: Env, errorId: string) {
  const e = await first<{ correct_streak: number; streak_started: string | null }>(env,
    'SELECT correct_streak, streak_started FROM errors WHERE id = ?', errorId)
  if (!e) return
  const streak = e.correct_streak + 1
  const started = e.streak_started ?? nowIso()
  const spanDays = (Date.now() - Date.parse(`${started.replace(' ', 'T')}Z`)) / 86_400_000
  const resolved = streak >= 3 && spanDays >= 7
  await run(env,
    `UPDATE errors SET correct_streak = ?, streak_started = ?, status = CASE WHEN ? THEN 'resolved' ELSE status END WHERE id = ?`,
    streak, started, resolved ? 1 : 0, errorId)
}

export async function addReview(env: Env, r: {
  missionId: string; competencyId?: string | null; errorId?: string | null; prompt: string; expected: string; source: string
}) {
  const id = newId('rev')
  await run(env,
    `INSERT INTO reviews (id, mission_id, competency_id, error_id, prompt, expected, rung, due_at, source)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    id, r.missionId, r.competencyId ?? null, r.errorId ?? null, r.prompt, r.expected, daysFromNow(LADDER[0]), r.source)
  return id
}

/** Move a review along the D1→D60 ladder and log the outcome for Recall-7 / Recall-30. */
export async function rescheduleReview(env: Env, reviewId: string, correct: boolean) {
  const r = await first<{ rung: number; mission_id: string; error_id: string | null }>(env,
    'SELECT rung, mission_id, error_id FROM reviews WHERE id = ?', reviewId)
  if (!r) return null
  const rung = nextRung(r.rung, correct)
  await run(env, 'UPDATE reviews SET rung = ?, due_at = ? WHERE id = ?', rung, daysFromNow(LADDER[rung]), reviewId)
  await run(env, 'INSERT INTO review_log (id, review_id, mission_id, interval_days, correct) VALUES (?, ?, ?, ?, ?)',
    newId('rl'), reviewId, r.mission_id, LADDER[r.rung], correct ? 1 : 0)
  if (r.error_id) {
    if (correct) await creditError(env, r.error_id)
    else await run(env,
      `UPDATE errors SET occurrences = occurrences + 1, status = 'recurring', correct_streak = 0, streak_started = NULL, last_seen = ? WHERE id = ?`,
      nowIso(), r.error_id)
  }
  return { rung, next_in_days: LADDER[rung] }
}
