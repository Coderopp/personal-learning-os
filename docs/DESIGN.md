# Personal Learning OS — V1 Design

Status: **approved 2026-09-28 · Phase 1 implemented** (see §10 for what changed during the build)

> Take a target skill → find the shortest credible path to excellence → serve the right
> resource at the right moment → make you retrieve and apply it → diagnose failures →
> adapt the next step → preserve it through spaced retrieval.

The repo is the **memory**, Groq is the **execution layer**, the benchmark is the **truth layer**.

---

## 0. Inputs this design is built on

| Source | Decision |
|---|---|
| Interview | Domains: LLM engineering, product management, technical hobby projects (e.g. LLM-controlled drone) |
| Interview | PC and tablet must be **equal** clients, reachable **from anywhere** |
| Interview | 5–15 h/week: a few 45–90 min sessions + quick reviews |
| Interview | Rigor is chosen **per mission** (Mastery vs Project mode) |
| Interview | Agent output: curated resources, skill map + roadmap, study primer, suggested videos |
| Interview | Video: YouTube player + timestamped notes, agent-suggested videos, transcript → notes |
| Interview | LLM: **Groq** (default, no Ollama). Budget ≤ ~$5/month |
| Pasted spec | Architecture, engines, error DB, benchmark ≠ practice, AI priority hierarchy, V1 = six modules |
| Memory | Keep it simple for a single user; defer infra with an explicit "bring back when" trigger |

---

## 1. Where this design deviates from the pasted spec (and why)

| Pasted spec says | This design does | Why |
|---|---|---|
| OpenAI Responses API | **Groq** (OpenAI-compatible chat API, JSON-schema output) | Your decision; free tier covers 5–15 h/week |
| GitHub Pages + separate Cloudflare Worker | **Cloudflare Pages + Pages Functions** (GitHub still hosts code, CI builds on push) | One origin (no CORS), one deploy, free auth via Cloudflare Access. GitHub Pages can't run server code anyway |
| IndexedDB now, Supabase "later for sync" | **Cloudflare D1 (SQLite) from day one** | PC + tab sync is a *core* requirement, not later. D1 is the same vendor as the gateway, free, zero ops |
| Curator opens a Pull Request per resource | **In-app review queue; "Approve" commits the resource to the repo** via GitHub API | Same human gate, but you can approve from the tab without opening GitHub |
| One active mission at a time | **One *Primary* mission (Mastery mode) + any number of *Exploration* missions (Project mode)** | Matches your breadth (PM, drones) without diluting the primary. Dashboard always leads with Primary |
| Knowledge graph (§9) | **Deferred.** The prerequisite tree per mission covers V1 | Bring back when ≥2 missions share concepts and you want cross-mission links |
| Embeddings / vector search | **Deferred.** SQLite full-text search | Bring back when the library passes ~1,000 resources |
| Dashboard KPIs (TTE, gain/hour, recall %) | Shown **only when measured**; otherwise "not enough data" | The current app shows seeded fake numbers. A system meant to stop lying to you can't start by lying |
| Build stage "AI evaluates your implementation" | You run code **locally** and paste code + output; AI diagnoses | No code sandbox in V1. Bring back when Build tasks need run verification |

---

## 2. Architecture

```text
 PC browser ─┐                          ┌─────────────── Cloudflare (free tier) ───────────────┐
             ├──HTTPS──► Cloudflare ───►│ Pages: static React app (TS + Vite)                 │
 Tab browser ┘           Access (login) │ Functions /api/*  ── AI gateway + data API           │
                                         │     │        │           │             │           │
                                         │     ▼        ▼           ▼             ▼           │
                                         │   Groq    Tavily     YouTube Data   D1 (SQLite)    │
                                         │   (LLM)   (web       API v3         learner state  │
                                         │            search)   (videos)       + library      │
                                         │                                        │ nightly   │
                                         └────────────────────────────────────────┼───────────┘
                                                                                  ▼
                                  GitHub repo  ◄── approve-commits (resources) ◄──┘ export (state snapshot)
                                  = canonical long-term memory; D1 can be rebuilt from it
```

- **Auth:** Cloudflare Access with email one-time code, restricted to your email. No login code in the app. You sign in once per device (session lasts ~30 days).
- **Secrets** (`GROQ_API_KEY`, `TAVILY_API_KEY`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`) live only in Cloudflare env vars. The browser never sees them (per the repo's rule).
- **GitHub token:** a fine-grained PAT with `contents:write` on this one repo only.
- **Offline behaviour:** the tab caches the current session and due reviews. Answers queue locally and sync when you're back online. (Nice-to-have; see Phase 2.)

### Where data lives

| Data | Live store | Canonical / durable | Written by |
|---|---|---|---|
| Missions, skill trees, excellence definitions | D1 | `knowledge/missions/<id>/mission.json` (commit on create/edit) | Planner agent → you approve |
| Resources (accepted) | D1 | `knowledge/resources/<mission>/<id>.json` (commit on approve) | Curator → you approve |
| Resource candidates | D1 only | — (rejected ones are dropped) | Curator agent |
| Question bank (practice) | D1 | `knowledge/questions/` (nightly export) | Question engine |
| Benchmark tasks (held out) | D1 | `knowledge/benchmarks/` (**sealed**: the app never shows them outside a benchmark run) | Examiner prompt, one-time per competency, + your own |
| Attempts, grades, errors, review schedule, time log, video notes | D1 | `knowledge/state/*.json` nightly snapshot (Worker cron) | Session runner |

"Rebuild from git" is a script: `scripts/import-knowledge` loads the repo JSON into a fresh D1.

---

## 3. Groq usage plan

One gateway module, `functions/_lib/llm.ts`. Every call uses a versioned prompt from `/prompts`, forces **JSON-schema output**, validates it against `/schemas`, and retries with backoff on 429/5xx.

| Operation | Endpoint | Model tier | When |
|---|---|---|---|
| Plan mission (skill tree, excellence benchmark, roadmap) | `POST /api/missions/plan` | large | Creating a mission |
| Curate resources (rank, dedupe, "why it exists") | `POST /api/curate` | large | Mission creation, "find more" on a skill |
| Write primer (cited study notes) | `POST /api/primer` | large | Per skill, on demand, cached |
| Next session plan | `POST /api/session/next` | large | Start Session |
| Generate practice question | `POST /api/question/generate` | fast | Practice stage |
| Evaluate answer + classify error | `POST /api/answer/evaluate` | large | Each submitted attempt |
| Targeted hint | `POST /api/hint` | fast | "Show hint" |
| Transcript → notes | `POST /api/video/notes` | fast (long context) | Per video, cached |
| Benchmark evaluate | `POST /api/benchmark/evaluate` | large | Benchmark run |

- **Model IDs:** "large" = Groq's strongest general model, "fast" = its cheapest. Exact IDs live in one config constant and get confirmed against Groq's model list at build time, because Groq rotates models.
- **Free-tier guardrails:** primers, curation and transcript notes are cached in D1 (generated once, never regenerated). A 45-min session is about 15–25 calls. The gateway tracks the daily count and shows a "Groq quota" chip. If Groq returns 429, the UI says so; it doesn't silently fail.
- **AI priority hierarchy** (from the spec) is baked into the `session-coach` prompt input: competency target → bottleneck → known errors → due reviews → available time → mission mode → general recommendations.

### The knowledge-gathering agent (how it avoids hallucinated links)

An LLM on its own invents URLs, so **every resource must come from a real search result**:

```text
topic ─► Planner (Groq): skill tree + search queries per skill
          ─► Tavily web search  (papers, docs, courses, repos)
          ─► YouTube Data API   (lectures/talks, top ~3 per skill)
          ─► Curator (Groq) sees ONLY the returned results → classify, dedupe vs library,
             write "why this exists", level, time cost, official?, supports: concept|practice|project
          ─► candidates in Review Queue ─► you Approve / Defer / Reject ─► Approve = D1 + git commit
          ─► Primer writer (Groq) uses accepted resources' content as citations
```

Budget: Tavily's free tier (~1,000 searches/month) is about 30 searches per mission. YouTube's free quota is about 100 searches/day. Both are well within ~$5/month. I'll verify both free tiers before building.

---

## 4. Screens

Responsive on both devices: sidebar on the PC, bottom tab bar on the tablet. Every screen supports touch and keyboard, with hit targets of at least 44px.

### 4.1 Dashboard: Where am I? What now? Why? Am I improving?

```text
┌──────────────────────────────────────────────────────────────────────┐
│ PRIMARY · Production LLM Engineering            [Mastery]  ▾ switch   │
│ Capability 58 (benchmarked 12 Sep)   Target 85   Gap 27               │
│──────────────────────────────────────────────────────────────────────│
│ BOTTLENECK  Inference & Optimization  — lowest benchmark score, 2      │
│             recurring errors, prerequisite of Production Systems      │
│──────────────────────────────────────────────────────────────────────│
│ THIS SESSION (≈50 min)                            [ Start session → ] │
│  → Retrieve  KV cache, scaled attention        (2 due reviews)        │
│  → Learn     Primer §3 + FlashAttention paper §3.1                    │
│  → Practice  3 questions on memory/latency trade-offs                 │
│  → Build     Benchmark KV-cache on/off at 128/512/2048 tokens         │
│  → Diagnose  Error #4 "precision@k vs recall@k" (recurring)           │
├───────────────────────────────┬──────────────────────────────────────┤
│ DUE REVIEWS  6  [Review 10m]  │ EXPLORATION                          │
│ RECALL-7  81% (n=42)          │  🛠 LLM-driven drone   milestone 2/5   │
│ RECALL-30 not enough data     │  📘 PM fundamentals    3 notes         │
│ GAIN/HOUR not enough data     │  [+ New mission]                       │
└───────────────────────────────┴──────────────────────────────────────┘
```

- **Reads:** mission, competency scores, errors, review queue, session log.
- **Writes:** nothing.
- "Review 10m" starts a review-only session, for short tablet use.

### 4.2 New Mission (the knowledge agent)

```text
What do you want to get excellent at?  [ Autonomous drone control with LLMs     ]
Mode      (•) Project — build-first, milestones   ( ) Mastery — graded loop + benchmark
Level     ( ) Beginner (•) Some background ( ) Advanced
Time      [ 5 ] h/week      Target date (optional) [      ]
                                                  [ Research & plan → ]
── progress (streamed) ─────────────────────────────────────────────
 ✓ Skill tree (9 competencies)   ✓ 22 web results   ✓ 9 videos   ◌ curating…
```

- **Writes:** `missions` (status = draft), `candidates`.
- **Then:** a Review screen where you edit the tree and approve resources. **Activate** commits `mission.json` to git.

### 4.3 Skill Map (skill workspace)

- **Left:** the prerequisite tree, with each node colored by status: not started / practicing / benchmarked / weak.
- **Right:** the selected node, with tabs **Primer · Resources · Videos · Questions · Errors · History**.
- Primer is generated on first open (cached) and cites accepted resources.
- **Writes:** `primers` (cached), competency edits → commit.

### 4.4 Resource Library + Review Queue

- Filters: mission, skill, type, level, status (candidate/accepted/deprecated), official, hands-on. Search is full-text.
- Each card shows **why this exists** first, then level, time and type.
- **Review Queue** tab: Approve / Defer / Reject, with an optional note. Swipe gestures on the tablet.
- **"Find more for this skill"** reruns the curator on a single competency.
- **Writes:** `resources`, git commit on approve, `candidates.status`.

### 4.5 Video Player

```text
┌─────────────────────────────────────┬─────────────────────────────┐
│ ▶ YouTube embed                      │ NOTES           [+ at 12:04] │
│                                     │ 03:15 Q·K similarity intuition│
│                                     │ 12:04 why √dk (?)            │
│ speed 1× 1.25× 1.5× 2×   ⟲10 ⟳10    │─────────────────────────────│
├─────────────────────────────────────┤ AI NOTES (from transcript)   │
│ [Quiz me on last 10 min] [Summarize]│ Key concepts · 5 questions   │
└─────────────────────────────────────┴─────────────────────────────┘
```

- Opens from any video resource or a pasted YouTube URL. Keyboard shortcuts on the PC: `n` = note, `space` = play/pause.
- Clicking a note's timestamp seeks the video to it. Watch position is saved, and syncs PC ↔ tab.
- **Transcript → notes** produces a summary, key concepts, and questions that go into the question bank tagged with the skill.
- **Risk:** YouTube has no official API for other people's captions, and fetching them from cloud IPs is often blocked. Fallback: a "paste transcript" box (YouTube → ⋯ → Show transcript → copy). I'll test this first and tell you which path works.
- **Writes:** `video_notes`, `video_progress`, `questions` (from quiz / transcript).

### 4.6 Session Runner (Mastery mode)

| Stage | What you see | AI call | Writes |
|---|---|---|---|
| 1 Retrieve | Due reviews + questions from yesterday and past errors. No source visible until you answer | evaluate | `attempts`, `reviews` (reschedule) |
| 2 Learn | The smallest explanation of *only* the gap found in stage 1, with links to the primer section / resource / video timestamp | hint/explain | `attempts.feedback` |
| 3 Practice | A calibrated question: ≥80% correct → harder; <50% → a prerequisite question | generate + evaluate | `questions`, `attempts` |
| 4 Build | A micro-task spec. You paste code + output (or a repo link) | evaluate | `attempts` (type = build) |
| 5 Diagnose | Error classification: conceptual / procedural / factual / strategic / implementation, and whether it is recurring | evaluate | `errors` (new or occurrence++) |
| 6 Reflect | 3 prompts: what you misunderstood, what evidence changed your model, explain it without the code | — | `reflections`, new review items |

- The runner is resumable: close it on the PC, continue on the tab.
- A timer logs focused minutes, which feed gain/hour.
- **Project mode** runs Plan milestone → Learn what's needed → Build → Log what worked/failed → 2 recall questions. Errors are still captured; there's no grading pressure.

### 4.7 Error Lab

- A list of error records, as in spec §8: concept, observed error, root cause, first/last seen, occurrences, status (new/recurring/resolved), next action.
- Recurring errors (≥2 occurrences) are **automatically injected** into the next session's Retrieve stage as contrastive questions.
- An error becomes **resolved** after 3 consecutive correct answers spread over ≥7 days.

### 4.8 Benchmark (truth layer)

- **Held-out tasks** per competency, generated **once** by a separate `examiner` prompt at mission activation, plus any you write yourself. They are sealed: never used in practice, never shown outside a run.
- A run is timed, with no hints and no primer. It is scored on concept, implementation, reasoning and transfer.
- **Capability score comes only from benchmarks.** Practice accuracy is shown separately and labelled as such.
- The app suggests a run every 3 weeks per competency, or when practice accuracy on a competency stays ≥85% for a week.
- **Honest limit:** the tasks are still LLM-authored. For Mission 001 I'd seed some by hand from real sources (e.g. papers' exercises, interview-style design problems).

### 4.9 Analytics

These KPIs come from the spec, each computed only once it has enough data:

| KPI | Formula | Minimum data |
|---|---|---|
| Capability | Mean of latest benchmark per competency | 1 benchmark run |
| Recall-7 / Recall-30 | % of review items answered correctly when due at the D7 / D30 rung | 20 reviews at that rung |
| Transfer | Score on benchmark tasks tagged `transfer` | 3 tasks |
| Error recurrence | recurring errors / all errors, trailing 30 days | 10 errors |
| Gain/hour | Δ capability / focused hours between two benchmarks | 2 benchmarks |
| TTE (projected) | Gap ÷ gain/hour ÷ weekly hours | Gain/hour available |
| Recovery latency | Days from a gap of ≥3 inactive days to the next completed session | 1 gap |

Charts: capability over time, reviews due per day, hours per week.

---

## 5. Spaced retrieval

The spec's fixed ladder is used as is: **D1 → D3 → D7 → D14 → D30 → D60**. A correct answer moves the item up one rung; a wrong one sends it back to D1 and logs an error.

Items are created from Reflect answers, from wrong answers, from key concepts in video notes, and manually.

Bring back FSRS or another adaptive algorithm when there are >500 active items and the ladder feels badly calibrated.

---

## 6. Data model (D1)

`missions` · `competencies` (mission, parent, prerequisites[], score, status) · `resources` · `candidates` · `primers` · `questions` (skill, type, difficulty, source_ids, expected, misconceptions, `bank`: practice|benchmark) · `attempts` (question, answer, score, feedback, stage, session) · `errors` · `reviews` (item, rung, due_at) · `sessions` (mission, started, minutes, stages_done) · `reflections` · `video_notes` · `video_progress` · `llm_usage`.

The JSON schemas in `/schemas` are extended to cover every table, including the spec's resource and question metadata. The same schemas are used for validation in the gateway, in CI, and for LLM output.

---

## 7. Repository layout after V1

```text
personal-learning-os/
├── src/                     React + TypeScript app (pages/, components/, lib/api.ts)
├── functions/api/           Cloudflare Pages Functions (one file per endpoint)
├── functions/_lib/          llm.ts, search.ts, youtube.ts, github.ts, db.ts, schemas.ts
├── migrations/              D1 SQL migrations
├── knowledge/               missions/, resources/, questions/, benchmarks/, state/  (canonical memory)
├── prompts/                 planner, curator, primer, session-coach, question-generator, evaluator, examiner, video-notes
├── schemas/                 JSON Schemas for all records + LLM outputs
├── scripts/                 import-knowledge, validate-knowledge
├── .github/workflows/       validate.yml (typecheck, build, schema-validate knowledge/)
└── docs/                    PRODUCT.md, DESIGN.md, SETUP.md (Cloudflare + keys, ~15 min)
```

The single-folder layout stays; I don't split into `apps/` and `worker/` as the pasted spec suggests, because there's one app and one set of functions, so splitting adds nothing. `deploy.yml` (GitHub Pages) is replaced by Cloudflare Pages' GitHub integration.

---

## 8. Phasing

**Phase 1: usable on PC + tab (the core loop)**
1. Cloudflare Pages + D1 + Access, and the Groq gateway with schema-validated output
2. Missions: the New Mission agent (Tavily + YouTube + Groq), Review Queue, commit on approve
3. Dashboard, Skill Map with primer, Resource Library
4. Session Runner (Mastery + Project modes) with grading and error capture
5. Error Lab, spaced-review queue, "Review 10m"
6. Video player with timestamped notes, progress sync, quiz-me
7. Mission 001, **Production LLM Engineering**, migrated from the current seed data. Exploration missions: PM, LLM-driven drone

**Phase 2: truth + memory**
Benchmark runs and sealed tasks · capability from benchmarks · Analytics KPIs · transcript → notes · nightly git snapshot + import script · offline answer queue

**Phase 3: when data justifies it**
Knowledge graph across missions · embeddings search · adaptive SR scheduling · code-execution sandbox for Build

---

## 9. Open questions for you

1. **Mission 001 = Production LLM Engineering (Primary)?** And do PM and the drone start as Exploration missions?
2. **Cloudflare account:** do you have one? Setup needs you to create it, add the API keys, and enable Access (I'll write `SETUP.md`).
3. **Is a public repo OK?** Nightly snapshots would put your errors, reflections and notes in git. If the repo stays public, I'd write learner state to a **private** companion repo instead.
4. **Custom domain** (~$10/year) or the free `*.pages.dev` URL?

---

## 10. Phase 1 implementation notes (2026-09-28)

Decisions confirmed after review: Mission 001 = Production LLM Engineering (Primary); learner-state snapshots go to a **private** companion repo (Phase 2); hosting on `*.pages.dev`.

Changes from the plan above, made during the build:

| Plan | Built | Why |
|---|---|---|
| Separate `candidates` table | One `resources` table with `status` (candidate/accepted/deferred/rejected/deprecated) | Same review gate, one query path, dedupe by `(mission, url)` |
| Separate review-grader prompt | Reviews are graded by the evaluator (fast tier) via `/attempts` | One grading path records errors and moves the review ladder consistently |
| Tavily + YouTube only | Plus **arXiv and GitHub** search (keyless) | The agent returns real sources even before any search key is set |
| Cloudflare Pages + Functions on `*.pages.dev` | **Worker with static assets** on `*.workers.dev`; `server/worker.ts` handles `/api/*`, Cloudflare serves `dist/` | The dashboard's Git import creates Workers (Cloudflare's recommended platform); same free tier, D1 and Access |
| Transcript fetch "to be tested" | Works from a residential IP (InnerTube captions, 8 s timeout); **paste fallback** when blocked | Cloudflare IPs may be blocked; verify after first deploy |
| Seeded errors in `knowledge/errors/seed.json` | **Removed** | They were illustrative, not the learner's real mistakes; errors now only come from graded attempts |
| Seed questions | Imported as due retrieval items | Mission 001 has recall material on day one |

Models (verified against Groq's model list on 2026-09-28): large `openai/gpt-oss-120b`, fast `openai/gpt-oss-20b`, strict JSON-schema output.

**Bottleneck heuristic** (`server/learning.ts`): among competencies whose prerequisites score ≥ 60, pick the lowest `benchmark ?? practice ?? 0`, with −10 per recurring error. The session coach explains the choice.

**Focused minutes** count only while the session page is visible *and* the learner interacted in the last 3 minutes.

Not in Phase 1 (unchanged): benchmark runs, Analytics page, nightly state snapshot, offline queue.

---

## 11. Phase 2 plan (approved 2026-09-28: A, B, C, E, F; D Analytics deferred)

Goal: add the **truth layer** (benchmarks → real capability numbers), make **video a first-class source** the agent can find *and* search inside, and give the repo a **private long-term memory** of learner state.

Order of work: **A → B → C → D → E**; each ships and deploys on its own.

### A. Agent finds videos (no key needed)

Today the agent only finds videos when `YOUTUBE_API_KEY` is set, and it isn't. Tested 2026-09-28: YouTube's own search endpoint (InnerTube) returns real results with duration, channel and views, keyless.

- `youtubeSearch()` = official Data API when a key is set, otherwise keyless InnerTube search. **Verified from Cloudflare's edge 2026-09-28:** keyless search returned 21 videos and captions returned a full transcript. If YouTube starts blocking, the UI suggests a free `YOUTUBE_API_KEY`.
- Every "Research & plan" and "Find more" includes a video search per competency. The curator now sees **duration, channel, views, published date** and picks **≤ 2 videos per competency**. It prefers lectures and talks from recognized educators and institutions and rejects < 3 min clips and clickbait.
- New **Videos tab** on each competency: thumbnails with watch progress, candidates to approve/reject, and a **Find videos** button (video-only search).
- **Videos page:** a "For your bottleneck" row of accepted, unwatched videos.
- Approving a video fetches its transcript in the background (best effort), so it becomes searchable (B).

```text
┌ Foundations ─ Primer · Resources · [Videos] · Ask · Edit ───────────────┐
│ [Find videos]                                                            │
│ ▶ thumb  Backprop explained · 3Blue1Brown · 13:54 · 5.1M views   ■■■□ 70%│
│ ▶ thumb  Gradient descent lecture · Stanford CS229 · 1:12:03   candidate │
│          Included because … [Approve] [Reject]                           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Writes:** `resources` (+ `duration_s`, `views`, `published` columns), `videos.transcript`.

### B. Search *inside* videos

- Transcripts are split into ~30 s segments and indexed with **SQLite FTS5** (D1 supports it). No embeddings. Bring those back when keyword search misses too often.
- `GET /api/videos/search?q=` returns matching moments across all your saved videos. There's a search box on the Videos page, and **"Find in this video"** in the player; tapping a hit seeks to the timestamp.
- **Learn stage:** after Recall exposes a gap, the gap terms are searched in your transcripts. If a saved video covers it, Learn shows **"Watch 12:04–15:30 of ‹video›"** as a deep link. No extra LLM call.
- **Ask the agent about a video:** the tutor's `ask` gets the top matching transcript segments as context and answers with timestamps ("explained at 23:10").

```text
Videos   [ search your videos: "kv cache memory"            ]
  12:04  Let's build GPT · Karpathy      "…the cache grows with sequence length…"
  03:15  The KV Cache · Efficient NLP    "…memory usage is 2 × layers × …"
```

**Writes:** `transcript_segments` (FTS5 virtual table).

### C. Benchmarks: the truth layer

- New `prompts/examiner.md` generates **3 held-out tasks per competency** (concept, implementation/design, transfer), each with a 4-part rubric: concept · implementation · reasoning · transfer. They're generated on first benchmark request, stored in `questions` with `bank='benchmark'`, and **sealed**: never shown outside a run, never given to the practice generator, never committed to the public repo.
- **Benchmark run** (`/benchmark/:id`): 2 unused tasks, a visible timer, **no hints, primer, tutor or resources**, and answers submitted together. Each task is scored on the 4 dimensions. Tasks are never reused, and fresh ones are generated as the pool empties.
- **Capability:** latest benchmark per competency. Mission capability = the mean over **all** competencies, with unbenchmarked ones counting as 0, plus a coverage figure ("benchmarked 3/8"). This is deliberately strict: it measures *demonstrated* ability only.
- **When to benchmark:** the dashboard suggests a run when practice on a competency is ≥ 85 over ≥ 5 attempts in 7 days, or 21 days have passed since the last run.
- **Honest limit (unchanged):** tasks are LLM-authored. You can add your own real-world tasks, marked `source=own`.

```text
BENCHMARK · Inference & Optimization            ⏱ 18:42      no hints · no sources
Task 1/2  (transfer)
  A 7B model serves 32 concurrent users at 4k context on one 80 GB GPU…
  [ your answer …                                                    ]
                                                        [ Submit benchmark ]
Result:  concept 80 · implementation 62 · reasoning 75 · transfer 58  →  69
```

**Writes:** `benchmark_runs` (new), `questions` (bank=benchmark, `used_at`), `competencies.benchmark_score`.

### D. Analytics page (deferred: not in this phase)

`GET /api/analytics?mission=`, drawn as hand-rolled SVG (no chart library), following the dataviz guidance. Every panel shows **"not enough data (n/need)"** until it can be computed honestly.

| Panel | Source |
|---|---|
| Capability over time + coverage | `benchmark_runs` |
| Per-competency: benchmark vs practice | `competencies` |
| Recall-7 / Recall-30 (with n) | `review_log` |
| Transfer | transfer rubric scores |
| Error recurrence (30 d) | `errors` |
| Focused hours / week (8 weeks) | `sessions` |
| Reviews due, next 14 days | `reviews` |
| Gain / hour and projected TTE | two or more benchmarks + focused hours |
| Recovery latency | gaps of ≥ 3 inactive days |

### E. Private memory snapshot

- New **private** repo `Coderopp/learning-os-state`.
- A **daily Worker cron** (02:00 IST) exports learner state (attempts, errors, reviews, review log, sessions, reflections, video notes, benchmark runs, sealed tasks) as JSON and writes it as **one commit** via the Git Data API. Git history is the versioning.
- `scripts/import-state.mjs` rebuilds D1 from the snapshot, so D1 is disposable.
- Needs a fine-grained token with `contents:write` on both repos (`GITHUB_TOKEN`).

### F. Small fixes bundled in

- **Code-split** routes and lazy-load KaTeX/Markdown: first load drops from ~234 kB gzip to ~110 kB (it matters on the tablet over mobile data).
- **Draft safety:** unsent answers are kept in local storage, so a closed tab or dropped connection doesn't lose typing.

### Deferred (with triggers)

- **Full offline answer queue:** grading needs the server anyway. Bring it back if you study offline (flights, commutes).
- **Embeddings / semantic video search:** when FTS keyword search misses too often.
- **Knowledge graph across missions:** when two or more active missions share concepts.

### Files

| Area | Files |
|---|---|
| Migration | `migrations/0002_phase2.sql`: resources video columns, `transcript_segments` (FTS5), `benchmark_runs`, `questions.used_at`, `questions.rubric` |
| Server | `server/search.ts` (InnerTube + Data API + metadata), `server/routes/videos.ts` (search, segments), `server/routes/benchmarks.ts` (new), `server/routes/analytics.ts` (new), `server/snapshot.ts` + `scheduled` handler in `server/worker.ts`, `server/routes/library.ts` (video-aware curation, tutor transcript context) |
| Prompts | `examiner.md`, `benchmark-grader.md` (new); `curator.md` (video rules); `tutor.md` (timestamps) |
| App | `pages/Benchmark.tsx`, `pages/Analytics.tsx`, `components/charts/*` (new); `MissionPage` Videos tab; `Videos` search + bottleneck row; `VideoPlayer` find-in-video; `Session` Learn deep links; `Dashboard` benchmark prompt and new capability definition; `App` lazy routes + Analytics nav |
| Ops | `wrangler.toml` `[triggers] crons`; `scripts/import-state.mjs`; `docs/SETUP.md` (state repo, token) |

### Phase 2 implementation notes (2026-09-28)

- Keyless YouTube search and captions verified from Cloudflare's edge. Dedupe keys YouTube hits by video id: an earlier URL-path key collapsed every `watch?v=` link into one.
- Transcript search drops stopwords before building the FTS5 query (AND first, OR fallback); otherwise questions like "why does…" matched filler.
- Benchmark runs use 2 tasks (prefer transfer + one other) from a pool of 3 generated by the examiner; submitted *or abandoned* tasks are burned.
- Restore is an upsert by primary key, so columns the snapshot omits (raw transcripts) survive a restore over an existing database.
- Fixed a Phase 1 bug: when the curator rejected every result, an empty D1 batch crashed "Find more".
- First-load bundle 234 kB → 88 kB gzip (lazy routes, Markdown/KaTeX loaded on first use).
