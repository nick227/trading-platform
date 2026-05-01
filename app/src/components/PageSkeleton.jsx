export default function PageSkeleton() {
  return (
    <main className="stage" aria-busy="true" aria-live="polite">
      <div className="stage-inner">
        <div style={{ width: '100%' }}>
          <div className="skeleton-block skeleton-title" />
          <div className="skeleton-block skeleton-row" />
          <div className="skeleton-block skeleton-row" />
        </div>
      </div>
    </main>
  )
}
