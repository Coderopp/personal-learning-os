import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, enc, useAction, useApi } from '../lib/api'
import { ErrorBanner, Spinner } from '../components/ui'
import { ChartCard } from '../components/charts/ChartCard'

interface GraphData {
  missions: { id: string; title: string; mode: string; status: string; role: string; linked: boolean }[]
  competencies: { id: string; mission_id: string; name: string; benchmark: number | null; practice: number | null }[]
  links: { a: string; b: string; shared: string[] }[]
}

const COL_W = 250, NODE_W = 190, NODE_H = 30, ROW = 40, TOP = 34

/**
 * Missions as columns, competencies as nodes, shared concepts as links. Links are recessive gray;
 * selecting a competency highlights its links in the accent and lists what's shared.
 */
export default function Graph() {
  const { data, error, loading, reload } = useApi<GraphData>('/graph')
  const [selected, setSelected] = useState<string | null>(null)
  const link = useAction()

  const layout = useMemo(() => {
    if (!data) return null
    const pos = new Map<string, { x: number; y: number; col: number }>()
    const cols = data.missions.map((m, col) => {
      const nodes = data.competencies.filter(c => c.mission_id === m.id)
      nodes.forEach((n, i) => pos.set(n.id, { x: col * COL_W + 10, y: TOP + i * ROW, col }))
      return { mission: m, nodes }
    })
    const colsBottom = TOP + Math.max(1, ...cols.map(c => c.nodes.length)) * ROW
    // Links that skip a column run in their own lane below all columns, so they never pass behind another mission's nodes.
    const skips = data.links.filter(l => Math.abs((pos.get(l.a)?.col ?? 0) - (pos.get(l.b)?.col ?? 0)) > 1)
    const lane = new Map(skips.map((l, i) => [`${l.a}|${l.b}`, colsBottom + 14 + i * 8]))
    const height = colsBottom + (skips.length ? 22 + skips.length * 8 : 10)
    return { pos, cols, height, lane, width: Math.max(1, data.missions.length) * COL_W - (COL_W - NODE_W) + 20 }
  }, [data])

  const unlinked = data?.missions.filter(m => !m.linked) ?? []
  const linkAll = () => link.run(async () => {
    for (const m of unlinked) await api(`/missions/${enc(m.id)}/link`, { body: {} })
    reload()
  })

  if (loading && !data) return <div className="page"><Spinner /></div>
  if (error || !data || !layout) return <div className="page"><ErrorBanner error={error ?? 'Could not load'} /></div>

  const name = new Map(data.competencies.map(c => [c.id, c]))
  const missionTitle = new Map(data.missions.map(m => [m.id, m.title]))
  const mine = selected ? data.links.filter(l => l.a === selected || l.b === selected) : []
  const touched = new Set(mine.flatMap(l => [l.a, l.b]))

  const edge = (l: { a: string; b: string }) => {
    let [p, q] = [layout.pos.get(l.a)!, layout.pos.get(l.b)!]
    if (!p || !q) return ''
    if (p.col > q.col) [p, q] = [q, p]
    const laneY = layout.lane.get(`${l.a}|${l.b}`)
    if (laneY != null) {
      // Out the right side into the empty gutter, down to this link's lane, across, up the gutter before the
      // target column, and into the target's left side: it never passes behind another node.
      const i = (laneY - layout.lane.values().next().value!) / 8
      const gx1 = p.x + NODE_W + 14 + i * 5, gx2 = q.x - 14 - i * 5
      const y1 = p.y + NODE_H / 2, y2 = q.y + NODE_H / 2, r = 8
      return `M${p.x + NODE_W},${y1} H${gx1 - r} Q${gx1},${y1} ${gx1},${y1 + r} V${laneY - r} Q${gx1},${laneY} ${gx1 + r},${laneY}` +
        ` H${gx2 - r} Q${gx2},${laneY} ${gx2},${laneY - r} V${y2 + r} Q${gx2},${y2} ${gx2 + r},${y2} H${q.x}`
    }
    const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2, x2 = q.x, y2 = q.y + NODE_H / 2
    const dx = Math.max(40, (x2 - x1) / 2)
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker"><Link to="/missions">Missions</Link> · Connections</span>
          <h1>What transfers between your missions</h1>
          <p className="muted">Competencies that share concepts. Strength in one is a head start in the other, and a source of transfer questions. Scores never carry over automatically.</p>
        </div>
      </header>

      {unlinked.length > 0 && (
        <div className="banner info bench-due">
          <span>{unlinked.map(m => m.title).join(', ')} {unlinked.length > 1 ? "haven't" : "hasn't"} been tagged yet. Missions are linked automatically when activated.</span>
          <button className="secondary small" disabled={link.busy} onClick={linkAll}>{link.busy ? 'Tagging concepts…' : 'Link now'}</button>
        </div>
      )}
      <ErrorBanner error={link.error} />

      <ChartCard title={`${data.links.length} connection${data.links.length === 1 ? '' : 's'}`}
        subtitle="Tap a competency to see what it shares"
        table={data.links.length ? (
          <table><thead><tr><th>Competency</th><th>Linked competency</th><th>Shared concepts</th></tr></thead>
            <tbody>{data.links.map(l => (
              <tr key={`${l.a}|${l.b}`}>
                <td>{missionTitle.get(name.get(l.a)?.mission_id ?? '')} › {name.get(l.a)?.name}</td>
                <td>{missionTitle.get(name.get(l.b)?.mission_id ?? '')} › {name.get(l.b)?.name}</td>
                <td>{l.shared.join(', ')}</td>
              </tr>
            ))}</tbody></table>
        ) : <p className="muted">No shared concepts yet.</p>}>
        <div className="graph-scroll">
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ minWidth: Math.min(layout.width, 640) }} className="graph">
            {layout.cols.map(({ mission }, col) => (
              <text key={mission.id} x={col * COL_W + 10} y={16} className="viz-cat-label graph-col">
                {mission.title.length > 30 ? `${mission.title.slice(0, 29)}…` : mission.title}{mission.status === 'draft' ? ' (draft)' : ''}
              </text>
            ))}
            {data.links.map(l => (
              <path key={`${l.a}|${l.b}`} d={edge(l)} className={`graph-edge ${selected && (l.a === selected || l.b === selected) ? 'on' : selected ? 'dim' : ''}`}
                strokeWidth={Math.min(1 + l.shared.length * 0.75, 3.5)} />
            ))}
            {layout.cols.flatMap(({ nodes }) => nodes.map(n => {
              const p = layout.pos.get(n.id)!
              const score = n.benchmark ?? null
              return (
                <g key={n.id} className={`graph-node ${selected === n.id ? 'selected' : touched.has(n.id) ? 'touched' : ''}`}
                  tabIndex={0} role="button" aria-pressed={selected === n.id} aria-label={`${n.name}${score != null ? `, capability ${Math.round(score)}` : ''}`}
                  onClick={() => setSelected(s => (s === n.id ? null : n.id))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(s => (s === n.id ? null : n.id)) } }}>
                  <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={8} />
                  <text x={p.x + 10} y={p.y + 19} className="viz-cat-label">{n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name}</text>
                  {score != null && <text x={p.x + NODE_W - 10} y={p.y + 19} textAnchor="end" className="viz-value">{Math.round(score)}</text>}
                </g>
              )
            }))}
          </svg>
        </div>
      </ChartCard>

      {selected && (
        <section className="card">
          <header className="card-head">
            <div>
              <h2>{name.get(selected)?.name}</h2>
              <p className="muted">{missionTitle.get(name.get(selected)?.mission_id ?? '')}</p>
            </div>
            <Link className="button secondary small" to={`/missions/${name.get(selected)?.mission_id}?c=${encodeURIComponent(selected)}`}>Open</Link>
          </header>
          {mine.length ? (
            <ul className="list">
              {mine.map(l => {
                const other = name.get(l.a === selected ? l.b : l.a)!
                return (
                  <li key={other.id}>
                    <div>
                      <Link to={`/missions/${other.mission_id}?c=${encodeURIComponent(other.id)}`}><strong>{missionTitle.get(other.mission_id)} › {other.name}</strong></Link>
                      <small className="muted">shares {l.shared.join(', ')}</small>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : <p className="muted">No connections to your other missions.</p>}
        </section>
      )}
    </div>
  )
}
