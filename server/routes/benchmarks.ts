import { Hono } from 'hono'
import { type AppEnv, type Env, UserFacingError } from '../env'
import { all, first, newId, nowIso, parseJson, run } from '../db'
import { llm, SCHEMAS } from '../llm'
import { benchmarkStatus } from '../learning'

export const benchmarks = new Hono<AppEnv>()

const TASKS_PER_RUN = 2
const DIMS = ['concept', 'implementation', 'reasoning', 'transfer'] as const
type Dims = Record<(typeof DIMS)[number], number>

benchmarks.get('/benchmarks', async c => {
  const mission = c.req.query('mission')
  if (!mission) throw new UserFacingError('mission is required')
  const recent = await all(c.env,
    `SELECT b.id, b.competency_id, c.name, b.score, b.dims, b.started_at, b.submitted_at FROM benchmark_runs b
     JOIN competencies c ON c.id = b.competency_id WHERE b.mission_id = ? ORDER BY b.started_at DESC LIMIT 20`, mission)
  return c.json({ competencies: await benchmarkStatus(c.env, mission), runs: recent.map(r => parseJson(r, ['dims'])) })
})

/** Sealed pool: generate fresh held-out tasks when fewer than a run's worth remain unused. */
async function ensurePool(env: Env, comp: { id: string; name: string; description: string; mission_id: string }) {
  const openRunTasks = (await all<{ task_ids: string }>(env,
    'SELECT task_ids FROM benchmark_runs WHERE competency_id = ? AND submitted_at IS NULL', comp.id))
    .flatMap(r => JSON.parse(r.task_ids) as string[])
  const unused = await all<{ id: string; type: string }>(env,
    `SELECT id, type FROM questions WHERE competency_id = ? AND bank = 'benchmark' AND used_at IS NULL ORDER BY created_at`, comp.id)
  const available = unused.filter(q => !openRunTasks.includes(q.id))
  if (available.length >= TASKS_PER_RUN) return available

  const mission = await first<{ title: string; goal: string; excellence: string; level: string }>(env,
    'SELECT title, goal, excellence, level FROM missions WHERE id = ?', comp.mission_id)
  const [previous, practice] = await Promise.all([
    all<{ prompt: string }>(env, `SELECT prompt FROM questions WHERE competency_id = ? AND bank = 'benchmark'`, comp.id),
    all<{ prompt: string }>(env, `SELECT prompt FROM questions WHERE competency_id = ? AND bank = 'practice' ORDER BY created_at DESC LIMIT 15`, comp.id),
  ])
  const out = await llm<{ tasks: { kind: string; prompt: string; expected: string; rubric: Record<string, string> }[] }>(env, {
    prompt: 'examiner',
    schema: SCHEMAS.examiner,
    input: {
      mission: { title: mission?.title, goal: mission?.goal, excellence: JSON.parse(mission?.excellence ?? '[]'), learner_level: mission?.level },
      competency: { name: comp.name, description: comp.description },
      previous_tasks: previous.map(p => p.prompt),
      practice_questions: practice.map(p => p.prompt),
    },
    maxTokens: 5000,
  })
  await env.DB.batch(out.tasks.slice(0, 3).map(t => env.DB.prepare(
    `INSERT INTO questions (id, mission_id, competency_id, type, difficulty, prompt, expected, rubric, source, bank)
     VALUES (?, ?, ?, ?, 4, ?, ?, ?, 'examiner', 'benchmark')`,
  ).bind(newId('bq'), comp.mission_id, comp.id, t.kind, t.prompt, t.expected, JSON.stringify(t.rubric))))
  return (await all<{ id: string; type: string }>(env,
    `SELECT id, type FROM questions WHERE competency_id = ? AND bank = 'benchmark' AND used_at IS NULL ORDER BY created_at`, comp.id))
    .filter(q => !openRunTasks.includes(q.id))
}

async function loadRun(env: Env, id: string) {
  const r = await first(env, 'SELECT b.*, c.name AS competency_name FROM benchmark_runs b JOIN competencies c ON c.id = b.competency_id WHERE b.id = ?', id)
  if (!r) throw new UserFacingError('Benchmark run not found', 404)
  const run = parseJson(r, ['task_ids', 'answers', 'results', 'dims']) as Record<string, unknown> & {
    id: string; competency_id: string; started_at: string; task_ids: string[]; submitted_at: string | null
  }
  const tasks = await all<{ id: string; type: string; prompt: string; expected: string; rubric: string }>(env,
    `SELECT id, type, prompt, expected, rubric FROM questions WHERE id IN (${run.task_ids.map(() => '?').join(',')})`, ...run.task_ids)
  const ordered = run.task_ids.map(tid => tasks.find(t => t.id === tid)!).filter(Boolean)
  // Sealed until submitted: expected answers and rubrics are only revealed afterwards.
  return {
    ...run,
    tasks: ordered.map(t => run.submitted_at
      ? { id: t.id, kind: t.type, prompt: t.prompt, expected: t.expected, rubric: JSON.parse(t.rubric ?? '{}') }
      : { id: t.id, kind: t.type, prompt: t.prompt }),
  }
}

/** Start (or resume) a benchmark run for one competency. */
benchmarks.post('/benchmarks/runs', async c => {
  const b = await c.req.json<{ competency_id: string }>()
  const comp = await first<{ id: string; name: string; description: string; mission_id: string }>(c.env,
    'SELECT id, name, description, mission_id FROM competencies WHERE id = ?', b.competency_id)
  if (!comp) throw new UserFacingError('Competency not found', 404)

  const open = await first<{ id: string }>(c.env,
    `SELECT id FROM benchmark_runs WHERE competency_id = ? AND submitted_at IS NULL AND started_at > datetime('now', '-3 hours')
     ORDER BY started_at DESC LIMIT 1`, comp.id)
  if (open) return c.json(await loadRun(c.env, open.id))

  const pool = await ensurePool(c.env, comp)
  if (pool.length < TASKS_PER_RUN) throw new UserFacingError('Could not prepare benchmark tasks. Try again.', 502)
  // Prefer a transfer task plus one other kind: transfer is closest to the excellence objective.
  const transfer = pool.find(q => q.type === 'transfer')
  const picked = transfer ? [transfer, pool.find(q => q.id !== transfer.id)!] : pool.slice(0, TASKS_PER_RUN)

  const id = newId('bm')
  await run(c.env, 'INSERT INTO benchmark_runs (id, mission_id, competency_id, task_ids) VALUES (?, ?, ?, ?)',
    id, comp.mission_id, comp.id, JSON.stringify(picked.map(q => q.id)))
  return c.json(await loadRun(c.env, id))
})

benchmarks.get('/benchmarks/runs/:id', async c => c.json(await loadRun(c.env, c.req.param('id'))))

benchmarks.post('/benchmarks/runs/:id/submit', async c => {
  const runRow = await loadRun(c.env, c.req.param('id'))
  if (runRow.submitted_at) throw new UserFacingError('This benchmark was already submitted.', 409)
  const { answers } = await c.req.json<{ answers: Record<string, string> }>()

  const full = await all<{ id: string; prompt: string; expected: string; rubric: string }>(c.env,
    `SELECT id, prompt, expected, rubric FROM questions WHERE id IN (${runRow.task_ids.map(() => '?').join(',')})`, ...runRow.task_ids)
  const results = await Promise.all(full.map(async t => {
    const answer = answers[t.id]?.trim() ?? ''
    const g = answer
      ? await llm<Dims & { feedback: string }>(c.env, {
        prompt: 'benchmark-grader', schema: SCHEMAS.benchmarkGrade,
        input: { task: t.prompt, rubric: JSON.parse(t.rubric ?? '{}'), expected: t.expected, answer },
      })
      : { concept: 0, implementation: 0, reasoning: 0, transfer: 0, feedback: 'No answer submitted.' }
    const dims = Object.fromEntries(DIMS.map(d => [d, Math.max(0, Math.min(100, Math.round(g[d])))])) as Dims
    return { task_id: t.id, dims, score: Math.round(DIMS.reduce((s, d) => s + dims[d], 0) / DIMS.length), feedback: g.feedback }
  }))

  const dims = Object.fromEntries(DIMS.map(d => [d, Math.round(results.reduce((s, r) => s + r.dims[d], 0) / results.length)])) as Dims
  const score = Math.round(DIMS.reduce((s, d) => s + dims[d], 0) / DIMS.length)
  const started = Date.parse(`${runRow.started_at.replace(' ', 'T')}Z`)
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE benchmark_runs SET answers = ?, results = ?, dims = ?, score = ?, submitted_at = ?, duration_s = ? WHERE id = ?`)
      .bind(JSON.stringify(answers), JSON.stringify(results), JSON.stringify(dims), score, nowIso(), Math.round((Date.now() - started) / 1000), runRow.id),
    // Seen tasks are burned: a held-out task is only held out once.
    ...runRow.task_ids.map(tid => c.env.DB.prepare('UPDATE questions SET used_at = ? WHERE id = ?').bind(nowIso(), tid)),
    c.env.DB.prepare('UPDATE competencies SET benchmark_score = ? WHERE id = ?').bind(score, runRow.competency_id),
  ])
  return c.json(await loadRun(c.env, runRow.id))
})

/** Leaving a run still burns its tasks: you've seen them. */
benchmarks.post('/benchmarks/runs/:id/abandon', async c => {
  const runRow = await loadRun(c.env, c.req.param('id'))
  if (runRow.submitted_at) return c.json({ ok: true })
  await c.env.DB.batch([
    ...runRow.task_ids.map(tid => c.env.DB.prepare('UPDATE questions SET used_at = ? WHERE id = ?').bind(nowIso(), tid)),
    c.env.DB.prepare('DELETE FROM benchmark_runs WHERE id = ?').bind(runRow.id),
  ])
  return c.json({ ok: true })
})
