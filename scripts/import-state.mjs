// Restore learner state from a clone of the private state repo:
//   git clone https://github.com/Coderopp/learning-os-state /tmp/state
//   node scripts/import-state.mjs /tmp/state [--remote]
// Upserts by primary key and only touches columns present in the snapshot, so data the snapshot leaves out
// (video transcripts) survives a restore over an existing database. Safe to re-run.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const dir = process.argv[2]
if (!dir) { console.error('usage: node scripts/import-state.mjs <state-repo-dir> [--remote]'); process.exit(1) }
const q = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

// Parents before children so a fresh database stays consistent.
const ORDER = ['missions', 'competencies', 'milestones', 'resources', 'primers', 'questions', 'sessions', 'attempts', 'errors',
  'reviews', 'review_log', 'reflections', 'videos', 'video_notes', 'benchmark_runs', 'llm_usage']
const PK = { primers: 'competency_id', llm_usage: 'day' }
const available = new Set(readdirSync(join(dir, 'state')).map(f => f.replace(/\.json$/, '')))
const sql = []
for (const table of ORDER.filter(t => available.has(t))) {
  for (const row of JSON.parse(readFileSync(join(dir, 'state', `${table}.json`), 'utf8'))) {
    const cols = Object.keys(row)
    const pk = PK[table] ?? 'id'
    const updates = cols.filter(c => c !== pk).map(c => `${c} = excluded.${c}`).join(', ')
    sql.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${Object.values(row).map(q).join(', ')})` +
      (updates ? ` ON CONFLICT(${pk}) DO UPDATE SET ${updates};` : ` ON CONFLICT(${pk}) DO NOTHING;`))
  }
}
mkdirSync('.wrangler', { recursive: true })
writeFileSync('.wrangler/state-import.sql', sql.join('\n') + '\n')
console.log(`${sql.length} rows`)
execFileSync('npx', ['wrangler', 'd1', 'execute', 'learning-os', process.argv.includes('--remote') ? '--remote' : '--local', '--yes', '--file', '.wrangler/state-import.sql'], { stdio: 'inherit' })
