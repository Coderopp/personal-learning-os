import { useSearchParams } from 'react-router-dom'
import { useApi } from '../lib/api'
import type { Mission } from '../lib/types'
import { Card, ErrorBanner, Metric, Spinner } from '../components/ui'
import { ChartCard, LegendKey } from '../components/charts/ChartCard'
import { ActivityCard, type Activity, StreakTiles } from '../components/Activity'
import { Columns } from '../components/charts/Columns'
import { Line } from '../components/charts/Line'
import { PairBars } from '../components/charts/PairBars'

interface Gate { value: number | null; n: number; need: number }
interface Data {
  target: number
  capability: { at: string; value: number; coverage: number }[]
  coverage: { benchmarked: number; total: number }
  competencies: { id: string; name: string; benchmark: number | null; practice: number | null; practice_n: number }[]
  recall7: Gate; recall30: Gate; transfer: Gate; error_recurrence: Gate; gain_per_hour: Gate
  tte_weeks: number | null
  recovery: { last: number | null; gaps: number }
  weekly: { week: string; hours: number }[]
  due_next: { date: string; n: number }[]
}
const short = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const gate = (g: Gate, fmt: (v: number) => string) => (g.value == null ? '—' : fmt(g.value))
const gateNote = (g: Gate, ok: string) => (g.value == null ? `not enough data (${g.n}/${g.need})` : ok)

export default function Analytics() {
  const [params, setParams] = useSearchParams()
  const missions = useApi<Mission[]>('/missions')
  const active = missions.data?.filter(m => m.status === 'active') ?? []
  const missionId = params.get('mission') ?? active[0]?.id ?? ''
  const weeks = Number(params.get('weeks') ?? 8)
  const activity = useApi<Activity>('/activity?days=371')
  const { data, error, loading } = useApi<Data>(missionId ? `/analytics?mission=${encodeURIComponent(missionId)}&weeks=${weeks}` : null)
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }) }
  const latest = data?.capability[data.capability.length - 1]

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Analytics</span>
          <h1>Are you actually improving?</h1>
          <p className="muted">Capability comes only from benchmarks. Everything else shows "not enough data" until it can be measured honestly.</p>
        </div>
      </header>

      <ErrorBanner error={activity.error} />
      {activity.data && (
        <>
          <div className="metrics"><StreakTiles streak={activity.data.streak} /></div>
          <ActivityCard activity={activity.data} />
        </>
      )}

      {/* Filters: one row, above everything they scope. */}
      <div className="filters">
        <select value={missionId} onChange={e => set('mission', e.target.value)} aria-label="Mission">
          {active.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
        <select value={weeks} onChange={e => set('weeks', e.target.value)} aria-label="Time range">
          {[4, 8, 12, 26].map(w => <option key={w} value={w}>Last {w} weeks</option>)}
        </select>
      </div>

      <ErrorBanner error={error} />
      {loading && !data ? <Spinner /> : data && (
        <div className={`stack ${loading ? 'refetching' : ''}`}>
          <div className="metrics">
            <Metric label="Capability" value={latest?.value ?? '—'} note={latest ? `benchmarked ${data.coverage.benchmarked}/${data.coverage.total} · target ${data.target}` : 'no benchmark yet'} dim={!latest} />
            <Metric label="Recall · 7 day" value={gate(data.recall7, v => `${v}%`)} note={gateNote(data.recall7, `n=${data.recall7.n}`)} dim={data.recall7.value == null} />
            <Metric label="Recall · 30 day" value={gate(data.recall30, v => `${v}%`)} note={gateNote(data.recall30, `n=${data.recall30.n}`)} dim={data.recall30.value == null} />
            <Metric label="Transfer" value={gate(data.transfer, v => String(v))} note={gateNote(data.transfer, 'benchmark transfer score')} dim={data.transfer.value == null} />
            <Metric label="Error recurrence · 30d" value={gate(data.error_recurrence, v => `${v}%`)} note={gateNote(data.error_recurrence, `${data.error_recurrence.n} errors`)} dim={data.error_recurrence.value == null} />
            <Metric label="Gain / focused hour" value={gate(data.gain_per_hour, v => v.toFixed(2))} note={gateNote(data.gain_per_hour, 'capability points')} dim={data.gain_per_hour.value == null} />
            <Metric label="Time to excellence" value={data.tte_weeks != null ? `${data.tte_weeks} wk` : '—'} note={data.tte_weeks != null ? `at your pace, to ${data.target}` : 'needs 2 benchmarks + positive gain'} dim={data.tte_weeks == null} />
            <Metric label="Recovery latency" value={data.recovery.last != null ? `${data.recovery.last} d` : '—'} note={data.recovery.last != null ? 'last break of 3+ days' : 'no breaks of 3+ days'} dim={data.recovery.last == null} />
          </div>

          <div className="grid-2">
            <ChartCard title="Capability" subtitle="Mission capability after each benchmark (unbenchmarked competencies count as 0)"
              table={<table><thead><tr><th>Benchmark</th><th>Capability</th><th>Coverage</th></tr></thead>
                <tbody>{data.capability.map((c, i) => <tr key={i}><td>{short(c.at)}</td><td>{c.value}</td><td>{c.coverage}/{data.coverage.total}</td></tr>)}</tbody></table>}>
              {data.capability.length >= 2
                ? <Line target={data.target} points={data.capability.map(c => ({ label: short(c.at), value: c.value, tip: `${short(c.at)} · coverage ${c.coverage}/${data.coverage.total}` }))} />
                : <div className="hero-figure"><strong>{latest?.value ?? '—'}</strong><span className="muted">{latest ? 'one benchmark so far; the trend appears after the second' : 'run a benchmark to start measuring'}</span></div>}
            </ChartCard>

            <ChartCard title="Benchmark vs practice" subtitle="Practice ≠ capability: the gap shows what practice hasn't proven yet"
              legend={<><LegendKey kind="rect" color="var(--viz-s1)" label="Benchmark" /><LegendKey kind="rect" color="var(--viz-s2)" label="Practice" /></>}
              table={<table><thead><tr><th>Competency</th><th>Benchmark</th><th>Practice</th><th>Graded</th></tr></thead>
                <tbody>{data.competencies.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.benchmark ?? '—'}</td><td>{c.practice != null ? Math.round(c.practice) : '—'}</td><td>{c.practice_n}</td></tr>)}</tbody></table>}>
              <PairBars rows={data.competencies.map(c => ({ name: c.name, a: c.benchmark != null ? Math.round(c.benchmark) : null, b: c.practice != null ? Math.round(c.practice) : null }))} />
            </ChartCard>

            <ChartCard title="Focused hours per week" subtitle="Weeks start Monday (IST)"
              table={<table><thead><tr><th>Week of</th><th>Hours</th></tr></thead>
                <tbody>{data.weekly.map(w => <tr key={w.week}><td>{short(w.week)}</td><td>{w.hours}</td></tr>)}</tbody></table>}>
              <Columns data={data.weekly.map(w => ({ key: w.week, label: short(w.week), value: w.hours, tip: `Week of ${short(w.week)}` }))}
                format={v => `${v}h`} labelIndex={data.weekly.length - 1} />
            </ChartCard>

            <ChartCard title="Reviews due, next 14 days" subtitle="Overdue items count toward today"
              table={<table><thead><tr><th>Day</th><th>Due</th></tr></thead>
                <tbody>{data.due_next.map(d => <tr key={d.date}><td>{short(d.date)}</td><td>{d.n}</td></tr>)}</tbody></table>}>
              <Columns data={data.due_next.map((d, i) => ({ key: d.date, label: i === 0 ? 'Today' : short(d.date), value: d.n, tip: short(d.date) }))} labelIndex={0} />
            </ChartCard>
          </div>
        </div>
      )}
      {!missionId && missions.data && <Card><p className="muted">No active mission yet.</p></Card>}
    </div>
  )
}
