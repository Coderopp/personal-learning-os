-- Learner state + live library. The repo's knowledge/ folder is the durable copy.

CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mastery', 'project')),
  role TEXT NOT NULL DEFAULT 'exploration' CHECK (role IN ('primary', 'exploration')),
  level TEXT NOT NULL DEFAULT 'intermediate',
  hours_per_week INTEGER NOT NULL DEFAULT 5,
  target INTEGER NOT NULL DEFAULT 85,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  excellence TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, description}]
  committed_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE competencies (
  id TEXT PRIMARY KEY,                     -- "<mission>/<slug>"
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '[]', -- JSON [competency id]
  order_idx INTEGER NOT NULL DEFAULT 0,
  practice_score REAL,                      -- EMA of graded practice, 0-100. NOT capability.
  practice_n INTEGER NOT NULL DEFAULT 0,
  benchmark_score REAL                      -- Phase 2: the only source of capability
);
CREATE INDEX competencies_mission ON competencies(mission_id);

CREATE TABLE milestones (                   -- Project-mode missions
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  competency_id TEXT,
  order_idx INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  log TEXT NOT NULL DEFAULT '[]'            -- JSON [{at, worked, failed, next}]
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  competency_id TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'intermediate',
  est_minutes INTEGER,
  official INTEGER NOT NULL DEFAULT 0,
  hands_on INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  supports TEXT NOT NULL DEFAULT '[]',     -- JSON ["concept"|"practice"|"project"]
  source TEXT NOT NULL DEFAULT 'manual',   -- tavily | youtube | arxiv | github | manual | seed
  author TEXT,
  snippet TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'accepted', 'deferred', 'rejected', 'deprecated')),
  note TEXT,
  last_verified TEXT,
  committed_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (mission_id, url)
);
CREATE INDEX resources_mission_status ON resources(mission_id, status);

CREATE TABLE primers (
  competency_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,                    -- markdown with [n] citations
  citations TEXT NOT NULL DEFAULT '[]',     -- JSON [{n, resource_id, title, url}]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  competency_id TEXT,
  type TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 3,
  prompt TEXT NOT NULL,
  expected TEXT NOT NULL,
  misconceptions TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'generated',
  bank TEXT NOT NULL DEFAULT 'practice' CHECK (bank IN ('practice', 'benchmark')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'review')),
  stage INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT '{}',         -- JSON: plan + per-stage progress, so any device can resume
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  focused_minutes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  mission_id TEXT NOT NULL,
  competency_id TEXT,
  question_id TEXT,
  review_id TEXT,
  stage TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  score REAL NOT NULL,
  verdict TEXT NOT NULL,                     -- correct | partial | incorrect
  feedback TEXT NOT NULL,
  gap TEXT,
  error_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX attempts_session ON attempts(session_id);

CREATE TABLE errors (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  competency_id TEXT,
  concept TEXT NOT NULL,
  category TEXT NOT NULL,                    -- conceptual | procedural | factual | strategic | implementation
  observed TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  next_action TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'recurring', 'resolved')),
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  streak_started TEXT
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  competency_id TEXT,
  error_id TEXT,
  prompt TEXT NOT NULL,
  expected TEXT NOT NULL,
  rung INTEGER NOT NULL DEFAULT 0,           -- index into D1 D3 D7 D14 D30 D60
  due_at TEXT NOT NULL,
  source TEXT NOT NULL,                      -- wrong-answer | reflection | video | manual | seed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX reviews_due ON reviews(mission_id, due_at);

CREATE TABLE review_log (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  interval_days INTEGER NOT NULL,            -- interval that had elapsed (1,3,7,14,30,60)
  correct INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reflections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  content TEXT NOT NULL,                     -- JSON {misunderstood, evidence, explain}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,                       -- YouTube video id
  title TEXT NOT NULL,
  channel TEXT,
  mission_id TEXT,
  competency_id TEXT,
  position REAL NOT NULL DEFAULT 0,
  duration REAL,
  transcript TEXT,                           -- JSON [{t, text}] when available
  ai_notes TEXT,                             -- JSON {summary, concepts, questions}
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE video_notes (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  t REAL NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE llm_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0
);
