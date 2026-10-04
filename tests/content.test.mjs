// Learning paths: feed parsing/discovery, paywall detection, article extraction, series + segment picking.
import { buildSync } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'los-'))
const root = process.cwd()
writeFileSync(join(dir, 'entry.ts'), [
  `export { parseFeed, feedCandidates, platformOf } from '${root}/server/feeds'`,
  `export { looksPaywalled, extractArticle, countWords } from '${root}/server/content'`,
  `export { looksLikeEpisode, pickSegment } from '${root}/server/youtube'`,
  `export { sourceOf } from '${root}/server/routes/paths'`,
].join('\n'))
buildSync({ entryPoints: [join(dir, 'entry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'out.mjs'), logLevel: 'error' })
const m = await import(join(dir, 'out.mjs'))

let failed = 0
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`) }

const rss = `<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title><![CDATA[Deep (Learning) Focus]]></title><link>https://cameronrwolfe.substack.com</link>
<item><title><![CDATA[Applying Statistics to LLM Evaluations]]></title><link>https://cameronrwolfe.substack.com/p/stats-llm-evals</link><pubDate>Mon, 09 Mar 2026 10:00:00 GMT</pubDate><dc:creator><![CDATA[Cameron R. Wolfe]]></dc:creator><description><![CDATA[<p>Evals &amp; stats</p>]]></description><content:encoded><![CDATA[<p>Full body</p>]]></content:encoded></item></channel></rss>`
const f = m.parseFeed(rss, 'https://cameronrwolfe.substack.com/feed')
eq('RSS: title', f.title, 'Deep (Learning) Focus')
eq('RSS: item', [f.items[0].title, f.items[0].url, f.items[0].published, f.items[0].author, f.items[0].summary], ['Applying Statistics to LLM Evaluations', 'https://cameronrwolfe.substack.com/p/stats-llm-evals', '2026-03-09', 'Cameron R. Wolfe', 'Evals & stats'])
eq('RSS: full content kept', f.items[0].content, '<p>Full body</p>')
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Eugene Yan</title><link href="https://eugeneyan.com/" rel="alternate"/><entry><title>Product Evals in Three Simple Steps</title><link href="https://eugeneyan.com/writing/product-evals/" rel="alternate"/><updated>2026-08-01T00:00:00Z</updated><summary>How to</summary></entry></feed>`
const a = m.parseFeed(atom, 'https://eugeneyan.com/feed.xml')
eq('Atom: entry', [a.title, a.items[0].url, a.items[0].published], ['Eugene Yan', 'https://eugeneyan.com/writing/product-evals/', '2026-08-01'])
eq('not a feed → null', m.parseFeed('<html><body>hi</body></html>', 'https://x.com'), null)
eq('Medium @user feed first', m.feedCandidates('https://medium.com/@karpathy')[0], 'https://medium.com/feed/@karpathy')
eq('advertised feed link wins', m.feedCandidates('https://www.thesignal.club/', '<link rel="alternate" type="application/rss+xml" href="/feed" title="x">')[0], 'https://www.thesignal.club/feed')
eq('platform: substack', m.platformOf('https://x.substack.com/p/y'), 'substack')
eq('platform: medium subdomain', m.platformOf('https://s09g.medium.com/post'), 'medium')
eq('source: arXiv', m.sourceOf('https://arxiv.org/abs/2309.06180'), 'arxiv')
eq('source: docs', m.sourceOf('https://docs.vllm.ai/en/latest/'), 'web')

eq('paywall: short + paid wording', m.looksPaywalled('This post is for paid subscribers. Upgrade to read.', 9), true)
eq('paywall: long free post mentioning subscribe', m.looksPaywalled('subscribe to keep reading '.repeat(1) + 'word '.repeat(2000), 2004), false)
const page = `<html><body><nav>menu</nav><article><h2>Intro</h2><p>${'Attention lets a model weigh tokens. '.repeat(60)}</p><script>alert(1)</script></article></body></html>`
const art = m.extractArticle(page)
eq('article extracted', Boolean(art && art.includes('<h2>Intro</h2>')), true)
eq('scripts stripped', art.includes('<script'), false)
const chrome = m.extractArticle(`<article><header><a href="/">eugeneyan</a></header><nav><a href="/writing">Writing</a></nav><p>${'Evals need graders. '.repeat(80)}</p><img src="/assets/fig.png"></article>`, 'https://eugeneyan.com/writing/x/')
eq('site header/nav removed', /eugeneyan<|Writing</.test(chrome), false)
eq('relative image made absolute', chrome.includes('src="https://eugeneyan.com/assets/fig.png"'), true)

eq('episode: "Lecture 5 | MIT 6.832"', m.looksLikeEpisode('Lecture 5 | MIT 6.832 (Underactuated Robotics)'), true)
eq('episode: "Deep Learning Chapter 5"', m.looksLikeEpisode('Transformers, the tech behind LLMs | Deep Learning Chapter 5'), true)
eq('not an episode', m.looksLikeEpisode('The KV Cache: Memory Usage in Transformers'), false)
const lines = Array.from({ length: 60 * 40 / 10 }, (_, i) => ({ t: i * 10, text: i * 10 >= 1500 && i * 10 < 1900 ? 'the kv cache stores keys and values' : 'unrelated talk about history' }))
const seg = m.pickSegment(lines, ['KV cache'], 10)
eq('segment lands on the KV-cache part (25:00–31:40)', seg.start >= 1200 && seg.start <= 1500 && seg.end >= 1800, true)
eq('no matching words → null', m.pickSegment(lines, ['quaternions'], 10), null)
process.exit(failed ? 1 : 0)
