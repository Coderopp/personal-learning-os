import type { Env } from './env'

/**
 * Commit a JSON file to the canonical repo. Approval in the app is the human gate, so this writes directly
 * to the branch instead of opening a PR. Returns null when no token is configured (local dev).
 */
export async function commitJson(env: Env, path: string, value: unknown, message: string): Promise<string | null> {
  if (!env.GITHUB_TOKEN) return null
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'personal-learning-os',
    'content-type': 'application/json',
  }
  const existing = await fetch(`${api}?ref=${env.GITHUB_BRANCH}`, { headers })
  const sha = existing.ok ? (await existing.json<{ sha: string }>()).sha : undefined
  const content = btoa(String.fromCharCode(...new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)))
  const res = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content, branch: env.GITHUB_BRANCH, ...(sha ? { sha } : {}) }),
  })
  if (!res.ok) {
    console.error('github commit failed', res.status, await res.text())
    return null
  }
  return (await res.json<{ commit: { sha: string } }>()).commit.sha
}
