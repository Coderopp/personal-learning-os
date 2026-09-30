// Which screens count as learning time, and how a day is coloured (bug fix 2026-09-30: video/quiz work was invisible).
import { buildSync } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'los-'))
writeFileSync(join(dir, 'entry.ts'), `export { learningSource } from '${process.cwd()}/src/lib/activity'\nexport { level } from '${process.cwd()}/src/components/charts/Heatmap'\n`)
buildSync({ entryPoints: [join(dir, 'entry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'out.mjs'), jsx: 'automatic', logLevel: 'error' })
const { learningSource, level } = await import(join(dir, 'out.mjs'))

let failed = 0
const eq = (name, got, want) => { const ok = got === want; if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` → got ${got}, want ${want}`}`) }

eq('session page counts', learningSource('/session/ses_1'), 'session')
eq('video player counts', learningSource('/videos/abc123'), 'video')
eq('video list does not', learningSource('/videos'), null)
eq('benchmark counts', learningSource('/benchmark/bm_1'), 'benchmark')
eq('mission workspace counts', learningSource('/missions/production-llm-engineering'), 'mission')
eq('new-mission form does not', learningSource('/missions/new'), null)
eq('Today does not', learningSource('/'), null)
eq('Analytics does not', learningSource('/analytics'), null)

const day = over => ({ date: '2026-09-29', minutes: 0, sessions: 0, answers: 0, reviews: 0, benchmarks: 0, active: false, ...over })
eq('nothing → empty', level(day({})), 0)
eq('video quiz answers only → coloured (the reported bug)', level(day({ answers: 4, active: true })), 1)
eq('1 answer, below the bar → still coloured', level(day({ answers: 1 })), 1)
eq('50 focused minutes → level 3', level(day({ minutes: 50, active: true })), 3)
process.exit(failed ? 1 : 0)
