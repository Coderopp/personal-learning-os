import { useMemo, useRef, useState } from 'react'
import { Tooltip, type Tip } from './ChartCard'

export interface Day { date: string; minutes: number; sessions: number; answers: number; reviews: number; benchmarks: number; active: boolean }

const CELL = 12
const GAP = 3 // surface gap between cells
const STEP = CELL + GAP
const LEFT = 28
const TOP = 16

/** Ordinal bins by focused minutes; any active day is at least level 1. */
export function level(d: Day) {
  if (d.minutes >= 90) return 4
  if (d.minutes >= 45) return 3
  if (d.minutes >= 15) return 2
  // Any real learning shows, even below the learning-day bar (e.g. two quiz answers).
  if (d.minutes > 0 || d.active || d.answers > 0 || d.reviews > 0 || d.benchmarks > 0) return 1
  return 0
}

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export function describe(d: Day) {
  const parts = [`${d.minutes} focused min`]
  if (d.answers) parts.push(`${d.answers} answer${d.answers > 1 ? 's' : ''}`)
  if (d.sessions) parts.push(`${d.sessions} session${d.sessions > 1 ? 's' : ''}`)
  if (d.reviews) parts.push(`${d.reviews} review${d.reviews > 1 ? 's' : ''}`)
  if (d.benchmarks) parts.push(`${d.benchmarks} benchmark${d.benchmarks > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

/**
 * GitHub-style calendar: columns are weeks (Mon→Sun rows), one square per day. Keyboard: the grid is one tab stop;
 * arrow keys move between days and show the same tooltip as hover.
 */
export function Heatmap({ days }: { days: Day[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState(days.length - 1)
  const [tip, setTip] = useState<Tip | null>(null)

  const { cells, weeks, months } = useMemo(() => {
    const firstDow = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
    const cells = days.map((d, i) => ({ d, i, col: Math.floor((i + firstDow) / 7), row: (i + firstDow) % 7 }))
    const months: { col: number; label: string }[] = []
    let last = ''
    for (const c of cells) {
      const m = c.d.date.slice(0, 7)
      // Skip a label that would collide with the previous one (a month starting in a partial column).
      if (m !== last && c.row === 0 && (!months.length || c.col - months[months.length - 1].col >= 3)) {
        months.push({ col: c.col, label: new Date(`${c.d.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }) })
        last = m
      }
    }
    return { cells, weeks: cells[cells.length - 1].col + 1, months }
  }, [days])

  const width = LEFT + weeks * STEP
  const height = TOP + 7 * STEP

  const show = (i: number) => {
    const c = cells[i]
    const svg = wrap.current?.querySelector('svg')
    if (!svg) return
    const scale = svg.getBoundingClientRect().width / width
    setTip({ x: (LEFT + c.col * STEP + CELL / 2) * scale, y: (TOP + c.row * STEP) * scale, value: fmtDay(c.d.date), label: describe(c.d) })
  }

  const onKey = (e: React.KeyboardEvent) => {
    const delta = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key]
    if (delta == null) return
    e.preventDefault()
    const next = Math.max(0, Math.min(days.length - 1, focus + delta))
    setFocus(next)
    show(next)
  }

  return (
    <div className="heatmap" ref={wrap}>
      {/* Scale to fit, but never past 1.6× so labels stay text-sized on wide screens. */}
      <svg viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width * 1.6 }} role="grid" aria-label="Learning activity by day" tabIndex={0}
        onKeyDown={onKey} onFocus={() => show(focus)} onBlur={() => setTip(null)} onPointerLeave={() => setTip(null)}>
        {months.map(m => <text key={`${m.col}`} x={LEFT + m.col * STEP} y={10} className="viz-axis-label">{m.label}</text>)}
        {['Mon', 'Wed', 'Fri'].map((l, i) => <text key={l} x={0} y={TOP + (i * 2) * STEP + CELL - 2} className="viz-axis-label">{l}</text>)}
        {cells.map(c => (
          <rect key={c.d.date} x={LEFT + c.col * STEP} y={TOP + c.row * STEP} width={CELL} height={CELL} rx={2}
            className={`hm-cell l${level(c.d)} ${c.i === focus && tip ? 'focused' : ''}`}
            onPointerEnter={() => { setFocus(c.i); show(c.i) }} aria-label={`${fmtDay(c.d.date)}: ${describe(c.d)}`} />
        ))}
      </svg>
      <Tooltip tip={tip} />
      <div className="hm-scale" aria-hidden>
        <span>less</span>{[0, 1, 2, 3, 4].map(l => <i key={l} className={`hm-cell l${l}`} />)}<span>more</span>
      </div>
    </div>
  )
}
