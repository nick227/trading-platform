import { useEffect, useId, useRef } from 'react'

/** Small focused dialog: bottom sheet on phones, centered panel on desktop. */
export default function Sheet({ title, onClose, children, footer }) {
  const titleId = useId()
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Runs once per open: focus moves in, Escape closes, focus returns on close.
  useEffect(() => {
    const previous = document.activeElement
    const first = panelRef.current?.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])')
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title" id={titleId}>{title}</h2>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}
