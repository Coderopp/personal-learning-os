import { useCallback, useEffect, useState } from 'react'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'include',
    })
  } catch {
    throw new ApiError('You appear to be offline.', 0)
  }
  // Cloudflare Access redirects to its login page when the session expires.
  if (res.redirected || res.headers.get('content-type')?.includes('text/html')) {
    window.location.reload()
    throw new ApiError('Session expired, signing in again…', 401)
  }
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

/** GET with loading/error state and a reload function. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let alive = true
    setLoading(true)
    api<T>(path)
      .then(d => { if (alive) { setData(d); setError(null) } })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [path, tick])

  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, error, loading, reload, setData }
}

/** Wrap an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try { return await fn() } catch (e) { setError((e as Error).message); return undefined } finally { setBusy(false) }
  }, [])
  return { busy, error, run, setError }
}

export const enc = (id: string) => id.split('/').map(encodeURIComponent).join('/')
