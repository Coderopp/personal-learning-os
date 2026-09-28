import { useState } from 'react'
import { api, useAction } from '../lib/api'
import { ErrorBanner } from './ui'
import { Md } from './Md'

export function AskTutor({ competencyId }: { competencyId: string }) {
  const [message, setMessage] = useState('')
  const [thread, setThread] = useState<{ q: string; a: string }[]>([])
  const action = useAction()
  const ask = () => action.run(async () => {
    const q = message
    const r = await api<{ markdown: string }>('/tutor', { body: { task: 'ask', competency_id: competencyId, message: q } })
    setThread(t => [...t, { q, a: r.markdown }])
    setMessage('')
  })
  return (
    <div className="chat">
      {thread.map((t, i) => (
        <div key={i} className="chat-turn">
          <p className="chat-q">{t.q}</p>
          <Md>{t.a}</Md>
        </div>
      ))}
      <ErrorBanner error={action.error} />
      <div className="chat-input">
        <textarea rows={2} value={message} onChange={e => setMessage(e.target.value)} placeholder="Ask anything about this competency…"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && message.trim()) ask() }} />
        <button className="primary" disabled={!message.trim() || action.busy} onClick={ask}>{action.busy ? '…' : 'Ask'}</button>
      </div>
    </div>
  )
}
