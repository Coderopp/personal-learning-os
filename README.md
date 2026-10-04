# Personal Learning OS

> Take a target skill → find the shortest credible path to excellence → serve the right resource at the right moment → make you retrieve and apply it → diagnose failures → adapt the next step → preserve it through spaced retrieval.

North-star KPI: **reduce time-to-excellence**, i.e. demonstrated capability gained per focused hour while preserving retention.

The repo is the **memory**, Groq is the **execution layer**, the benchmark is the **truth layer**.

## What it does

- **Missions.** One *Primary* mission (Mastery mode: graded loop, error tracking, spaced review) plus any number of *Exploration* missions (Project mode: build-first milestones and a coach).
- **Learning paths.** Per competency, the agent builds 4 steps you do *inside* the app: **Foundation** (a lecture segment, shown in its course), **Deepen** (an article or paper in the in-app reader or PDF viewer), **Practice** (a small project with a structured, editable brief) and **Latest** (a recent Substack, Medium, beehiiv or blog post). Every step ends with check questions that feed reviews and the Error Lab. See [docs/PRD-learning-paths.md](docs/PRD-learning-paths.md).
- **Sources.** Follow writers on Substack, Medium, beehiiv or any blog; new posts are matched to your skills daily and can join a path as its Latest step.
- **Knowledge agent.** Type a skill; it plans a skill tree and excellence criteria, runs real searches (Tavily, YouTube, arXiv, GitHub), and proposes resources that each state *why they exist*. Nothing enters the library until you approve it; approval commits it to `knowledge/`.
- **Session Runner.** Recall → Learn → Practice → Build → Diagnose → Reflect. Grading, calibrated difficulty, targeted explanations. Resumable across devices.
- **Error Lab.** Every real misunderstanding is recorded with its root cause; recurring ones are injected into future sessions until resolved (3 correct answers across ≥ 7 days).
- **Spaced retrieval.** D1 → D3 → D7 → D14 → D30 → D60 ladder, fed by wrong answers, reflections and videos.
- **Video agent.** Finds lectures and talks per competency (no API key needed) with duration, channel and views, and picks at most 2 per skill with a reason. Approved videos are transcribed and indexed.
- **Search inside videos.** Keyword search across all saved transcripts. The Learn stage links to the exact moment that covers your gap, and the tutor cites `Title @ 12:04`.
- **Video player.** YouTube with timestamped notes, find-in-video, transcript → notes, "quiz me on the last 10 minutes", position synced PC ↔ tablet.
- **Benchmarks (truth layer).** Sealed, held-out tasks per competency, never shown in practice and never reused. Timed, no hints, graded on concept · implementation · reasoning · transfer. **Capability comes only from benchmarks**; unbenchmarked competencies count as 0, shown with coverage.
- **Private memory.** Nightly backup of all learner state to a private GitHub repo; D1 can be rebuilt from it.
- **Honest metrics.** KPIs show "not enough data" until they're measured; practice accuracy is labelled as practice.

## Stack

React + TypeScript + Vite · Cloudflare Worker with static assets (Hono API) · D1 (SQLite) · Cloudflare Access · Groq (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`) with strict JSON-schema output.

```
src/          app (pages/, components/, lib/)
server/       API (worker.ts entry): routes/, llm.ts (Groq gateway), search.ts, youtube.ts, learning.ts (bottleneck, errors, SRS)
migrations/   D1 schema
knowledge/    canonical memory: missions/, resources/, questions/
prompts/      versioned AI behaviour (bundled into the server at build)
schemas/      JSON Schemas for knowledge/ (enforced in CI)
docs/         PRODUCT.md, DESIGN.md, SETUP.md
```

## Run

See **[docs/SETUP.md](docs/SETUP.md)** for deploying to `*.workers.dev` and using it from PC + tablet.

```bash
cp .dev.vars.example .dev.vars   # add GROQ_API_KEY
npm install && npm run db:migrate && npm run db:import
npm run dev
```

## Core design principles

1. Capability over consumption
2. Retrieval before rereading
3. Projects expose real competence
4. Errors become training data
5. Bottlenecks determine the next action
6. Practice and mastery evaluation stay separate
7. AI coaches the learner; it does not replace the difficult thinking
8. The repository is the long-term memory
