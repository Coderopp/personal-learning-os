import type { Env } from './env'

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item'

export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

export const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)

export async function all<T = Record<string, unknown>>(env: Env, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await env.DB.prepare(sql).bind(...params).all<T>()
  return results
}

export async function first<T = Record<string, unknown>>(env: Env, sql: string, ...params: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql).bind(...params).first<T>()
}

export async function run(env: Env, sql: string, ...params: unknown[]) {
  return env.DB.prepare(sql).bind(...params).run()
}

/** Parse the JSON columns listed in `keys` on each row. */
export function parseJson<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out: Record<string, unknown> = { ...row }
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string') {
      try { out[k as string] = JSON.parse(v) } catch { /* leave as string */ }
    }
  }
  return out as T
}
