import { useEffect, useRef } from 'react'
import { api } from './api'

// A playing video counts as focused time even when you're not touching the keyboard.
let mediaPlaying = false
export const setMediaPlaying = (playing: boolean) => { mediaPlaying = playing }

/** Which learning screen a path is, if any. Browsing Today, Analytics or settings isn't learning time. */
export function learningSource(path: string): 'session' | 'video' | 'benchmark' | 'mission' | 'reader' | 'project' | null {
  if (path.startsWith('/session/')) return 'session'
  if (/^\/videos\/[^/]+/.test(path)) return 'video'
  if (path.startsWith('/benchmark/')) return 'benchmark'
  if (path.startsWith('/unit/')) return 'reader'
  if (path.startsWith('/projects/')) return 'project'
  if (/^\/missions\/(?!new)[^/]+/.test(path)) return 'mission'
  return null
}

/**
 * One focused minute per minute on a learning screen, while the page is visible and you've interacted in the last
 * 3 minutes (or a video is playing). Feeds the heatmap, streaks and "focused this week".
 */
export function useActivityPing(path: string) {
  const last = useRef(Date.now())
  const source = learningSource(path)
  useEffect(() => {
    const mark = () => { last.current = Date.now() }
    const events = ['keydown', 'pointerdown', 'scroll', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, mark, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, mark))
  }, [])
  useEffect(() => {
    if (!source) return
    last.current = Date.now() // arriving on a learning screen counts as interaction
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && (Date.now() - last.current < 180_000 || mediaPlaying)) {
        api('/activity/ping', { body: { source } }).catch(() => {})
      }
    }, 60_000)
    return () => clearInterval(t)
  }, [source])
}
