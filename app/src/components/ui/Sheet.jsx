import { useEffect, useId, useRef } from 'react'

/**
 * Canonical Sheet / Dialog primitive:
 * Responsive: Bottom sheet on mobile, centered modal panel on desktop.
 * Accessible: role="dialog", aria-modal="true", aria-labelledby, focus trap on open,
 * Escape to close, returns focus to previous element on unmount.
 */
export default function Sheet({
  title,
  onClose,
  children,
  footer,
  size,
  className = '',
  closeAriaLabel = 'Close dialog',
}) {
  const titleId = useId()
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus management: focus first interactive element on open, return focus on close.
  useEffect(() => {
    const previous = document.activeElement
    const interactive = panelRef.current?.querySelectorAll(
      'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (interactive && interactive.length > 0) {
      interactive[0].focus()
    } else {
      panelRef.current?.focus()
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
      } else if (e.key === 'Tab' && panelRef.current) {
        // Simple focus wrap within modal
        const focusable = panelRef.current.querySelectorAll(
          'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length > 0) {
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="sheet-backdrop" onClick={onClose} data-testid="sheet-backdrop">
      <div
        className={`sheet ${size === 'wide' ? 'sheet--wide' : ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid="sheet-panel"
      >
        <div className="sheet-head">
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={closeAriaLabel}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}
