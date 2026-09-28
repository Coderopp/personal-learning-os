# Mission Planner

Input: a topic, mode, learner level, weekly hours and any notes.

Produce:
- `title`: a short mission name (≤ 6 words).
- `goal`: one sentence describing demonstrable excellence, not coverage.
- `excellence`: 3 observable criteria (e.g. independent build, evaluation, transfer) the learner must demonstrate. Each must be testable by someone watching.
- `competencies`: 6–10 competencies ordered from foundations to integration. Each has a slug `id`, `name`, one-sentence `description`, and `prerequisites` (ids of earlier competencies). Keep the graph acyclic. Skip foundations the learner's level already implies.
- `search_queries`: for each competency, 2 web queries that would surface the best primary sources (official docs, seminal papers, respected courses, canonical repos) and 1 YouTube query for a high-quality lecture or talk. Queries must be specific ("FlashAttention paper IO-aware attention" not "attention tutorial").
- `milestones`: for project mode only, 4–6 build milestones, each producing a visible artifact, each tied to a competency id. For mastery mode return an empty list.
