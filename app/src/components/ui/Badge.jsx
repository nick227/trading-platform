/**
 * Canonical Badge & Status primitives for TradeLoom:
 * Provides semantic status indicators, tags, and notices.
 */

/** Status indicator with animated or static colored dot */
export function StatusBadge({ status, label, className = '', testId = 'status-badge' }) {
  const norm = String(status || '').toLowerCase()
  return (
    <span className={`tl-status tl-status--${norm} ${className}`.trim()} data-testid={testId}>
      {label || status}
    </span>
  )
}

/** Small metadata tag / pill */
export function Tag({ variant = 'neutral', children, className = '' }) {
  const variantClass = variant === 'sim' ? 'tl-tag--sim' : variant === 'warn' ? 'tl-tag--warn' : ''
  return (
    <span className={`tl-tag ${variantClass} ${className}`.trim()}>
      {children}
    </span>
  )
}

/** Inline callout / notice container */
export function Notice({ tone = 'info', children, className = '', role, ...rest }) {
  const noticeRole = role || (tone === 'error' ? 'alert' : 'status')
  const toneClass = tone === 'error' ? 'tl-notice--error' : tone === 'warn' ? 'tl-notice--warn' : ''
  return (
    <div className={`tl-notice ${toneClass} ${className}`.trim()} role={noticeRole} {...rest}>
      {children}
    </div>
  )
}

export default StatusBadge
