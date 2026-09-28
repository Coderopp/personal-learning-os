import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

/** Model output often uses \( \) and \[ \] delimiters; remark-math expects $ and $$. */
const normalizeMath = (s: string) =>
  s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)

export function Md({ children, inline }: { children: string; inline?: boolean }) {
  return (
    <div className={inline ? 'md md-inline' : 'md'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  )
}
