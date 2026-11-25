import { useId } from 'react'
import Disclosure from '../../ui/Disclosure'

/** Shared information composition. No financial calculations or source transformations. */
export function PageIdentity({ title, description, tags, action, children }) {
  return (
    <header className="tl-content-identity">
      <div className="tl-content-identity__main">
        <h1 className="tl-title">{title}</h1>
        {description && <p className="tl-content-intro">{description}</p>}
        {tags && <div className="tl-content-tags" aria-label="Strategy attributes">{tags}</div>}
        {children}
      </div>
      {action && <div className="tl-content-identity__action">{action}</div>}
    </header>
  )
}

export function ContentSection({ title, description, action, children, className = '', testId }) {
  const id = useId()
  return (
    <section className={['tl-content-section', className].filter(Boolean).join(' ')} aria-labelledby={id} data-testid={testId}>
      <div className="tl-content-section__head">
        <div>
          <h2 className="tl-section-title" id={id}>{title}</h2>
          {description && <p className="tl-content-help">{description}</p>}
        </div>
        {action && <div className="tl-content-section__action">{action}</div>}
      </div>
      <div className="tl-content-section__body">{children}</div>
    </section>
  )
}

/** items: [{key,label,value,help?}], with already formatted, sourced values. */
export function FactGrid({ items, label, columns = 2 }) {
  const rows = (items ?? []).filter(row => row && row.value !== undefined && row.value !== null && row.value !== '')
  if (!rows.length) return null
  return (
    <dl className={`tl-content-facts tl-content-facts--${columns}`} aria-label={label}>
      {rows.map(row => (
        <div className="tl-content-fact" key={row.key ?? row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
          {row.help && <dd className="tl-content-fact__help">{row.help}</dd>}
        </div>
      ))}
    </dl>
  )
}

export function ContentState({ title, description, tone = 'neutral', children, testId }) {
  return (
    <div className={`tl-content-state tl-content-state--${tone}`} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {children}
    </div>
  )
}

export function TechnicalDetail({ label = 'Technical details', children, testId }) {
  if (!children) return null
  return <Disclosure label={label} testId={testId} className="tl-content-technical">{children}</Disclosure>
}
