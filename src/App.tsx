import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useApi } from './lib/api'
import type { Status } from './lib/types'
import Dashboard from './pages/Dashboard'
import NewMission from './pages/NewMission'
import MissionPage from './pages/MissionPage'
import Library from './pages/Library'
import Videos from './pages/Videos'
import VideoPlayer from './pages/VideoPlayer'
import SessionPage from './pages/Session'
import Errors from './pages/Errors'
import Settings from './pages/Settings'

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
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/missions" element={<MissionPage />} />
          <Route path="/missions/new" element={<NewMission />} />
          <Route path="/missions/:id" element={<MissionPage />} />
          <Route path="/library" element={<Library />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/videos/:id" element={<VideoPlayer />} />
          <Route path="/session/:id" element={<SessionPage />} />
          <Route path="/errors" element={<Errors />} />
          <Route path="/settings" element={<Settings status={status.data} />} />
          <Route path="*" element={<div className="page"><h1>Not found</h1></div>} />
        </Routes>
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
