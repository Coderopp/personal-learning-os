import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { useApi } from './lib/api'
import type { Status } from './lib/types'
import { Spinner } from './components/ui'
import Dashboard from './pages/Dashboard'

// Route-level code splitting: the dashboard loads first; everything else on demand.
const NewMission = lazy(() => import('./pages/NewMission'))
const MissionPage = lazy(() => import('./pages/MissionPage'))
const Library = lazy(() => import('./pages/Library'))
const Videos = lazy(() => import('./pages/Videos'))
const VideoPlayer = lazy(() => import('./pages/VideoPlayer'))
const SessionPage = lazy(() => import('./pages/Session'))
const Benchmark = lazy(() => import('./pages/Benchmark'))
const Errors = lazy(() => import('./pages/Errors'))
const Settings = lazy(() => import('./pages/Settings'))

const NAV = [
  { to: '/', label: 'Today', icon: '◎', end: true },
  { to: '/missions', label: 'Missions', icon: '◈' },
  { to: '/library', label: 'Library', icon: '▤' },
  { to: '/videos', label: 'Videos', icon: '▶' },
  { to: '/errors', label: 'Error Lab', icon: '✕' },
  { to: '/settings', label: 'System', icon: '⚙' },
]

export default function App() {
  const status = useApi<Status>('/status')
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  const usage = status.data?.usage_today
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">L</div>
          <div><strong>Learning OS</strong><small>time-to-excellence</small></div>
        </div>
        <nav>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
              <span className="nav-icon" aria-hidden>{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {status.error ? <span className="bad-text">API unreachable</span> : usage && (
            <span title="Groq calls today">
              <span className={`dot ${usage.rate_limited ? 'warn' : ''}`} /> Groq · {usage.calls} calls today
            </span>
          )}
        </div>
      </aside>

      <main className="main">
        <Suspense fallback={<div className="page"><Spinner /></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/missions" element={<MissionPage />} />
          <Route path="/missions/new" element={<NewMission />} />
          <Route path="/missions/:id" element={<MissionPage />} />
          <Route path="/library" element={<Library />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/videos/:id" element={<VideoPlayer />} />
          <Route path="/session/:id" element={<SessionPage />} />
          <Route path="/benchmark/:id" element={<Benchmark />} />
          <Route path="/errors" element={<Errors />} />
          <Route path="/settings" element={<Settings status={status.data} />} />
          <Route path="*" element={<div className="page"><h1>Not found</h1></div>} />
        </Routes>
        </Suspense>
      </main>

      <nav className="tabbar">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <span aria-hidden>{n.icon}</span><small>{n.label}</small>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
