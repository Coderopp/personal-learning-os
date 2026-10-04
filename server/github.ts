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

export interface RepoInfo {
  repo: string; description: string | null; stars: number; branch: string
  readme: string | null; notebooks: { path: string; colab: string }[]; code_files: string[]
}

/** What a repo offers a learner: README, notebooks (with Colab links) and a few source files to read. */
export async function repoInfo(env: Env, fullName: string): Promise<RepoInfo | null> {
  const headers = { 'user-agent': 'personal-learning-os', accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) }
  const meta = await fetch(`https://api.github.com/repos/${fullName}`, { headers })
  if (!meta.ok) return null
  const m = await meta.json<{ full_name: string; description: string | null; stargazers_count: number; default_branch: string }>()
  const [tree, readme] = await Promise.all([
    fetch(`https://api.github.com/repos/${fullName}/git/trees/${m.default_branch}?recursive=1`, { headers }).then(r => r.ok ? r.json<{ tree: { path: string; type: string }[] }>() : { tree: [] }),
    fetch(`https://api.github.com/repos/${fullName}/readme`, { headers: { ...headers, accept: 'application/vnd.github.raw' } }).then(r => r.ok ? r.text() : null),
  ])
  const files = tree.tree.filter(t => t.type === 'blob').map(t => t.path)
  return {
    repo: m.full_name, description: m.description, stars: m.stargazers_count, branch: m.default_branch,
    readme: readme ? readme.slice(0, 60_000) : null,
    notebooks: files.filter(f => f.endsWith('.ipynb')).slice(0, 20)
      .map(path => ({ path, colab: `https://colab.research.google.com/github/${m.full_name}/blob/${m.default_branch}/${path}` })),
    code_files: files.filter(f => /\.(py|ts|js|go|rs|cpp|c|java)$/.test(f) && !/test|spec|__init__|setup\.py/.test(f)).slice(0, 40),
  }
}

export async function repoFile(env: Env, fullName: string, branch: string, path: string) {
  const res = await fetch(`https://raw.githubusercontent.com/${fullName}/${branch}/${path}`, { headers: { 'user-agent': 'personal-learning-os' } })
  return res.ok ? (await res.text()).slice(0, 40_000) : null
}
