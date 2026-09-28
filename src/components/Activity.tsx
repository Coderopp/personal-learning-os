import { Metric } from './ui'
import { ChartCard } from './charts/ChartCard'
import { type Day, describe, Heatmap } from './charts/Heatmap'

const short = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

export interface Activity {
  today: string
  days: Day[]
  streak: { current: number; longest: number; today_active: boolean; rest_day_available: boolean; active_days: number }
}


export function StreakTiles({ streak }: { streak: Activity['streak'] }) {
  const keep = streak.today_active ? 'done for today' : streak.current > 0 ? 'study today to keep it' : 'start one today'
  return (
    <>
      <Metric label="Streak" value={`${streak.current} day${streak.current === 1 ? '' : 's'}`}
        note={`${keep}${streak.rest_day_available ? ' · rest day available this week' : ' · rest day used this week'}`} />
      <Metric label="Best streak" value={`${streak.longest} days`} note={`${streak.active_days} learning days this year`} />
    </>
  )
}

export function ActivityCard({ activity, title = 'Learning activity' }: { activity: Activity; title?: string }) {
  const active = activity.days.filter(d => d.active || d.minutes > 0).reverse()
  return (
    <ChartCard title={title}
      subtitle="All missions · a learning day = 10+ focused minutes, a finished review, or a benchmark · one missed day per week keeps your streak"
      table={active.length ? (
        <table><thead><tr><th>Day</th><th>Activity</th><th>Counts</th></tr></thead>
          <tbody>{active.map(d => <tr key={d.date}><td>{short(d.date)}</td><td>{describe(d)}</td><td>{d.active ? 'yes' : 'no'}</td></tr>)}</tbody></table>
      ) : <p className="muted">No learning days yet.</p>}>
      <Heatmap days={activity.days} />
    </ChartCard>
  )
}

