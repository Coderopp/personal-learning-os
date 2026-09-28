# Setup: PC + tablet, from anywhere (~20 minutes, $0)

Everything runs on Cloudflare's free tier: **Pages** serves the app, **Pages Functions** run the Groq gateway, **D1** stores your learner state, and **Access** protects it with an email login. GitHub stays the source of the code and of curated knowledge.

## 1. Keys you need

| Key | Required | Where |
|---|---|---|
| `GROQ_API_KEY` | yes | console.groq.com → API Keys |
| `TAVILY_API_KEY` | recommended | tavily.com (free tier). Without it the agent only searches arXiv + GitHub |
| `YOUTUBE_API_KEY` | recommended | Google Cloud console → enable **YouTube Data API v3** → Credentials → API key |
| `GITHUB_TOKEN` | optional | GitHub → Settings → Developer settings → Fine-grained token → only `Coderopp/personal-learning-os` → Contents: read & write. Approved resources and activated missions get committed to `knowledge/` |

## 2. Database

```bash
npx wrangler login
npx wrangler d1 create learning-os        # copy the database_id it prints into wrangler.toml
npm run db:migrate:remote                 # create tables
npm run db:import -- --remote             # load knowledge/ (Mission 001 etc.)
```

## 3. Pages project

Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick `Coderopp/personal-learning-os`.

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION = 22`

Bindings (D1 and the plain vars) come from `wrangler.toml`. Add the secrets:

```bash
npx wrangler pages secret put GROQ_API_KEY    --project-name learning-os
npx wrangler pages secret put TAVILY_API_KEY  --project-name learning-os
npx wrangler pages secret put YOUTUBE_API_KEY --project-name learning-os
npx wrangler pages secret put GITHUB_TOKEN    --project-name learning-os
```

## 4. Lock it to you (Cloudflare Access)

Zero Trust dashboard → **Access → Applications → Add → Self-hosted**:

- Domains: `learning-os.pages.dev` **and** `*.learning-os.pages.dev` (preview deploys)
- Policy: *Allow* → *Emails* → your email
- Login method: One-time PIN

Copy the application's **Audience (AUD) tag** and your team domain (`<team>.cloudflareaccess.com`), then:

```bash
npx wrangler pages secret put ACCESS_AUD         --project-name learning-os
npx wrangler pages secret put ACCESS_TEAM_DOMAIN --project-name learning-os
```

The API verifies the Access token itself and **refuses all requests** if these two are missing. Never set `DEV_NO_AUTH` in production.

Push to `main` (or retry the deploy) so the secrets take effect.

## 5. Devices

- **PC:** open `https://learning-os.pages.dev`, enter the emailed code.
- **Tablet:** same URL, sign in, then *Share → Add to Home Screen* (iPad) or *⋮ → Install app* (Android). It opens full-screen like an app. Sessions, notes and video position sync through D1; a session started on one device resumes on the other.

## Local development

```bash
cp .dev.vars.example .dev.vars    # fill GROQ_API_KEY; DEV_NO_AUTH=1 is for local only
npm install
npm run db:migrate && npm run db:import
npm run dev                        # http://localhost:5173 (also reachable from the tablet at http://<pc-ip>:5173)
```

## Free-tier notes

- Groq free limits are per model, per minute and per day. The sidebar shows today's call count; a 429 is shown as a message, never a silent failure. Primers and video notes are cached, so they cost one call ever.
- YouTube captions: fetched automatically when YouTube allows it. Cloudflare's IPs are sometimes blocked, in which case the player asks you to paste the transcript (YouTube → ⋯ → Show transcript).
