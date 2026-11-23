import { useId } from 'react'

/** One editable part of the algorithm. Collapsing never discards draft values. */
export default function AlgorithmStep({ label, summary, detail, mark, open, onToggle, testId, quiet, children }) {
  const id = useId()
  return (
    <div className={`tl-algorithm-step${quiet ? ' tl-algorithm-step--name' : ''}`} data-testid={testId}>
      {mark && <span className="tl-algorithm-mark" aria-hidden="true">{mark}</span>}
      <button type="button" className="tl-algorithm-toggle" aria-label={`${open ? 'Close' : 'Edit'} ${label.toLowerCase()}`}
        aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="tl-algorithm-step-copy">
          {!quiet && <span className="tl-algorithm-step-label">{label}</span>}
          <span className="tl-algorithm-step-value">{summary}</span>
          {detail && <span className="tl-algorithm-step-detail">{detail}</span>}
        </span>
        <span className="tl-algorithm-edit">{open ? 'Done' : 'Edit'}</span>
      </button>
      <div id={id} hidden={!open} className="tl-algorithm-editor">{children}</div>
    </div>
  )
}
