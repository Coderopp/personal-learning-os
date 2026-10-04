# PRD: Learning Paths (from a pile of links to a path you can do in the app)

Status: **approved with changes · V1 built** · 2026-10-04

Decided: 4-step paths (Foundation → Deepen → Practice → Latest) · rebuild the existing 55 suggestions into paths (old candidates become bench/reference).

**Changes from review (2026-10-04):**
- **Sources:** Substack **+ Medium, beehiiv and personal blogs**, both for discovery (*Latest* step) and for **Follow** (any site with a feed).
- **Practice = a small project** with a **detailed, structured brief** (goal, context, requirements, milestones with acceptance checks, deliverables, stack, starter resources, stretch goals, estimate) saved as data you can **edit** in the app; progress is logged per milestone with coach feedback.
- **PDF reader in V1:** arXiv and other PDFs open in an in-app viewer (pdf.js); check questions come from the PDF's own text.
- **Paid posts:** public preview + link to the original. Paywall workarounds and archive sites are out of scope.

## 1. Problem

The knowledge agent returns **disconnected sources**: a list of links per competency, each judged on its own, most of which you can't *do* anything with inside Learning OS.

### Evidence (production data, 2026-10-04)

| Signal | Number | What it means |
|---|---|---|
| Suggestions waiting in the review queue | **55** | The agent creates a review chore, not a plan |
| Suggestions you approved | **1** | Per-link approval doesn't happen in practice |
| Videos you actually studied | **4**, all in the in-app player (3 found yourself) | You learn where the app gives you somewhere to learn |
| Articles, docs, papers, repos you studied in the app | **0** of 25 | Outbound links leave the learning loop: no notes, no questions, no progress |
| Mid-series picks | MIT 6.832 *Lecture 5* and *6*, 3Blue1Brown *Chapter 5* | Episodes chosen without their course |
| Repos picked | e.g. `deepdrone` (an app, nothing to practice) | "Relevant" ≠ "learnable" |
| Sources from the last 12 months | few; skewed to evergreen YouTube | The field (LLMs, AI PM) moves monthly |

### Root causes

1. **Wrong unit.** The agent curates *links*; you need *learning steps*: what to do, in which order, and why now.
2. **Content lives outside the app.** Clicking a link exits the loop (recall → learn → practice → review), so nothing is tracked, quizzed or remembered.
3. **No context.** Series, sections and segments are flattened into single links.
4. **Too many decisions.** ~7 suggestions × 8 competencies, each needing approval.
5. **Stale by default.** No source of current practitioner writing.

## 2. Who and what job

You, studying 5–15 h/week across LLM engineering (primary), AI PM and a drone project, on PC and tablet.

- **When I start a competency,** I want one short, ordered path I can work through *inside Learning OS*, so I build capability without curating 50 links.
- **When the field moves,** I want the latest practitioner writing on what I'm learning (Substack) to come to me, tied to my skills.
- **When I finish a step,** I want proof I understood it (questions, review items), not just a "done" tick.

## 3. Principles

1. **A resource earns a place in a path only if the app can do something with it:** read, watch, run or answer. Everything else goes on a "Reference" shelf, never in the path.
2. **Path, not pile.** At most 4 steps per competency, ordered, each with a job.
3. **Keep context.** A series becomes a course with episodes; a long video becomes the relevant segment; a long article becomes its sections.
4. **One decision per competency.** Accept the path, or swap one step from the bench. No per-link queue.
5. **Fresh by default.** Fast-moving competencies get a *Latest* step from the last 12 months.
6. **Respect creators.** Show author, publication, date and the original link. Paid posts show the public preview plus a link; never work around a paywall. Content is cached only for you, behind your login.

## 4. Solution: Learning Paths made of Units

### 4.1 The path (per competency)

| Step role | Job | Typical source |
|---|---|---|
| **Foundation** | the mental model | lecture segment, canonical article or docs |
| **Deepen** | the mechanism / details | article sections, course episode, paper (HTML) |
| **Practice** | build something small | a **project** with a structured, editable brief; may use in-browser Python, an established repo (+ Colab) or your own machine |
| **Latest** | what practitioners learned recently | Substack post ≤ 12 months old |

```text
┌ LLM Evaluation ─ path · 4 steps · ~2 h 10 m ───────────────────── [Accept path] ┐
│ 1 FOUNDATION  ▶ Stanford CS336 · Lecture 12 (of 17) · 18:40–41:05 · 22 min       │
│ 2 DEEPEN      📖 "Applying Statistics to LLM Evaluations" §2–§3 · 25 min          │
│ 3 PRACTICE    ⌨ Bootstrap a CI for an eval metric (runs in browser) · 30 min      │
│ 4 LATEST      ✉ Cameron R. Wolfe (Substack) · Mar 2026 · 20 min                   │
│ bench: 3 alternatives ▾          reference shelf: 2 links ▾                      │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Units: every step happens inside the app

| Unit | In-app experience | Completion = |
|---|---|---|
| **Read** (articles, docs, **Substack**) | Clean reader with sections, est. time, select text → note, original link | scrolled through + 2–3 check questions answered |
| **Watch** (YouTube) | The existing player, opened at the chosen **segment**; for series, a course strip ("Lecture 5 of 28 · what 1–4 covered") | segment watched + segment quiz |
| **Run** (exercise) | The in-browser Python runner, graded on real output | verified run |
| **Code-read** (GitHub) | README + one chosen file, rendered; a task ("trace how X works, explain Y"); *Open in Colab* for PyTorch notebooks | task answered |

Check questions are generated **on first open** (not upfront), so Groq's free tier isn't spent on steps you never reach. Answers flow into the existing loop: wrong answers become errors and review items, and the time counts toward the heatmap.

### 4.3 The agent, v2

```text
plan competencies ─► search: web (Tavily) · Substack (Tavily, substack.com + known custom domains)
                             · YouTube videos AND playlists · GitHub (≥100★)
                  ─► curator: rank + classify each hit by what the app can do with it
                  ─► composer: pick ≤ 4 units with roles; for a series → the course + episode;
                     for a long video → segment from the transcript; for an article → sections
                  ─► enrich: fetch the content (Substack post API / Tavily extract / transcript / README)
                  ─► path + bench (2–3 alternatives) + reference shelf
```

Anything the app can't render (extraction fails, paid-only, PDF-only) goes to the reference shelf automatically.

### 4.4 Substack: latest information

- **Discovery:** each competency gets a Substack search, restricted to the last 12 months and to free posts. Verified 2026-10-04: a query on LLM evals returned Cameron R. Wolfe's *Applying Statistics to LLM Evaluations* (Mar 2026, 10k words, full text available).
- **Follow publications** (Sources page): follow a writer by URL, or one tap on any Substack step. A daily job reads their feeds, matches new posts to your competencies using the concept tags from Phase 3, and shows them in **New for you** on Today. One tap adds a post to a path as its *Latest* step.

```text
NEW FOR YOU                                             Sources (6 followed) ›
✉ Cameron R. Wolfe · Notes on NVIDIA Nemotron · 2 days ago · matches Inference & Optimization   [+ Add to path]
✉ Lenny's Newsletter · Advanced evals… · paid (preview) · matches Metrics Design for LLM          [Open preview]
```

### 4.5 How it shows up

- **Competency panel:** a new **Path** tab (default) replaces "Resources" as the main view; Resources becomes the full library.
- **Session → Learn stage:** "Continue your path: step 2 of 4", which opens the unit directly instead of a generic resource list.
- **Review queue:** replaced by **one path decision per competency**.
- **Existing 55 suggestions:** rebuilt into paths by the new agent; the old candidates become bench/reference material.

## 5. Success metrics

| Metric | Now | Target (4 weeks after launch) |
|---|---|---|
| Path acceptance (accepted with ≤ 1 swap) | 1/56 links approved | ≥ 70% of paths |
| Units completed (opened → check questions answered) | n/a (links) | ≥ 50% |
| Learning time inside the app vs link-outs | video only | ≥ 80% |
| Competencies with a *Latest* step (LLM, AI PM missions) | ~0 | ≥ 75% |
| **Guardrails:** Groq calls per new mission · Tavily credits per mission | – | ≤ 40 · ≤ 40 (free tiers) |

## 6. Scope

**V1 (build now):** path + unit data model; agent v2 (playlists, Substack, composer, enrichment); Reader; Watch with segment and series context; Code-read with Colab link; Run units; lazy check questions; path approval UX; Learn stage uses the path; rebuild existing missions; **Follow + New for you**.

**Not now:** highlights sync; podcasts; anything that circumvents paywalls.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Extraction fails on some sites | The unit falls back to the reference shelf; the composer picks the next bench item |
| YouTube's keyless endpoints change | The official API key is the fallback (already supported) |
| Groq free-tier limits | Questions generated lazily; composer is one call per competency; existing budget table |
| Tavily free tier (1,000 credits/mo) | ~4 credits per competency (search + extract); followed feeds cost 0 credits (plain RSS) |
| Copyright | Private, single-user app behind Cloudflare Access; attribution + original link; paid content never fetched beyond the public preview |

## 8. Feasibility checks done (2026-10-04)

| Check | Result |
|---|---|
| Substack discovery via Tavily (`include_domains: substack.com`, last year) | ✓ relevant 2026 posts |
| Full free post via the Substack post API (also on custom domains like lennysnewsletter.com) | ✓ title, date, word count, body; paid posts return no body (→ preview only) |
| Publication feed for "follow" | ✓ 20 latest posts |
| YouTube: find the playlist for a lecture, list its episodes in order | ✓ MIT 6.832 → 28 ordered lectures |
| GitHub: README + whether it has runnable notebooks | ✓ (`nn-zero-to-hero`: 7 notebooks; `deepdrone`: none, so reference only) |
| Generic article → clean text (Tavily extract) | ✓ Product Talk article, 47k chars with headings |

### Content access by platform (verified 2026-10-04)

| Platform | Discover | Read in-app | Follow |
|---|---|---|---|
| Substack (incl. custom domains) | Tavily `include_domains` | post API (free posts in full; paid = preview) | `/feed` |
| Medium | Tavily | the author's feed (full text for recent posts); pages block bots → otherwise reference shelf | `medium.com/feed/@user`, `<user>.medium.com/feed` |
| beehiiv | Tavily | feed `content:encoded`, or the server-rendered page | `<site>/feed` (advertised in the page) |
| Personal blogs | Tavily (last 12 months) | feed content, else the page's article text, else Tavily extract | feed autodiscovery (`<link rel="alternate">`, `/feed`, `/rss`, `/atom.xml`, `/index.xml`) |
| arXiv / PDFs | arXiv API, Tavily | pdf.js viewer (proxied through the Worker); text for questions read in the browser | – |

### Build notes (V1, 2026-10-04)

- **Tables** (migration 0007): `paths`, `units`, `contents` (cached readable text), `projects` (brief per `schemas/project.schema.json`), `feeds`, `feed_items`.
- **Agent v2**, `buildPath()` in `server/routes/paths.ts`: one search fan-out (Tavily web + newsletters/blogs from the last 12 months, YouTube videos + playlists, arXiv, GitHub ≥100★), one composer call (large model) and one project-designer call (fast model, a separate rate-limit bucket). About 13 s per competency in testing. Earlier suggestions for the competency join the candidate pool, and the per-link queue is retired (`deferred`).
- **Enrichment is lazy:** readable text, video segment + course, and repo files are fetched when a step is first opened, so credits and tokens are only spent on steps you reach.
- **Feed matching** uses one fast-model call per batch of new posts. Keyword overlap alone produced false matches ("Photo Scrubber" → "MAVSDK Python API Usage"), so it's only a fallback.
- **Reader:** third-party HTML is cleaned on the server (scripts, forms, site nav/header/footer removed; relative URLs made absolute) and sanitized again with DOMPurify in the browser.
- **Paid posts:** preview + link. Researching or building paywall workarounds/archive-site access was requested and declined.
