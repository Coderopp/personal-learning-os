import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { Session } from '../lib/types'
import { Empty, ErrorBanner, Spinner } from '../components/ui'

/** Target of the evening reminder: jump straight into a review session for the mission with the most due items. */
export default function StartReview() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [nothing, setNothing] = useState(false)
  useEffect(() => {
    (async () => {
      const due = await api<{ mission_id: string }[]>('/reviews/due')
      if (!due.length) { setNothing(true); return }
      const counts = new Map<string, number>()
      for (const r of due) counts.set(r.mission_id, (counts.get(r.mission_id) ?? 0) + 1)
      const mission = [...counts].sort((a, b) => b[1] - a[1])[0][0]
      const s = await api<Session>('/sessions', { body: { mission_id: mission, kind: 'review' } })
      navigate(`/session/${s.id}`, { replace: true })
    })().catch(e => setError((e as Error).message))
  }, [navigate])
  if (error) return <div className="page"><ErrorBanner error={error} /></div>
  if (nothing) return <div className="page narrow"><Empty><h2>Nothing due right now</h2><p>You're all caught up.</p><Link className="button primary" to="/">Back to Today</Link></Empty></div>
  return <div className="page"><Spinner label="Starting your review…" /></div>
}
