// CI gate: every file in knowledge/ must match its schema, and competency graphs must be acyclic.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const schema = n => ajv.compile(JSON.parse(readFileSync(`schemas/${n}.schema.json`, 'utf8')))
const validators = { missions: schema('mission'), resources: schema('resource'), questions: schema('question') }

const walk = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
let failures = 0
const fail = (file, msg) => { failures++; console.error(`✗ ${file}: ${msg}`) }

for (const file of walk('knowledge').filter(f => f.endsWith('.json'))) {
  const kind = file.split('/')[1]
  const validate = validators[kind]
  if (!validate) continue // e.g. knowledge/state snapshots
  const data = JSON.parse(readFileSync(file, 'utf8'))
  for (const item of Array.isArray(data) ? data : [data]) {
    if (!validate(item)) fail(file, ajv.errorsText(validate.errors))
  }
  if (kind === 'missions') {
    const ids = new Set(data.competencies.map(c => c.id))
    const deps = Object.fromEntries(data.competencies.map(c => [c.id, c.prerequisites]))
    for (const c of data.competencies) for (const p of c.prerequisites) if (!ids.has(p)) fail(file, `${c.id} depends on unknown ${p}`)
    const state = {}
    const visit = id => {
      if (state[id] === 1) return fail(file, `prerequisite cycle through ${id}`)
      if (state[id] === 2) return
      state[id] = 1
      for (const p of deps[id] ?? []) visit(p)
      state[id] = 2
    }
    ids.forEach(visit)
  }
}
if (failures) process.exit(1)
console.log('knowledge/ is valid')
