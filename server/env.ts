export interface Env {
  DB: D1Database
  GROQ_API_KEY: string
  TAVILY_API_KEY?: string
  YOUTUBE_API_KEY?: string
  GITHUB_TOKEN?: string
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  STATE_REPO?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  LLM_LARGE: string
  LLM_FAST: string
  ACCESS_AUD?: string
  ACCESS_TEAM_DOMAIN?: string
  DEV_NO_AUTH?: string
}

export type AppEnv = { Bindings: Env; Variables: { email: string } }

/** Error whose message is safe to show the learner. */
export class UserFacingError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 | 429 | 502 | 503 = 400) {
    super(message)
  }
}
