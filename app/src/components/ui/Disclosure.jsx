import { useId, useState } from 'react'

/** The canonical chevron used by every expandable element (rows, details, starting points). */
export function Chevron({ open = false }) {
  return (
    <svg
      className={`tl-chevron ${open ? 'is-open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  )
}

/**
 * Inline disclosure primitive (progressive disclosure): reveals supporting detail in place,
 * never repeats the visible summary, and loads its content only when first opened.
 * One per row — never nest disclosures.
 */
export default function Disclosure({
  label,
  meta = null,
  children,
  onOpen,
  defaultOpen = false,
  testId,
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [opened, setOpened] = useState(defaultOpen)
  const id = useId()
  const toggle = () => {
    if (!open && !opened) {
      setOpened(true)
      onOpen?.()
    }
    setOpen(!open)
  }
  return (
    <div className={`tl-disc ${className}`.trim()} data-testid={testId}>
      <button
        type="button"
        className="tl-disc-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        <Chevron open={open} />
        <span>{label}</span>
        {meta && <span className="tl-disc-meta">{meta}</span>}
      </button>
      {open && (
        <div id={id} className="tl-disc-body">
          {children}
        </div>
      )}
    </div>
  )
}
