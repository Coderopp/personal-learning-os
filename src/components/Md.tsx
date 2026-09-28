import { lazy, Suspense } from 'react'

// Markdown + KaTeX is the heaviest part of the bundle; load it on first use so the first screen is fast on the tablet.
const MdRenderer = lazy(() => import('./MdRenderer'))

export function Md({ children, inline }: { children: string; inline?: boolean }) {
  return (
    <div className={inline ? 'md md-inline' : 'md'}>
      <Suspense fallback={<p className="md-fallback">{children}</p>}>
        <MdRenderer>{children}</MdRenderer>
      </Suspense>
    </div>
  )
}
