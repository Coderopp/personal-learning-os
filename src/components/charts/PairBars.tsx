import { useRef, useState } from 'react'
import { Tooltip, type Tip } from './ChartCard'

const W = 640, LABEL = 170, RIGHT = 40, ROW = 34, BAR = 10, GAP = 2

/** Two series per row on one 0–100 axis: benchmark (slot 1) vs practice (slot 2). Missing values are drawn as "—". */
export function PairBars({ rows }: { rows: { name: string; a: number | null; b: number | null }[] }) {
  const ref = useRef<SVGSVGElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const H = rows.length * ROW + 20
  const x = (v: number) => LABEL + ((W - LABEL - RIGHT) * v) / 100
  const bar = (v: number, top: number, cls: string) => {
    const w = x(v) - LABEL
    if (w <= 0) return null
    const r = Math.min(4, w)
    return <path className={cls} d={`M${LABEL},${top} H${LABEL + w - r} Q${LABEL + w},${top} ${LABEL + w},${top + r} V${top + BAR - r} Q${LABEL + w},${top + BAR} ${LABEL + w - r},${top + BAR} H${LABEL} Z`} />
  }
  const show = (i: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const s = rect.width / W
    const r = rows[i]
    setTip({ x: x(Math.max(r.a ?? 0, r.b ?? 0)) * s, y: (i * ROW + 6) * s, value: `benchmark ${r.a ?? '—'} · practice ${r.b ?? '—'}`, label: r.name })
  }
  return (
    <div className="viz-plot">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onPointerLeave={() => setTip(null)}>
        {[0, 50, 100].map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={rows.length * ROW} className={t === 0 ? 'viz-baseline' : 'viz-grid'} />
            <text x={x(t)} y={rows.length * ROW + 14} textAnchor="middle" className="viz-axis-label">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const top = i * ROW + 6
          return (
            <g key={r.name} tabIndex={0} role="img" aria-label={`${r.name}: benchmark ${r.a ?? 'none'}, practice ${r.b ?? 'none'}`}
              onPointerEnter={() => show(i)} onFocus={() => show(i)} onBlur={() => setTip(null)}>
              <rect x={0} y={i * ROW} width={W} height={ROW} fill="transparent" />
              <text x={LABEL - 10} y={top + BAR + 2} textAnchor="end" className="viz-cat-label">{r.name.length > 24 ? `${r.name.slice(0, 23)}…` : r.name}</text>
              {r.a == null ? <text x={LABEL + 4} y={top + BAR - 1} className="viz-axis-label">not benchmarked</text> : bar(r.a, top, 'viz-bar s1')}
              {r.b != null && bar(r.b, top + BAR + GAP, 'viz-bar s2')}
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}
