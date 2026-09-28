# Personal Learning OS

> Take a target skill → find the shortest credible path to excellence → serve the right resource at the right moment → make you retrieve and apply it → diagnose failures → adapt the next step → preserve it through spaced retrieval.

North-star KPI: **reduce time-to-excellence**, i.e. demonstrated capability gained per focused hour while preserving retention.

The repo is the **memory**, Groq is the **execution layer**, the benchmark is the **truth layer**.

## What it does

- **Missions.** One *Primary* mission (Mastery mode: graded loop, error tracking, spaced review) plus any number of *Exploration* missions (Project mode: build-first milestones and a coach).
- **Knowledge agent.** Type a skill; it plans a skill tree and excellence criteria, runs real searches (Tavily, YouTube, arXiv, GitHub), and proposes resources that each state *why they exist*. Nothing enters the library until you approve it; approval commits it to `knowledge/`.
- **Session Runner.** Recall → Learn → Practice → Build → Diagnose → Reflect. Grading, calibrated difficulty, targeted explanations. Resumable across devices.
- **Error Lab.** Every real misunderstanding is recorded with its root cause; recurring ones are injected into future sessions until resolved (3 correct answers across ≥ 7 days).
- **Spaced retrieval.** D1 → D3 → D7 → D14 → D30 → D60 ladder, fed by wrong answers, reflections and videos.
- **Video player.** YouTube with timestamped notes, transcript → notes, "quiz me on the last 10 minutes", position synced PC ↔ tablet.
- **Honest metrics.** KPIs show "not enough data" until they're measured. Capability comes only from benchmarks (Phase 2); practice accuracy is labelled as such.

## Stack

React + TypeScript + Vite · Cloudflare Pages + Functions (Hono) · D1 (SQLite) · Cloudflare Access · Groq (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`) with strict JSON-schema output.

```
src/          app (pages/, components/, lib/)
server/       API: routes/, llm.ts (Groq gateway), search.ts, youtube.ts, learning.ts (bottleneck, errors, SRS)
functions/    Pages Functions entry → server/app.ts
migrations/   D1 schema
knowledge/    canonical memory: missions/, resources/, questions/
prompts/      versioned AI behaviour (bundled into the server at build)
schemas/      JSON Schemas for knowledge/ (enforced in CI)
docs/         PRODUCT.md, DESIGN.md, SETUP.md
```

## Run

See **[docs/SETUP.md](docs/SETUP.md)** for deploying to `*.pages.dev` and using it from PC + tablet.

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
