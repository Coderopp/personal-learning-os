import { type Env, UserFacingError } from './env'
import { PROMPTS, type PromptName } from './prompts.gen'
import { run } from './db'

type Tier = 'large' | 'fast'
type JsonSchema = Record<string, unknown>

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * Groq's free tier allows ~8k tokens/minute PER MODEL and counts the requested max output against it,
 * so every operation gets a right-sized output budget, and cheap operations use the fast model's separate bucket.
 */
const TPM_LIMIT = 8000
const BUDGET: Record<PromptName, { tier: Tier; max: number }> = {
  planner: { tier: 'large', max: 3500 },
  'session-coach': { tier: 'large', max: 2500 },
  evaluator: { tier: 'large', max: 1500 },
  tutor: { tier: 'large', max: 2000 },
  primer: { tier: 'large', max: 2500 },
  'project-coach': { tier: 'large', max: 2000 },
  examiner: { tier: 'large', max: 3500 },
  // Curation is judgment-heavy; its input is capped (12 results, short snippets) so the large model fits the budget.
  curator: { tier: 'large', max: 2000 },
  'benchmark-grader': { tier: 'large', max: 1200 },
  'question-generator': { tier: 'fast', max: 1500 },
  reflection: { tier: 'fast', max: 1200 },
  'video-notes': { tier: 'fast', max: 2500 },
  // Merging synonyms into the existing vocabulary is judgment-heavy.
  'concept-tagger': { tier: 'large', max: 2500 },
  composer: { tier: 'large', max: 2500 },
  // Separate model bucket from the composer so building a path doesn't stall on the per-minute limit.
  'project-designer': { tier: 'fast', max: 3000 },
  'unit-questions': { tier: 'fast', max: 1500 },
  'feed-matcher': { tier: 'fast', max: 2000 },
}
const estimateTokens = (text: string) => Math.ceil(text.length / 3.5)

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
  const budget = BUDGET[opts.prompt]
  const tier = opts.tier ?? budget.tier
  const system = `${PROMPTS._shared}\n\n${PROMPTS[opts.prompt]}`
  const user = JSON.stringify(opts.input)
  const promptTokens = estimateTokens(system) + estimateTokens(user)
  if (promptTokens > TPM_LIMIT - 800) {
    throw new UserFacingError('This request is too large for Groq\'s free tier. Try a shorter input.', 400)
  }
  // Never reserve more than what's left of the per-minute budget after the prompt.
  const maxTokens = Math.min(opts.maxTokens ?? budget.max, TPM_LIMIT - promptTokens - 200)
  const body = {
    model: tier === 'large' ? env.LLM_LARGE : env.LLM_FAST,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: opts.prompt.replace(/-/g, '_'), strict: true, schema: opts.schema } },
    reasoning_effort: tier === 'large' ? 'medium' : 'low',
    include_reasoning: false,
    max_completion_tokens: maxTokens,
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
      // Per-minute limits clear within seconds: absorb them (waiting costs no Worker CPU).
      // Long waits (daily quota) go straight back to the learner.
      if (attempt < 3 && retryAfter > 0 && retryAfter <= 25) {
        await sleep(retryAfter * 1000)
        continue
      }
      throw new UserFacingError(
        `Groq rate limit reached${retryAfter ? `, retry in ~${Math.ceil(retryAfter)}s` : ''}. Free-tier quota resets over time.`,
        429,
      )
    }
    const detail = res.status === 400 || res.status === 413 ? await res.text() : ''
    // Strict JSON-schema mode occasionally rejects a generation (e.g. extra fields); a fresh sample usually passes.
    if (res.status === 400 && (detail.includes('json_validate_failed') || detail.includes('does not match the expected schema')) && attempt < 2) continue
    if (res.status === 413) {
      throw new UserFacingError('This request is too large for Groq\'s free tier. Try again with less input.', 400)
    }
    if (res.status >= 500 && attempt < 2) {
      await sleep(500 * 2 ** attempt)
      continue
    }
    console.error('groq error', res.status, (detail || await res.text()).slice(0, 300))
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
    build_task: obj({ title: str, instructions: str, definition_of_done: str, runs_in_browser: bool }),
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
    verified: bool,
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
  examiner: obj({
    tasks: arr(obj({
      kind: oneOf('concept', 'design', 'transfer'),
      prompt: str,
      expected: str,
      rubric: obj({ concept: str, implementation: str, reasoning: str, transfer: str }),
    })),
  }),
  composePath: obj({
    foundation: obj({ index: int, why: str, minutes: int, episode_hint: str }),
    deepen: obj({ index: int, why: str, minutes: int, episode_hint: str }),
    latest: { anyOf: [obj({ index: int, why: str, minutes: int, episode_hint: str }), { type: 'null' }] },
    bench: arr(int),
    reference: arr(int),
    rationale: str,
  }),
  projectBrief: obj({
    title: str, summary: str, goal: str, context: str,
    requirements: arr(str),
    milestones: arr(obj({ title: str, description: str, acceptance: str })),
    deliverables: arr(str), acceptance_criteria: arr(str), stack: arr(str),
    starter_resources: arr(obj({ title: str, url: str })),
    stretch_goals: arr(str), estimated_hours: num,
    difficulty: oneOf('beginner', 'intermediate', 'advanced'),
    where_to_build: oneOf('browser', 'local', 'colab'),
    notes: str,
  }),
  unitQuestions: obj({ questions: arr(qa) }),
  feedMatches: obj({ posts: arr(obj({ index: int, matches: arr(obj({ competency_id: str, why: str })) })) }),
  conceptTags: obj({
    tags: arr(obj({ competency_id: str, concepts: arr(obj({ slug: str, name: str })) })),
  }),
  benchmarkGrade: obj({ concept: num, implementation: num, reasoning: num, transfer: num, feedback: str }),
} satisfies Record<string, JsonSchema>
