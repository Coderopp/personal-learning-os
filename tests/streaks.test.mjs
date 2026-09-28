// Streak rules (DESIGN.md §12.2): one missed day per ISO week is forgiven; today never breaks a streak.
// Run: npm test  (bundles server/routes/analytics.ts with esbuild, then asserts)
import { buildSync } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = join(mkdtempSync(join(tmpdir(), 'los-')), 'analytics.mjs')
buildSync({ entryPoints: ['server/routes/analytics.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' })
const { streaks } = await import(out)

// Days ending Wednesday 2026-09-30, oldest first: 1 = learning day, 0 = missed.
const mk = (pattern, end = '2026-09-30') => [...pattern].map((ch, i, a) => ({
  date: new Date(Date.parse(`${end}T00:00:00Z`) - (a.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  minutes: 0, sessions: 0, reviews: 0, benchmarks: 0, active: ch === '1',
}))

const cases = [
  ['all active', '11111111111111111', 17, 17, true],
  ['one miss per week is forgiven', '11011111101111111', 15, 15, true],
  ['two misses in one week break it', '11111111100111111', 6, 9, true],
  ['today not yet active keeps the streak', '11111111111111110', 16, 16, true],
  ['yesterday missed, today open: alive, no rest left', '11111111111111100', 15, 15, false],
  ['two misses this week: broken', '11111111111111001', 1, 14, false],
  ['never studied', '00000000000000000', 0, 0, false],
]
let failed = 0
for (const [name, pattern, current, longest, rest] of cases) {
  const r = streaks(mk(pattern))
  const ok = r.current === current && r.longest === longest && r.rest_day_available === rest
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` → got ${r.current}/${r.longest}/${r.rest_day_available}, want ${current}/${longest}/${rest}`}`)
}
process.exit(failed ? 1 : 0)
