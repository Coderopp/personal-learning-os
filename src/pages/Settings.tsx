import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useAction, useApi } from '../lib/api'
import type { Status } from '../lib/types'
import { Card, Chip, ErrorBanner, Spinner } from '../components/ui'

interface HistoryRow {
  id: string; mission_title: string; kind: string; mode: string; started_at: string; ended_at: string | null
  focused_minutes: number; summary: string | null; focus: string | null; attempts: number; avg_score: number | null
}

const PROVIDERS: { key: keyof Status['providers']; label: string; hint: string }[] = [
  { key: 'groq', label: 'Groq (LLM)', hint: 'GROQ_API_KEY: required for every AI feature.' },
  { key: 'web', label: 'Tavily web search', hint: 'TAVILY_API_KEY: docs, courses, articles. Free tier at tavily.com.' },
  { key: 'youtube', label: 'YouTube search', hint: 'Works without a key. Optional YOUTUBE_API_KEY (Data API v3) is used first when set.' },
  { key: 'arxiv', label: 'arXiv', hint: 'Keyless. Papers.' },
  { key: 'github', label: 'GitHub search', hint: 'Keyless. Repositories.' },
  { key: 'git', label: 'Commit to repo', hint: 'GITHUB_TOKEN: approved resources and missions are committed to knowledge/.' },
]

function Backup({ snapshot }: { snapshot: Status['snapshot'] }) {
  const action = useAction()
  const [last, setLast] = useState(snapshot.last)
  const run = () => action.run(async () => {
    const r = await api<{ committed: boolean; sha?: string; reason?: string; rows: number }>('/snapshot', { body: {} })
    setLast({ ...r, at: new Date().toISOString().replace('T', ' ').slice(0, 19) })
  })
  return (
    <Card title="Private memory backup" subtitle={snapshot.repo ? `Nightly at 02:00 IST → ${snapshot.repo} (private)` : 'Not configured'}>
      {!snapshot.configured && <p className="muted small-text">Set GITHUB_TOKEN (fine-grained, contents: write on both repos) to enable backups.</p>}
      {last && (
        <p className="small-text">
          Last: {new Date(`${last.at.replace(' ', 'T')}Z`).toLocaleString()} · {last.rows} rows · {last.committed ? `committed ${last.sha?.slice(0, 7)}` : last.reason}
        </p>
      )}
      <ErrorBanner error={action.error} />
      <button className="secondary small" disabled={!snapshot.configured || action.busy} onClick={run}>{action.busy ? 'Backing up…' : 'Back up now'}</button>
    </Card>
  )
}

export default function Settings({ status }: { status?: Status }) {
  const history = useApi<HistoryRow[]>('/history')
  return (
    <div className="page">
      <header className="page-head">
        <div><span className="kicker">System</span><h1>Configuration & history</h1></div>
      </header>
      <div className="grid-2">
        <Card title="Providers" subtitle="Keys live only in Cloudflare environment variables, never in the browser.">
          {!status ? <Spinner /> : (
            <ul className="list">
              {PROVIDERS.map(p => (
                <li key={p.key}>
                  <div><strong>{p.label}</strong><small className="muted">{p.hint}</small></div>
                  <Chip tone={status.providers[p.key] ? 'good' : 'warn'}>{status.providers[p.key] ? 'on' : 'off'}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Groq usage today" subtitle={status ? `${status.models.large} · ${status.models.fast}` : ''}>
          {status && (
            <div className="metrics compact">
              <div className="metric"><span className="metric-label">Calls</span><strong>{status.usage_today.calls}</strong></div>
              <div className="metric"><span className="metric-label">Tokens</span><strong>{(status.usage_today.tokens / 1000).toFixed(1)}k</strong></div>
              <div className="metric"><span className="metric-label">Rate-limited</span><strong>{status.usage_today.rate_limited}</strong></div>
            </div>
          )}
          <p className="muted small-text">Signed in as {status?.email}. Primers and video notes are cached, so they only cost a call once.</p>
        </Card>
      </div>
      {status && <Backup snapshot={status.snapshot} />}
      <Card title="Session history">
        {history.loading ? <Spinner /> : (
          <ul className="list">
            {history.data?.map(h => (
              <li key={h.id}>
                <div>
                  <Link to={`/session/${h.id}`}><strong>{h.focus ?? (h.kind === 'review' ? 'Spaced review' : h.mission_title)}</strong></Link>
                  <small className="muted">
                    {new Date(`${h.started_at.replace(' ', 'T')}Z`).toLocaleString()} · {h.mission_title} · {h.focused_minutes} min · {h.attempts} attempts
                    {h.avg_score != null ? ` · avg ${h.avg_score}` : ''}{!h.ended_at ? ' · unfinished' : ''}
                  </small>
                  {h.summary && <small>{h.summary}</small>}
                </div>
              </li>
            ))}
            {!history.data?.length && <li className="muted">No sessions yet.</li>}
          </ul>
        )}
      </Card>
    </div>
  )
}
