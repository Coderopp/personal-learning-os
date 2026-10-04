-- Learning Paths: a path of ≤ 4 in-app units per competency, plus bench/reference, projects and followed feeds.

CREATE TABLE paths (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  competency_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted')),
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT
);

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  path_id TEXT NOT NULL REFERENCES paths(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL,
  competency_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('foundation', 'deepen', 'practice', 'latest', 'bench', 'reference')),
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('read', 'watch', 'pdf', 'code', 'project', 'link')),
  title TEXT NOT NULL,
  url TEXT,
  source TEXT NOT NULL,          -- substack | medium | beehiiv | blog | web | youtube | arxiv | pdf | github | project
  author TEXT,
  publication TEXT,
  published TEXT,
  minutes INTEGER,
  why TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',   -- kind-specific JSON (segment, playlist, repo files, paid flag …)
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  progress REAL NOT NULL DEFAULT 0,
  questions TEXT,                    -- JSON, generated on first open
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX units_path ON units(path_id, role, position);

-- Cached readable content (per URL), so a unit opens instantly on any device.
CREATE TABLE contents (
  url TEXT PRIMARY KEY,
  format TEXT NOT NULL CHECK (format IN ('html', 'markdown', 'none')),
  body TEXT,
  title TEXT,
  author TEXT,
  published TEXT,
  words INTEGER,
  paid INTEGER NOT NULL DEFAULT 0,
  via TEXT,                          -- substack-api | feed | page | tavily
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Practice projects: a structured, user-editable brief (see schemas/project.schema.json).
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  unit_id TEXT UNIQUE,
  mission_id TEXT NOT NULL,
  competency_id TEXT,
  brief TEXT NOT NULL,               -- JSON
  progress TEXT NOT NULL DEFAULT '{}', -- JSON {milestone index: {done, log: [{at, note, feedback}]}}
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Followed publications (Substack, Medium, beehiiv, blogs: anything with a feed).
CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL UNIQUE,
  site_url TEXT NOT NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT,
  last_error TEXT
);

CREATE TABLE feed_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT,
  published TEXT,
  summary TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  matches TEXT NOT NULL DEFAULT '[]',  -- JSON [{competency_id, name, mission_id, score}]
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'added', 'dismissed', 'read')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX feed_items_status ON feed_items(status, published);
