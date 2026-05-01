import ErrorState from './ErrorState'

export default function SectionState({
  loading,
  error,
  onRetry,
  skeleton = null,
  isRefreshing = false,
  children,
}) {
  if (loading) return skeleton
  if (error) {
    return (
      <ErrorState
        onRetry={onRetry}
        message={error?.message || 'Something went wrong'}
      />
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      {children}
      {isRefreshing ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255,255,255,0.35)',
            pointerEvents: 'none'
          }}
        />
      ) : null}
    </div>
  )
}
