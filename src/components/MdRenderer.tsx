import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Link } from 'react-router-dom'
import 'katex/dist/katex.min.css'

/** Model output often uses \( \) and \[ \] delimiters; remark-math expects $ and $$. */
const normalizeMath = (s: string) =>
  s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)

export default function MdRenderer({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        // In-app links (e.g. tutor citations like /videos/ID?t=724) stay in the app; everything else opens a new tab.
        a: ({ href = '', children: c, ...props }) => href.startsWith('/')
          ? <Link to={href}>{c}</Link>
          : <a {...props} href={href} target="_blank" rel="noreferrer">{c}</a>,
      }}
    >
      {normalizeMath(children)}
    </ReactMarkdown>
  )
}
