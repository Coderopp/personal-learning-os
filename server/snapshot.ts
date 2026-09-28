import type { Env } from './env'
import { all, nowIso, run } from './db'

// Everything needed to rebuild D1. Transcripts are left out (large, re-fetchable) and re-indexed on demand.
const TABLES: Record<string, string> = {
  missions: 'SELECT * FROM missions',
  competencies: 'SELECT * FROM competencies',
  milestones: 'SELECT * FROM milestones',
  resources: 'SELECT * FROM resources',
  primers: 'SELECT * FROM primers',
  questions: 'SELECT * FROM questions',
  sessions: 'SELECT * FROM sessions',
  attempts: 'SELECT * FROM attempts',
  errors: 'SELECT * FROM errors',
  reviews: 'SELECT * FROM reviews',
  review_log: 'SELECT * FROM review_log',
  reflections: 'SELECT * FROM reflections',
  videos: 'SELECT id, title, channel, mission_id, competency_id, position, duration, ai_notes, updated_at FROM videos',
  video_notes: 'SELECT * FROM video_notes',
  benchmark_runs: 'SELECT * FROM benchmark_runs',
  llm_usage: 'SELECT * FROM llm_usage',
}

export interface SnapshotResult { committed: boolean; sha?: string; reason?: string; rows: number }

/**
 * Write learner state to the private state repo as ONE commit (Git Data API). Skips the commit when nothing changed.
 * The repo's history is the versioning; `scripts/import-state.mjs` restores D1 from it.
 */
export async function snapshot(env: Env): Promise<SnapshotResult> {
  if (!env.GITHUB_TOKEN || !env.STATE_REPO) return { committed: false, reason: 'GITHUB_TOKEN or STATE_REPO not configured', rows: 0 }
  const api = `https://api.github.com/repos/${env.STATE_REPO}`
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
    'user-agent': 'personal-learning-os', 'content-type': 'application/json',
  }
  const gh = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${api}${path}`, { ...init, headers })
    if (!res.ok) throw new Error(`github ${init?.method ?? 'GET'} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json<T>()
  }

  let rows = 0
  const files = []
  for (const [name, sql] of Object.entries(TABLES)) {
    const data = await all(env, sql)
    rows += data.length
    files.push({ path: `state/${name}.json`, mode: '100644', type: 'blob', content: `${JSON.stringify(data, null, 1)}\n` })
  }

  const ref = await gh<{ object: { sha: string } }>('/git/ref/heads/main')
  const parent = await gh<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`)
  const tree = await gh<{ sha: string }>('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree: files }) })
  if (tree.sha === parent.tree.sha) {
    await recordSnapshot(env, { committed: false, reason: 'no changes', rows })
    return { committed: false, reason: 'no changes', rows }
  }
  const commit = await gh<{ sha: string }>('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: `snapshot ${nowIso()} UTC (${rows} rows)`, tree: tree.sha, parents: [ref.object.sha] }),
  })
  await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
  const result = { committed: true, sha: commit.sha, rows }
  await recordSnapshot(env, result)
  return result
}

async function recordSnapshot(env: Env, r: SnapshotResult) {
  await run(env, `INSERT INTO meta (key, value) VALUES ('last_snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    JSON.stringify({ ...r, at: nowIso() }))
}
