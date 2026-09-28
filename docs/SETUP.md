# Setup: PC + tablet, from anywhere (~20 minutes, $0)

Everything runs on Cloudflare's free tier: one **Worker** serves the app and runs the Groq gateway, **D1** stores your learner state, and **Access** protects it with an email login. GitHub stays the source of the code and of curated knowledge.

## 1. Keys you need

| Key | Required | Where |
|---|---|---|
| `GROQ_API_KEY` | yes | console.groq.com → API Keys |
| `TAVILY_API_KEY` | recommended | tavily.com (free tier). Without it the agent only searches arXiv + GitHub |
| `YOUTUBE_API_KEY` | recommended | Google Cloud console → enable **YouTube Data API v3** → Credentials → API key |
| `GITHUB_TOKEN` | optional | GitHub → Settings → Developer settings → Fine-grained token → only `Coderopp/personal-learning-os` → Contents: read & write. Approved resources and activated missions get committed to `knowledge/` |

## 2. Database (done 2026-09-28, account pranav.bhadane.iitkgp)

```bash
npx wrangler login
npx wrangler d1 create learning-os        # the database_id is already in wrangler.toml
npm run db:migrate:remote                 # create tables
npm run db:import -- --remote             # load knowledge/ (Mission 001 etc.)
```

## 3. Worker (connected to GitHub)

The app is one **Cloudflare Worker with static assets**: the React build in `dist/` is served as static files and only `/api/*` runs `server/worker.ts`.

Cloudflare dashboard → **Workers & Pages → Create → Workers → Import a repository** → `Coderopp/personal-learning-os`:

- Project name: **`personal-learning-os`** (must match `name` in `wrangler.toml`)
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Production branch: `main`
- Build variable: `NODE_VERSION = 22`

The D1 binding and plain variables come from `wrangler.toml`. Add the secrets. Each command prompts for the value, so it never lands in a file:

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler secret put GITHUB_TOKEN
```

(or in the dashboard: Worker → Settings → Variables and Secrets → type **Secret**). Never put keys in `wrangler.toml` / `wrangler.jsonc`.

## 4. Lock it to you (Cloudflare Access)

Worker → **Settings → Domains & Routes** → on the `workers.dev` row (and **Preview URLs**) choose **Enable Cloudflare Access**. Then in Zero Trust → Access → Applications, edit that application's policy to *Allow* → *Emails* → your email, login method One-time PIN.

Copy the application's **Audience (AUD) tag** and your team domain (`<team>.cloudflareaccess.com`):

```bash
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ACCESS_TEAM_DOMAIN
```

The API verifies the Access token itself and **refuses all requests** (503) until these two are set. Never set `DEV_NO_AUTH` in production.

## 5. Devices

- **PC:** open `https://personal-learning-os.pranav-bhadane-iitkgp.workers.dev`, enter the emailed code.
- **Tablet:** same URL, sign in, then *Share → Add to Home Screen* (iPad) or *⋮ → Install app* (Android). It opens full-screen like an app. Sessions, notes and video position sync through D1; a session started on one device resumes on the other.

## Local development

```bash
cp .dev.vars.example .dev.vars    # fill GROQ_API_KEY; DEV_NO_AUTH=1 is for local only
npm install
npm run db:migrate && npm run db:import
npm run dev                        # http://localhost:5173 (API on :8788 via wrangler dev) (also reachable from the tablet at http://<pc-ip>:5173)
```

## Free-tier notes

- Groq free limits are per model, per minute and per day. The sidebar shows today's call count; a 429 is shown as a message, never a silent failure. Primers and video notes are cached, so they cost one call ever.
- YouTube captions: fetched automatically when YouTube allows it. Cloudflare's IPs are sometimes blocked, in which case the player asks you to paste the transcript (YouTube → ⋯ → Show transcript).
