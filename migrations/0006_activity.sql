-- Focused minutes on every learning screen (sessions, video player, benchmarks, mission workspace),
-- not just the Session page. One row per IST day and source.
CREATE TABLE activity_minutes (
  day TEXT NOT NULL,        -- YYYY-MM-DD in IST
  source TEXT NOT NULL,     -- session | video | benchmark | mission
  minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);
