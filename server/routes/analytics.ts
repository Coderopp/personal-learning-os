import { Hono } from 'hono'
import { type AppEnv, type Env, UserFacingError } from '../env'
import { all, first } from '../db'
import { competenciesOf } from '../learning'

export const analytics = new Hono<AppEnv>()

// Days are counted in IST so late-night study lands on the right day.
const IST = "'+330 minutes'"
const istDay = (col: string) => `date(${col}, ${IST})`
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** Monday of the ISO week containing `d`. */
const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))

export interface Day { date: string; minutes: number; sessions: number; reviews: number; benchmarks: number; active: boolean }

/** A learning day: ≥ 10 focused minutes, a completed review session, or a submitted benchmark. */
const MIN_MINUTES = 10

export async function activity(env: Env, days: number): Promise<Day[]> {
  const since = addDays(todayIst(), -(days - 1))
  const [sessions, reviewSessions, reviews, benchmarks] = await Promise.all([
    all<{ d: string; minutes: number; n: number }>(env,
      `SELECT ${istDay('started_at')} AS d, SUM(focused_minutes) AS minutes, SUM(ended_at IS NOT NULL) AS n
       FROM sessions WHERE ${istDay('started_at')} >= ? GROUP BY d`, since),
    all<{ d: string; n: number }>(env,
      `SELECT ${istDay('ended_at')} AS d, COUNT(*) AS n FROM sessions
       WHERE kind = 'review' AND ended_at IS NOT NULL AND ${istDay('ended_at')} >= ? GROUP BY d`, since),
    all<{ d: string; n: number }>(env, `SELECT ${istDay('at')} AS d, COUNT(*) AS n FROM review_log WHERE ${istDay('at')} >= ? GROUP BY d`, since),
    all<{ d: string; n: number }>(env,
      `SELECT ${istDay('submitted_at')} AS d, COUNT(*) AS n FROM benchmark_runs WHERE submitted_at IS NOT NULL AND ${istDay('submitted_at')} >= ? GROUP BY d`, since),
  ])
  const by = <T extends { d: string }>(rows: T[]) => new Map(rows.map(r => [r.d, r]))
  const s = by(sessions), rs = by(reviewSessions), rv = by(reviews), bm = by(benchmarks)
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(since, i)
    const minutes = s.get(date)?.minutes ?? 0
    const benchmarksN = bm.get(date)?.n ?? 0
    return {
      date, minutes, sessions: s.get(date)?.n ?? 0, reviews: rv.get(date)?.n ?? 0, benchmarks: benchmarksN,
      active: minutes >= MIN_MINUTES || (rs.get(date)?.n ?? 0) > 0 || benchmarksN > 0,
    }
  })
}

/**
 * Streaks forgive one missed day per ISO week (Mon–Sun): at 5–15 h/week a strict daily streak breaks constantly
 * and rewards token sessions. A second miss in the same week ends it. Only active days add to the count.
 * Today never breaks a streak: until midnight it's still "study today to keep it".
 */
export function streaks(days: Day[]) {
  const today = days[days.length - 1]
  const run = (list: Day[], stopOnBreak: boolean) => {
    let count = 0, best = 0
    const restUsed = new Set<string>()
    for (const d of list) {
      if (d.active) { count++; best = Math.max(best, count); continue }
      const wk = weekStart(d.date)
      if (!restUsed.has(wk)) { restUsed.add(wk); continue }
      if (stopOnBreak) break
      count = 0
      restUsed.clear()
    }
    return { count, best, restUsed }
  }
  // Current: walk back from yesterday (plus today if already active).
  const history = today.active ? [...days].reverse() : days.slice(0, -1).reverse()
  const current = run(history, true)
  const longest = run(days, false).best
  const thisWeek = weekStart(today.date)
  return {
    current: current.count,
    longest: Math.max(longest, current.count),
    today_active: today.active,
    rest_day_available: !current.restUsed.has(thisWeek),
    active_days: days.filter(d => d.active).length,
  }
}

analytics.get('/activity', async c => {
  const days = Math.min(371, Math.max(28, Number(c.req.query('days') ?? 371)))
  const list = await activity(c.env, days)
  return c.json({ today: todayIst(), days: list, streak: streaks(await activity(c.env, 371)) })
})

analytics.get('/analytics', async c => {
  const missionId = c.req.query('mission')
  if (!missionId) throw new UserFacingError('mission is required')
  const weeks = Math.min(52, Math.max(4, Number(c.req.query('weeks') ?? 8)))
  const mission = await first<{ target: number; hours_per_week: number }>(c.env, 'SELECT target, hours_per_week FROM missions WHERE id = ?', missionId)
  if (!mission) throw new UserFacingError('Mission not found', 404)
  const comps = await competenciesOf(c.env, missionId)
  const today = todayIst()
  const firstWeek = addDays(weekStart(today), -7 * (weeks - 1))

  const [runs, recall, errors, hours, due, days] = await Promise.all([
    all<{ competency_id: string; score: number; dims: string; submitted_at: string }>(c.env,
      `SELECT competency_id, score, dims, submitted_at FROM benchmark_runs WHERE mission_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at`, missionId),
    all<{ interval_days: number; n: number; correct: number }>(c.env,
      `SELECT interval_days, COUNT(*) AS n, SUM(correct) AS correct FROM review_log WHERE mission_id = ? AND interval_days IN (7, 30) GROUP BY interval_days`, missionId),
    first<{ total: number; recurring: number }>(c.env,
      `SELECT COUNT(*) AS total, SUM(occurrences > 1) AS recurring FROM errors WHERE mission_id = ? AND last_seen > datetime('now', '-30 days')`, missionId),
    all<{ d: string; minutes: number }>(c.env,
      `SELECT ${istDay('started_at')} AS d, SUM(focused_minutes) AS minutes FROM sessions WHERE mission_id = ? AND ${istDay('started_at')} >= ? GROUP BY d`,
      missionId, firstWeek),
    all<{ d: string; n: number }>(c.env,
      `SELECT MAX(${istDay('due_at')}, ?) AS d, COUNT(*) AS n FROM reviews WHERE mission_id = ? AND ${istDay('due_at')} <= ? GROUP BY 1`,
      today, missionId, addDays(today, 13)),
    activity(c.env, 371),
  ])

  // Capability after each benchmark run: latest score per competency, unbenchmarked = 0, over ALL competencies.
  const latest = new Map<string, number>()
  const capability = runs.map(r => {
    latest.set(r.competency_id, r.score)
    const sum = [...latest.values()].reduce((a, b) => a + b, 0)
    return { at: r.submitted_at, value: Math.round(sum / Math.max(1, comps.length)), coverage: latest.size }
  })

  const minutesByWeek = new Map<string, number>()
  for (const h of hours) minutesByWeek.set(weekStart(h.d), (minutesByWeek.get(weekStart(h.d)) ?? 0) + h.minutes)
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const wk = addDays(firstWeek, 7 * i)
    return { week: wk, hours: Math.round(((minutesByWeek.get(wk) ?? 0) / 60) * 10) / 10 }
  })
  const dueMap = new Map(due.map(r => [r.d, r.n]))
  const dueNext = Array.from({ length: 14 }, (_, i) => ({ date: addDays(today, i), n: dueMap.get(addDays(today, i)) ?? 0 }))

  const pct = (days: number) => {
    const r = recall.find(x => x.interval_days === days)
    return { value: r && r.n >= 20 ? Math.round((100 * r.correct) / r.n) : null, n: r?.n ?? 0, need: 20 }
  }
  const transferScores = runs.map(r => (JSON.parse(r.dims ?? '{}') as { transfer?: number }).transfer).filter((x): x is number => x != null)

  // Gain per focused hour between the first and last benchmark, and the projection it implies.
  let gainPerHour: number | null = null
  let tteWeeks: number | null = null
  if (capability.length >= 2) {
    const from = runs[0].submitted_at, to = runs[runs.length - 1].submitted_at
    const m = await first<{ minutes: number }>(c.env,
      'SELECT COALESCE(SUM(focused_minutes), 0) AS minutes FROM sessions WHERE mission_id = ? AND started_at BETWEEN ? AND ?', missionId, from, to)
    const hoursBetween = (m?.minutes ?? 0) / 60
    const gain = capability[capability.length - 1].value - capability[0].value
    if (hoursBetween >= 1) {
      gainPerHour = Math.round((gain / hoursBetween) * 100) / 100
      const avgWeekly = weekly.reduce((s, w) => s + w.hours, 0) / weeks || mission.hours_per_week
      const gap = mission.target - capability[capability.length - 1].value
      if (gainPerHour > 0 && gap > 0) tteWeeks = Math.round((gap / gainPerHour / Math.max(avgWeekly, 0.5)) * 10) / 10
    }
  }

  // Recovery latency: after gaps of ≥ 3 inactive days, how many days until you were back.
  const gaps: number[] = []
  let run = 0
  // Only breaks after you started count; the empty stretch before your first learning day is not a "break".
  const firstActive = days.findIndex(d => d.active)
  for (const d of firstActive < 0 ? [] : days.slice(firstActive)) {
    if (!d.active) { run++; continue }
    if (run >= 3) gaps.push(run)
    run = 0
  }

  return c.json({
    target: mission.target,
    capability,
    coverage: { benchmarked: comps.filter(x => x.benchmark_score != null).length, total: comps.length },
    competencies: comps.map(x => ({ id: x.id, name: x.name, benchmark: x.benchmark_score, practice: x.practice_score, practice_n: x.practice_n })),
    recall7: pct(7),
    recall30: pct(30),
    transfer: { value: transferScores.length >= 2 ? Math.round(transferScores.reduce((a, b) => a + b, 0) / transferScores.length) : null, n: transferScores.length, need: 2 },
    error_recurrence: { value: (errors?.total ?? 0) >= 10 ? Math.round((100 * (errors?.recurring ?? 0)) / errors!.total) : null, n: errors?.total ?? 0, need: 10 },
    gain_per_hour: { value: gainPerHour, n: capability.length, need: 2 },
    tte_weeks: tteWeeks,
    recovery: { last: gaps.length ? gaps[gaps.length - 1] : null, gaps: gaps.length },
    weekly,
    due_next: dueNext,
  })
})
