import { useRef, useState } from 'react'
import { Tooltip, type Tip } from './ChartCard'

const W = 640, H = 200, LEFT = 32, RIGHT = 60, TOP = 12, BOTTOM = 22

/** Single-series 0–100 line with end-dots (surface ring), a labelled target hairline and a snapping crosshair. */
export function Line({ points, target }: { points: { label: string; value: number; tip: string }[]; target?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const x = (i: number) => LEFT + (points.length === 1 ? 0 : (i * (W - LEFT - RIGHT)) / (points.length - 1))
  const y = (v: number) => TOP + (H - TOP) * (1 - v / 100)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')

  const snap = (i: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const s = r.width / W
    setHover(i)
    setTip({ x: x(i) * s, y: y(points[i].value) * s, value: points[i].value, label: points[i].tip })
  }
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    let best = 0
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i })
    snap(best)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    snap(Math.max(0, Math.min(points.length - 1, (hover ?? points.length - 1) + (e.key === 'ArrowRight' ? 1 : -1))))
  }
  const last = points.length - 1

  return (
    <div className="viz-plot">
      <svg ref={ref} viewBox={`0 0 ${W} ${H + BOTTOM}`} tabIndex={0} aria-label="Capability over time"
        onPointerMove={onMove} onPointerLeave={() => { setHover(null); setTip(null) }} onKeyDown={onKey}
        onFocus={() => snap(last)} onBlur={() => { setHover(null); setTip(null) }}>
        {[0, 25, 50, 75, 100].map(t => (
          <g key={t}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-baseline' : 'viz-grid'} />
            <text x={LEFT - 6} y={y(t) + 4} textAnchor="end" className="viz-axis-label">{t}</text>
          </g>
        ))}
        {target != null && (
          <g>
            <line x1={LEFT} x2={W - RIGHT} y1={y(target)} y2={y(target)} className="viz-target" />
            <text x={W - RIGHT + 6} y={y(target) + 4} className="viz-axis-label">target {target}</text>
          </g>
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={H} className="viz-crosshair" />}
        <path d={path} className="viz-line" />
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={i === last || i === hover ? 5 : 4} className="viz-dot" />)}
        <text x={x(last) + 10} y={y(points[last].value) + 4} className="viz-value">{points[last].value}</text>
        <text x={LEFT} y={H + 16} className="viz-axis-label">{points[0].label}</text>
        {last > 0 && <text x={x(last)} y={H + 16} textAnchor="end" className="viz-axis-label">{points[last].label}</text>}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}
