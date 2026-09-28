import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'draft:'

/**
 * Text state that survives a closed tab, a reload or a dropped connection. Per-device only (localStorage),
 * which is fine for drafts; anything submitted lives in D1.
 */
export function useDraft(key: string | null, initial = '') {
  const [value, setValue] = useState(() => {
    if (!key) return initial
    try { return localStorage.getItem(PREFIX + key) ?? initial } catch { return initial }
  })
  useEffect(() => {
    if (!key) return
    try {
      if (value) localStorage.setItem(PREFIX + key, value)
      else localStorage.removeItem(PREFIX + key)
    } catch { /* storage unavailable: drafts just aren't kept */ }
  }, [key, value])
  const clear = useCallback(() => {
    setValue('')
    if (key) try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ }
  }, [key])
  return [value, setValue, clear] as const
}
