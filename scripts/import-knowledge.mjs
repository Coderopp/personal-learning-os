// Rebuild D1 from the canonical repo: `npm run db:import` (local) or `npm run db:import -- --remote`.
// Idempotent: INSERT OR IGNORE, so learner state in D1 is never overwritten.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = new URL('../knowledge/', import.meta.url)
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const ls = p => (existsSync(new URL(p, root)) ? readdirSync(new URL(p, root)) : [])
const q = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`)
const insert = (table, row) => `INSERT OR IGNORE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`

const sql = []
for (const dir of ls('missions')) {
  const m = read(`missions/${dir}/mission.json`)
  sql.push(insert('missions', {
    id: m.id, title: m.title, goal: m.goal, mode: m.mode, role: m.role ?? 'exploration', level: m.level ?? 'intermediate',
    target: m.target ?? 85, status: 'active', excellence: JSON.stringify(m.excellence ?? []),
  }))
  m.competencies.forEach((c, i) => sql.push(insert('competencies', {
    id: c.id, mission_id: m.id, name: c.name, description: c.description ?? '', prerequisites: JSON.stringify(c.prerequisites ?? []), order_idx: i,
  })))
  ;(m.milestones ?? []).forEach((ms, i) => sql.push(insert('milestones', {
    id: `${m.id}-ms-${i}`, mission_id: m.id, title: ms.title, description: ms.description ?? '', competency_id: ms.competency_id ?? null, order_idx: i,
  })))
}
for (const dir of ls('resources')) {
  for (const f of ls(`resources/${dir}`).filter(f => f.endsWith('.json'))) {
    const r = read(`resources/${dir}/${f}`)
    sql.push(insert('resources', {
      id: r.id, mission_id: r.mission_id, competency_id: r.competency_id ?? null, title: r.title, url: r.url, type: r.type,
      level: r.level ?? 'intermediate', est_minutes: r.est_minutes ?? null, official: r.official ?? false, hands_on: r.hands_on ?? false,
      reason: r.reason, supports: JSON.stringify(r.supports ?? []), source: r.source ?? 'seed', author: r.author ?? null,
      status: r.status ?? 'accepted', last_verified: r.last_verified ?? null,
    }))
  }
}
// Seed questions become retrieval items due now, so a fresh mission has something to recall on day one.
for (const f of ls('questions').filter(f => f.endsWith('.json'))) {
  for (const x of read(`questions/${f}`)) {
    sql.push(insert('reviews', {
      id: `seed-${x.id}`, mission_id: x.mission_id, competency_id: x.competency_id ?? null, prompt: x.prompt, expected: x.expected,
      rung: 0, due_at: new Date().toISOString().replace('T', ' ').slice(0, 19), source: 'seed',
    }))
  }
}

const out = new URL('../.wrangler/import.sql', import.meta.url)
mkdirSync(new URL('../.wrangler/', import.meta.url), { recursive: true })
writeFileSync(out, sql.join('\n') + '\n')
console.log(`${sql.length} statements`)
const target = process.argv.includes('--remote') ? '--remote' : '--local'
execFileSync('npx', ['wrangler', 'd1', 'execute', 'learning-os', target, '--yes', '--file', out.pathname], { stdio: 'inherit' })
