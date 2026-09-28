-- Phase 2: video metadata, in-video search, benchmarks, snapshot bookkeeping.

ALTER TABLE resources ADD COLUMN duration_s INTEGER;
ALTER TABLE resources ADD COLUMN views INTEGER;
ALTER TABLE resources ADD COLUMN published TEXT;

-- ~30 s transcript windows, keyword-searchable. video_id/t are stored but not tokenized.
CREATE VIRTUAL TABLE transcript_segments USING fts5(video_id UNINDEXED, t UNINDEXED, text, tokenize = 'porter unicode61');

-- Benchmark tasks live in questions with bank = 'benchmark'. They are sealed: never served outside a run, never reused.
ALTER TABLE questions ADD COLUMN used_at TEXT;
ALTER TABLE questions ADD COLUMN rubric TEXT;         -- JSON {concept, implementation, reasoning, transfer}

CREATE TABLE benchmark_runs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  competency_id TEXT NOT NULL,
  task_ids TEXT NOT NULL,                             -- JSON [question id]
  answers TEXT,                                       -- JSON {question id: answer}
  results TEXT,                                       -- JSON [{task_id, dims, score, feedback}]
  dims TEXT,                                          -- JSON {concept, implementation, reasoning, transfer}
  score REAL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  duration_s INTEGER
);
CREATE INDEX benchmark_runs_comp ON benchmark_runs(competency_id, submitted_at);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
