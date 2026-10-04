export type Mode = 'mastery' | 'project'

export interface Mission {
  id: string
  title: string
  goal: string
  mode: Mode
  role: 'primary' | 'exploration'
  level: string
  hours_per_week: number
  target: number
  status: 'draft' | 'active' | 'archived'
  excellence: { name: string; description: string }[]
  committed_sha: string | null
  competency_count?: number
  accepted_count?: number
  candidate_count?: number
  milestone_count?: number
  milestone_done?: number
}

export interface Competency {
  id: string
  mission_id: string
  name: string
  description: string
  prerequisites: string[]
  order_idx: number
  practice_score: number | null
  practice_n: number
  benchmark_score: number | null
}

export interface Milestone {
  id: string
  title: string
  description: string
  competency_id: string | null
  status: 'todo' | 'doing' | 'done'
  log: { at: string; built: string; worked: string; failed: string; next: string; feedback: string }[]
}

export interface MissionDetail extends Mission {
  competencies: Competency[]
  milestones: Milestone[]
}

export interface Resource {
  id: string
  mission_id: string
  mission_title: string
  competency_id: string | null
  competency_name: string | null
  title: string
  url: string
  type: string
  level: string
  est_minutes: number | null
  official: number
  hands_on: number
  reason: string
  supports: string[]
  source: string
  author: string | null
  status: 'candidate' | 'accepted' | 'deferred' | 'rejected' | 'deprecated'
  committed_sha: string | null
  duration_s: number | null
  views: number | null
  published: string | null
}

export interface LearnError {
  id: string
  mission_id: string
  mission_title: string
  competency_id: string | null
  competency_name: string | null
  concept: string
  category: string
  observed: string
  root_cause: string
  next_action: string
  occurrences: number
  status: 'new' | 'recurring' | 'resolved'
  first_seen: string
  last_seen: string
  correct_streak: number
}

export interface Item {
  id: string
  prompt: string
  expected: string
  type: string
  review_id?: string
  error_id?: string
  competency_id?: string | null
}

export interface Grade {
  id: string
  score: number
  verdict: 'correct' | 'partial' | 'incorrect'
  feedback: string
  gap: string
  error: { id: string; category: string; concept: string; recurring: boolean } | null
  review: { rung: number; next_in_days: number } | null
  answer?: string
  verified?: boolean
}

export interface Session {
  id: string
  mission_id: string
  mode: Mode
  kind: 'full' | 'review'
  stage: number
  started_at: string
  ended_at: string | null
  focused_minutes: number
  state: Record<string, unknown>
  attempts?: {
    id: string; stage: string; prompt: string; score: number; verdict: string; feedback: string; gap: string | null
    error_id: string | null; category: string | null; concept: string | null; error_status: string | null; occurrences: number | null
  }[]
}

export interface Status {
  email: string
  providers: { groq: boolean; web: boolean; youtube: boolean; youtube_api: boolean; arxiv: boolean; github: boolean; git: boolean }
  snapshot: { repo: string | null; configured: boolean; last: { at: string; committed: boolean; sha?: string; reason?: string; rows: number } | null }
  models: { large: string; fast: string }
  usage_today: { calls: number; tokens: number; rate_limited: number }
}

export interface BenchmarkStatus {
  competency_id: string
  name: string
  score: number | null
  last_run: string | null
  runs: number
  practice7: { n: number; avg: number | null }
  due: boolean
  reason: string
}

export interface Moment { video_id: string; title: string; channel: string | null; t: number; snippet: string }

export type UnitRole = 'foundation' | 'deepen' | 'practice' | 'latest' | 'bench' | 'reference'
export type UnitKind = 'read' | 'watch' | 'pdf' | 'code' | 'project' | 'link'

export interface Unit {
  id: string
  path_id: string
  mission_id: string
  competency_id: string
  role: UnitRole
  position: number
  kind: UnitKind
  title: string
  url: string
  source: string
  author: string | null
  publication: string | null
  published: string | null
  minutes: number | null
  why: string
  data: Record<string, unknown> & {
    video_id?: string | null
    segment?: { start: number; end: number } | null
    playlist?: { id: string; title: string; episodes: { id: string; title: string }[] }
    paid?: boolean
    pdf_url?: string
    repo?: string
    info?: { repo: string; description: string | null; stars: number; branch: string; readme: string | null; notebooks: { path: string; colab: string }[]; code_files: string[] } | null
  }
  status: 'todo' | 'doing' | 'done'
  progress: number
  questions: (Item & { id: string })[] | null
}

export interface Path {
  id: string
  mission_id: string
  competency_id: string
  status: 'proposed' | 'accepted'
  rationale: string | null
  units: Unit[]
  project_id: string | null
}

export interface ProjectBrief {
  title: string
  summary: string
  goal: string
  context: string
  requirements: string[]
  milestones: { title: string; description: string; acceptance: string }[]
  deliverables: string[]
  acceptance_criteria: string[]
  stack: string[]
  starter_resources: { title: string; url: string }[]
  stretch_goals: string[]
  estimated_hours: number
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  where_to_build: 'browser' | 'local' | 'colab'
  notes: string
}

export interface Feed { id: string; feed_url: string; site_url: string; title: string; platform: string; items: number; unread: number; last_checked_at: string | null; last_error: string | null }
export interface FeedPost {
  id: string; feed_id: string; feed_title: string; platform: string; url: string; title: string; author: string | null
  published: string | null; summary: string; paid: number; status: string
  matches: { competency_id: string; name: string; mission_id: string; why?: string }[]
}
