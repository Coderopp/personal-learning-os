import { type Env, UserFacingError } from './env'
import { PROMPTS, type PromptName } from './prompts.gen'
import { run } from './db'

type Tier = 'large' | 'fast'
type JsonSchema = Record<string, unknown>

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * Call Groq with a versioned prompt and force the reply into `schema` (strict JSON-schema mode).
 * Every call is counted in llm_usage so the UI can show quota.
 */
export async function llm<T>(env: Env, opts: {
  prompt: PromptName
  input: unknown
  schema: JsonSchema
  tier?: Tier
  maxTokens?: number
}): Promise<T> {
  if (!env.GROQ_API_KEY) throw new UserFacingError('GROQ_API_KEY is not configured on the server.', 503)
  const tier = opts.tier ?? 'large'
  const body = {
    model: tier === 'large' ? env.LLM_LARGE : env.LLM_FAST,
    messages: [
      { role: 'system', content: `${PROMPTS._shared}\n\n${PROMPTS[opts.prompt]}` },
      { role: 'user', content: JSON.stringify(opts.input) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: opts.prompt.replace(/-/g, '_'), strict: true, schema: opts.schema } },
    reasoning_effort: tier === 'large' ? 'medium' : 'low',
    include_reasoning: false,
    max_completion_tokens: opts.maxTokens ?? 4096,
    temperature: 0.4,
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const data = await res.json<{ choices: { message: { content: string } }[]; usage?: { total_tokens?: number } }>()
      await recordUsage(env, data.usage?.total_tokens ?? 0, false)
      try {
        return JSON.parse(data.choices[0].message.content) as T
      } catch {
        if (attempt < 1) continue
        throw new UserFacingError('The model returned malformed output. Try again.', 502)
      }
    }

    const retryAfter = Number(res.headers.get('retry-after') ?? '0')
    if (res.status === 429) {
      await recordUsage(env, 0, true)
      // Short waits are worth absorbing; long ones (daily quota) go straight back to the learner.
      if (attempt < 2 && retryAfter > 0 && retryAfter <= 8) {
        await sleep(retryAfter * 1000)
        continue
      }
      throw new UserFacingError(
        `Groq rate limit reached${retryAfter ? `, retry in ~${Math.ceil(retryAfter)}s` : ''}. Free-tier quota resets over time.`,
        429,
      )
    }
    if (res.status >= 500 && attempt < 2) {
      await sleep(500 * 2 ** attempt)
      continue
    }
    const detail = (await res.text()).slice(0, 300)
    console.error('groq error', res.status, detail)
    throw new UserFacingError(`Groq request failed (${res.status}).`, 502)
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function recordUsage(env: Env, tokens: number, rateLimited: boolean) {
  const day = new Date().toISOString().slice(0, 10)
  await run(env,
    `INSERT INTO llm_usage (day, calls, tokens, rate_limited) VALUES (?, 1, ?, ?)
     ON CONFLICT(day) DO UPDATE SET calls = calls + 1, tokens = tokens + excluded.tokens, rate_limited = rate_limited + excluded.rate_limited`,
    day, tokens, rateLimited ? 1 : 0,
  ).catch(e => console.error('usage record failed', e))
}

// ---------- JSON schemas for model output (strict mode: every property required, no extras) ----------

const obj = (properties: Record<string, JsonSchema>): JsonSchema =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const str: JsonSchema = { type: 'string' }
const int: JsonSchema = { type: 'integer' }
const num: JsonSchema = { type: 'number' }
const bool: JsonSchema = { type: 'boolean' }
const arr = (items: JsonSchema): JsonSchema => ({ type: 'array', items })
const oneOf = (...values: string[]): JsonSchema => ({ type: 'string', enum: values })

const QUESTION_TYPES = ['recall', 'explanation', 'derivation', 'prediction', 'diagnosis', 'debugging', 'design', 'transfer']
const ERROR_CATEGORIES = ['conceptual', 'procedural', 'factual', 'strategic', 'implementation']

const qa = obj({ prompt: str, expected: str, type: oneOf(...QUESTION_TYPES) })

export const SCHEMAS = {
  plan: obj({
    title: str,
    goal: str,
    excellence: arr(obj({ name: str, description: str })),
    competencies: arr(obj({ id: str, name: str, description: str, prerequisites: arr(str) })),
    search_queries: arr(obj({ competency_id: str, web: arr(str), youtube: str })),
    milestones: arr(obj({ title: str, description: str, competency_id: str })),
  }),
  curate: obj({
    picks: arr(obj({
      index: int,
      type: oneOf('paper', 'book', 'course', 'documentation', 'repository', 'lecture', 'article', 'video'),
      level: oneOf('beginner', 'intermediate', 'advanced'),
      est_minutes: int,
      official: bool,
      hands_on: bool,
      supports: arr(oneOf('concept', 'practice', 'project')),
      reason: str,
    })),
  }),
  primer: obj({ markdown: str }),
  session: obj({
    focus_reason: str,
    retrieve: arr(qa),
    learn_resource_ids: arr(str),
    build_task: obj({ title: str, instructions: str, definition_of_done: str }),
    reflect_prompts: arr(str),
  }),
  question: obj({
    type: oneOf(...QUESTION_TYPES),
    difficulty: int,
    prompt: str,
    expected: str,
    misconceptions: arr(str),
  }),
  evaluate: obj({
    score: num,
    verdict: oneOf('correct', 'partial', 'incorrect'),
    feedback: str,
    gap: str,
    error: obj({
      present: bool,
      category: oneOf(...ERROR_CATEGORIES),
      concept: str,
      observed: str,
      root_cause: str,
      next_action: str,
      matches_error_id: str,
    }),
  }),
  tutor: obj({ markdown: str }),
  reflection: obj({ summary: str, items: arr(obj({ prompt: str, expected: str })) }),
  videoNotes: obj({
    summary: str,
    concepts: arr(obj({ t: num, name: str, note: str })),
    questions: arr(qa),
  }),
  projectLog: obj({
    feedback: str,
    errors: arr(obj({ category: oneOf(...ERROR_CATEGORIES), concept: str, observed: str, root_cause: str, next_action: str })),
    recall: arr(qa),
    milestone_done: bool,
  }),
} satisfies Record<string, JsonSchema>
