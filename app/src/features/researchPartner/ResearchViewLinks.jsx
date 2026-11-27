export const RESEARCH_VIEWS = Object.freeze([
  { id: 'research', title: 'Investigate', description: 'Ask questions and review evidence' },
  { id: 'strategies', title: 'Strategies', description: 'Create, test, and review paper strategies' },
  { id: 'monitoring', title: 'Monitoring', description: 'Review new company evidence' },
  { id: 'theses', title: 'Hypotheses', description: 'Track conclusions over time' },
  { id: 'activity', title: 'Activity', description: 'See recorded research and paper actions' },
  { id: 'history', title: 'History', description: 'Return to previous investigations' }
])

/** Contextual destinations, not permanent tabs or additional application navigation. */
export default function ResearchViewLinks({ current, onSelect }) {
  return <nav className="rp-next-actions" aria-label="Explore research workspace">
    <p className="rp-next-actions__heading">Continue with</p>
    <div className="rp-next-actions__list">
      {RESEARCH_VIEWS.filter(view => view.id !== current).map(view =>
        <button type="button" className="rp-next-actions__item" key={view.id}
          onClick={() => onSelect(view.id)}>
          <span className="rp-next-actions__label">{view.title}</span>
          <span className="rp-next-actions__description">{view.description}</span>
          <span aria-hidden="true" className="rp-next-actions__arrow">→</span>
        </button>
      )}
    </div>
  </nav>
}
