import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Spinner } from './ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Continuous-scroll PDF reader (pdf.js). Pages render lazily as they approach the viewport.
 * Reports the furthest page seen, and hands back the first pages' text for check questions.
 */
export default function PdfViewer({ src, onProgress, onText }: { src: string; onProgress: (p: number) => void; onText: (t: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maxPage, setMaxPage] = useState(1)

  useEffect(() => {
    let alive = true
    const task = pdfjs.getDocument({ url: src, withCredentials: true })
    task.promise.then(async d => {
      if (!alive) return
      setDoc(d)
      // Text of the first pages (enough for questions), extracted in the browser: no server cost.
      let text = ''
      for (let i = 1; i <= Math.min(d.numPages, 8) && text.length < 12_000; i++) {
        const tc = await (await d.getPage(i)).getTextContent()
        text += tc.items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n'
      }
      if (alive) onText(text)
    }).catch(e => alive && setError((e as Error).message))
    return () => { alive = false; task.destroy() }
  }, [src]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc || !wrap.current) return
    const rendered = new Set<number>()
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const n = Number((e.target as HTMLElement).dataset.page)
        setMaxPage(m => { const v = Math.max(m, n); onProgress(v / doc.numPages); return v })
        if (rendered.has(n)) continue
        rendered.add(n)
        doc.getPage(n).then(page => {
          const canvas = e.target.querySelector('canvas')!
          const width = (e.target as HTMLElement).clientWidth
          const base = page.getViewport({ scale: 1 })
          const scale = (width / base.width) * (window.devicePixelRatio || 1)
          const vp = page.getViewport({ scale })
          canvas.width = vp.width
          canvas.height = vp.height
          canvas.style.width = '100%'
          page.render({ canvas, viewport: vp })
        })
      }
    }, { rootMargin: '600px 0px' })
    wrap.current.querySelectorAll('.pdf-page').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="banner bad">Couldn't open this PDF: {error}</p>
  if (!doc) return <Spinner label="Loading PDF…" />
  return (
    <div className="pdf-viewer" ref={wrap}>
      <div className="pdf-status muted">page {maxPage} of {doc.numPages}</div>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <div key={i} className="pdf-page" data-page={i + 1} style={{ aspectRatio: '8.5 / 11' }}><canvas /></div>
      ))}
    </div>
  )
}
