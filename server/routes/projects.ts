import { Hono } from 'hono'
import { type AppEnv, UserFacingError } from '../env'
import { first, nowIso, parseJson, run } from '../db'
import { llm, SCHEMAS } from '../llm'
import { recordError } from '../learning'

export const projects = new Hono<AppEnv>()

type Brief = Record<string, unknown> & { title: string; milestones: { title: string; description: string; acceptance: string }[] }
type Progress = Record<string, { done?: boolean; log?: { at: string; note: string; feedback: string }[] }>

const LIST_FIELDS = ['requirements', 'deliverables', 'acceptance_criteria', 'stack', 'stretch_goals']

/** Keep the brief well-formed whatever the editor sends: known fields only, right types, sane sizes. */
function normalizeBrief(b: Record<string, unknown>): Brief {
  const str = (v: unknown, max = 4000) => String(v ?? '').slice(0, max)
  const list = (v: unknown) => (Array.isArray(v) ? v.map(x => str(x, 600)).filter(Boolean).slice(0, 30) : [])
  const out: Record<string, unknown> = {
    title: str(b.title, 160) || 'Untitled project', summary: str(b.summary, 600), goal: str(b.goal, 1200), context: str(b.context),
    milestones: (Array.isArray(b.milestones) ? b.milestones : []).slice(0, 12).map(m => ({
      title: str((m as Record<string, unknown>).title, 200), description: str((m as Record<string, unknown>).description, 2000), acceptance: str((m as Record<string, unknown>).acceptance, 1000),
    })).filter(m => m.title),
    starter_resources: (Array.isArray(b.starter_resources) ? b.starter_resources : []).slice(0, 12).map(r => ({
      title: str((r as Record<string, unknown>).title, 200), url: str((r as Record<string, unknown>).url, 500),
    })).filter(r => r.title || r.url),
    estimated_hours: Math.max(0.5, Math.min(40, Number(b.estimated_hours) || 3)),
    difficulty: ['beginner', 'intermediate', 'advanced'].includes(String(b.difficulty)) ? b.difficulty : 'intermediate',
    where_to_build: ['browser', 'local', 'colab'].includes(String(b.where_to_build)) ? b.where_to_build : 'local',
    notes: str(b.notes, 8000),
  }
  for (const f of LIST_FIELDS) out[f] = list(b[f])
  return out as Brief
}

async function load(env: AppEnv['Bindings'], id: string) {
  const p = await first(env, 'SELECT * FROM projects WHERE id = ?', id)
  if (!p) throw new UserFacingError('Project not found', 404)
  return parseJson(p, ['brief', 'progress']) as Record<string, unknown> & { id: string; unit_id: string | null; brief: Brief; progress: Progress; mission_id: string; competency_id: string | null }
}

projects.get('/projects/:id', async c => {
  const p = await load(c.env, c.req.param('id'))
  const comp = p.competency_id ? await first(c.env, 'SELECT id, name, mission_id FROM competencies WHERE id = ?', p.competency_id) : null
  return c.json({ ...p, competency: comp })
})

/** Save the learner's edits to the brief. */
projects.put('/projects/:id', async c => {
  const p = await load(c.env, c.req.param('id'))
  const { brief } = await c.req.json<{ brief: Record<string, unknown> }>()
  const clean = normalizeBrief(brief)
  await run(c.env, 'UPDATE projects SET brief = ?, updated_at = ?, status = CASE status WHEN \'todo\' THEN \'doing\' ELSE status END WHERE id = ?',
    JSON.stringify(clean), nowIso(), p.id)
  if (p.unit_id) await run(c.env, 'UPDATE units SET title = ?, why = ? WHERE id = ?', clean.title, String(clean.summary), p.unit_id)
  return c.json({ ok: true, brief: clean })
})

projects.post('/projects/:id/milestones/:i', async c => {
  const p = await load(c.env, c.req.param('id'))
  const i = Number(c.req.param('i'))
  const { done } = await c.req.json<{ done: boolean }>()
  const progress: Progress = { ...p.progress, [i]: { ...(p.progress[i] ?? {}), done } }
  const all = p.brief.milestones.length > 0 && p.brief.milestones.every((_, k) => progress[k]?.done)
  await run(c.env, 'UPDATE projects SET progress = ?, status = ?, updated_at = ? WHERE id = ?', JSON.stringify(progress), all ? 'done' : 'doing', nowIso(), p.id)
  if (p.unit_id) await run(c.env, `UPDATE units SET status = ?, progress = ?, completed_at = CASE WHEN ? THEN ? ELSE NULL END WHERE id = ?`,
    all ? 'done' : 'doing', p.brief.milestones.filter((_, k) => progress[k]?.done).length / Math.max(1, p.brief.milestones.length), all ? 1 : 0, nowIso(), p.unit_id)
  return c.json({ ok: true, progress, done: all })
})

/** Log work on a milestone; the coach checks it against the milestone's acceptance criteria. */
projects.post('/projects/:id/milestones/:i/log', async c => {
  const p = await load(c.env, c.req.param('id'))
  const i = Number(c.req.param('i'))
  const m = p.brief.milestones[i]
  if (!m) throw new UserFacingError('Milestone not found', 404)
  const { built, worked, failed, next } = await c.req.json<{ built: string; worked?: string; failed?: string; next?: string }>()
  if (!built?.trim()) throw new UserFacingError('Describe what you built or tried.')
  const out = await llm<{ feedback: string; errors: { category: string; concept: string; observed: string; root_cause: string; next_action: string }[]; recall: unknown[]; milestone_done: boolean }>(c.env, {
    prompt: 'project-coach', schema: SCHEMAS.projectLog,
    input: { milestone: { title: m.title, description: `${m.description}\nDone when: ${m.acceptance}` }, project: p.brief.title, previous_log: p.progress[i]?.log?.slice(-3) ?? [], update: { built, worked, failed, next } },
  })
  for (const e of out.errors.slice(0, 2)) await recordError(c.env, p.mission_id, p.competency_id, e)
  const entry = { at: nowIso(), note: [built, worked && `Worked: ${worked}`, failed && `Failed: ${failed}`].filter(Boolean).join('\n'), feedback: out.feedback }
  const progress = { ...p.progress, [i]: { done: p.progress[i]?.done || out.milestone_done, log: [...(p.progress[i]?.log ?? []), entry] } }
  await run(c.env, `UPDATE projects SET progress = ?, status = 'doing', updated_at = ? WHERE id = ?`, JSON.stringify(progress), nowIso(), p.id)
  return c.json({ feedback: out.feedback, milestone_done: out.milestone_done, progress })
})

/** The brief as Markdown (to keep in a repo, share, or paste into an issue). */
projects.get('/projects/:id/markdown', async c => {
  const { brief: b } = await load(c.env, c.req.param('id'))
  const list = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.map(x => `- ${x}`).join('\n') : '_none_')
  const md = [
    `# ${b.title}`, '', String(b.summary ?? ''), '',
    `**Goal:** ${b.goal}`, '', `**Difficulty:** ${b.difficulty} · **Estimate:** ${b.estimated_hours} h · **Where:** ${b.where_to_build}`, '',
    '## Context', String(b.context ?? ''), '', '## Requirements', list(b.requirements), '',
    '## Milestones', ...b.milestones.map((m, i) => `${i + 1}. **${m.title}**: ${m.description}\n   - Done when: ${m.acceptance}`), '',
    '## Deliverables', list(b.deliverables), '', '## Acceptance criteria', list(b.acceptance_criteria), '',
    '## Stack', list(b.stack), '', '## Starter resources',
    ...((b.starter_resources as { title: string; url: string }[] | undefined) ?? []).map(r => `- [${r.title}](${r.url})`), '',
    '## Stretch goals', list(b.stretch_goals), '', ...(b.notes ? ['## Notes', String(b.notes)] : []),
  ].join('\n')
  return new Response(md, { headers: { 'content-type': 'text/markdown; charset=utf-8' } })
})
