export function LineChart({ points, compact = false }) {
  const width = 720
  const height = compact ? 72 : 220
  const maxY = Math.max(...points.map((p) => p.y))
  const minY = Math.min(...points.map((p) => p.y))
  const range = Math.max(maxY - minY, 1)

  const normalized = points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * width
    const y = height - ((point.y - minY) / range) * (height - 16) - 8
    return `${x},${y}`
  }).join(' ')

  return (
    <div className={`chart-shell ${compact ? 'is-compact' : ''}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" preserveAspectRatio="none">
        <polyline points={normalized} className="chart-line" />
      </svg>
      {!compact ? (
        <div className="chart-labels">
          {points.map((point) => <span key={point.x}>{point.x}</span>)}
        </div>
      ) : null}
    </div>
  )
}
