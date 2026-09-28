import { useRef, useState } from 'react'
import { ticks, Tooltip, type Tip } from './ChartCard'

const H = 180, BOTTOM = 22, LEFT = 32, TOP = 14, BAR_MAX = 24

/** Single-series column chart: one hue, ≤ 24px columns with a 4px rounded cap, one baseline, hairline grid. */
export function Columns({ data, format = v => String(v), labelIndex }: {
  data: { key: string; label: string; value: number; tip: string }[]
  format?: (v: number) => string
  labelIndex?: number // the one column that gets a direct value label (e.g. the latest week)
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const W = 640
  const axis = ticks(Math.max(...data.map(d => d.value), 0))
  const max = axis[axis.length - 1] || 1
  const band = (W - LEFT) / data.length
  const barW = Math.min(BAR_MAX, band * 0.6)
  const y = (v: number) => TOP + (H - TOP) * (1 - v / max)

  const show = (i: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const s = r.width / W
    setTip({ x: (LEFT + band * i + band / 2) * s, y: y(data[i].value) * s, value: format(data[i].value), label: data[i].tip })
  }

  return (
    <div className="viz-plot">
      <svg ref={ref} viewBox={`0 0 ${W} ${H + BOTTOM}`} onPointerLeave={() => setTip(null)}>
        {axis.map(t => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-baseline' : 'viz-grid'} />
            <text x={LEFT - 6} y={y(t) + 4} textAnchor="end" className="viz-axis-label">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = LEFT + band * i + (band - barW) / 2
          const top = y(d.value)
          const h = y(0) - top
          return (
            <g key={d.key} onPointerEnter={() => show(i)} onFocus={() => show(i)} onBlur={() => setTip(null)} tabIndex={0}
              role="img" aria-label={`${d.tip}: ${format(d.value)}`}>
              {/* Hit area: the whole band, bigger than the mark. */}
              <rect x={LEFT + band * i} y={TOP} width={band} height={H - TOP} fill="transparent" />
              {h > 0 && <path className="viz-bar" d={`M${x},${y(0)} V${top + Math.min(4, h)} Q${x},${top} ${x + Math.min(4, barW / 2)},${top} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${top} ${x + barW},${top + Math.min(4, h)} V${y(0)} Z`} />}
              {i === labelIndex && d.value > 0 && <text x={x + barW / 2} y={top - 5} textAnchor="middle" className="viz-value">{format(d.value)}</text>}
              {(data.length <= 14 || i % Math.ceil(data.length / 8) === 0) && (
                <text x={LEFT + band * i + band / 2} y={H + 15} textAnchor="middle" className="viz-axis-label">{d.label}</text>
              )}
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}
