# Personal Learning OS

A personal learning operating system designed around one KPI:

> Reduce time-to-excellence by maximizing demonstrated capability gained per focused hour while preserving long-term retention.

## V1

- Command Center dashboard
- Active excellence mission
- Skill and competency map
- Curated resource repository
- AI-assisted session runner
- Error laboratory
- Spaced-retrieval queue
- Learning analytics
- Versioned AI prompts
- JSON schemas for durable learning data
- GitHub Pages deployment workflow

## Architecture

GitHub is the canonical source of truth.

- `src` — browser application
- `knowledge` — durable learning data
- `prompts` — AI behavior specifications
- `schemas` — machine-readable contracts
- `worker` — future server-side AI gateway
- `.github/workflows` — validation/deployment automation

The browser app is intentionally mock/local-first. Never put model-provider API keys into client-side code.

## Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy

Push to `main`. GitHub Actions builds the Vite app and deploys it through GitHub Pages.

## Core design principles

1. Capability over consumption
2. Retrieval before rereading
3. Projects expose real competence
4. Errors become training data
5. Bottlenecks determine the next action
6. Practice and mastery evaluation stay separate
7. AI coaches the learner; it does not replace the difficult thinking
8. The repository is the long-term memory
