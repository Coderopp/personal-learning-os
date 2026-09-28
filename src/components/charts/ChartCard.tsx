import { type ReactNode, useState } from 'react'

/** Every chart has a table-view twin, so no value is reachable only by hovering. */
export function ChartCard({ title, subtitle, legend, table, children, className = '' }: {
  title: ReactNode; subtitle?: ReactNode; legend?: ReactNode; table: ReactNode; children: ReactNode; className?: string
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`card chart-card ${className}`}>
      <header className="card-head">
        <div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>
        <button className="ghost small" aria-pressed={asTable} onClick={() => setAsTable(t => !t)}>{asTable ? 'Chart' : 'Table'}</button>
      </header>
      {legend && !asTable && <div className="viz-legend">{legend}</div>}
      {asTable ? <div className="viz-table">{table}</div> : children}
    </section>
  )
}

export function LegendKey({ kind, color, label }: { kind: 'rect' | 'line'; color: string; label: string }) {
  return <span className="legend-item"><span className={`key ${kind}`} style={{ background: color }} />{label}</span>
}

export interface Tip { x: number; y: number; value: ReactNode; label: ReactNode }

/** One positioned tooltip; values lead, labels follow. Content is rendered by React (escaped), never innerHTML. */
export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="viz-tooltip" role="status" style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  )
}

/** Clean axis ticks (0, 1, 2 … or 0, 5, 10 …) covering max. */
export function ticks(max: number, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100)
}
