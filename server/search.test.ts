import test from 'node:test'
import assert from 'node:assert/strict'

import { gather } from './search.ts'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('gather filters out low-star GitHub repositories', async (t) => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = String(input)

    if (url.startsWith('https://export.arxiv.org/api/query')) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
         <feed>
           <entry>
             <title>  ArXiv Entry  </title>
             <id>http://arxiv.org/abs/1234.5678</id>
             <summary>Summary text</summary>
             <author><name>Author A</name></author>
           </entry>
         </feed>`,
        { status: 200, headers: { 'content-type': 'application/xml' } },
      )
    }

    if (url.startsWith('https://api.github.com/search/repositories')) {
      assert.equal(init?.headers && typeof init.headers === 'object', true)
      return jsonResponse({
        items: [
          {
            full_name: 'example/low-stars',
            html_url: 'https://github.com/example/low-stars',
            description: 'Too small',
            stargazers_count: 42,
          },
          {
            full_name: 'example/high-stars',
            html_url: 'https://github.com/example/high-stars',
            description: 'Popular enough',
            stargazers_count: 500,
          },
        ],
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const hits = await gather({} as any, ['llm curriculum'], '')

  const githubHits = hits.filter((h) => h.source === 'github')
  assert.equal(githubHits.length, 1)
  assert.equal(githubHits[0]?.title, 'example/high-stars')
  assert.ok(hits.some((h) => h.source === 'arxiv'))
})

test('gather deduplicates repeated YouTube video IDs', async (t) => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: FetchInput) => {
    const url = String(input)

    if (url === 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false') {
      return jsonResponse({
        contents: [
          {
            videoRenderer: {
              videoId: 'abc123def45',
              title: { runs: [{ text: 'Video One' }] },
              lengthText: { simpleText: '12:34' },
            },
          },
          {
            videoRenderer: {
              videoId: 'abc123def45',
              title: { runs: [{ text: 'Video One Duplicate' }] },
              lengthText: { simpleText: '12:34' },
            },
          },
          {
            videoRenderer: {
              videoId: 'zzz999yyy88',
              title: { runs: [{ text: 'Video Two' }] },
              lengthText: { simpleText: '08:00' },
            },
          },
        ],
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const hits = await gather({} as any, [], 'edge case query', 'video')

  assert.equal(hits.length, 2)
  assert.deepEqual(
    hits.map((h) => h.url),
    [
      'https://www.youtube.com/watch?v=abc123def45',
      'https://www.youtube.com/watch?v=zzz999yyy88',
    ],
  )
})
