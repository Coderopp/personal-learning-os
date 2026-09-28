import type { ReactNode } from 'react'

export function Card({ title, subtitle, actions, children, className = '' }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>{title && <h2>{title}</h2>}{subtitle && <p className="muted">{subtitle}</p>}</div>
          {actions && <div className="row-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export const Chip = ({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'info' }) =>
  <span className={`chip ${tone ?? ''}`}>{children}</span>

export const Spinner = ({ label }: { label?: string }) =>
  <div className="spinner-row"><span className="spinner" />{label && <span className="muted">{label}</span>}</div>

export const ErrorBanner = ({ error, onRetry }: { error: string | null | undefined; onRetry?: () => void }) =>
  error ? <div className="banner bad" role="alert">{error}{onRetry && <button className="link" onClick={onRetry}>Retry</button>}</div> : null

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>

export function Metric({ label, value, note, dim }: { label: string; value: ReactNode; note?: ReactNode; dim?: boolean }) {
  return (
    <div className={`metric ${dim ? 'dim' : ''}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

export const Score = ({ value }: { value: number | null }) =>
  <span className={`score ${value == null ? 'none' : value >= 80 ? 'good' : value >= 60 ? 'mid' : 'low'}`}>
    {value == null ? '–' : Math.round(value)}
  </span>

export const verdictTone = (v: string) => (v === 'correct' ? 'good' : v === 'partial' ? 'warn' : 'bad') as 'good' | 'warn' | 'bad'
