export function MetricPill({ label, value }) {
  return (
    <div className="metric-pill">
      <span className="metric-pill-label">{label}</span>
      <strong className="metric-pill-value">{value}</strong>
    </div>
  )
}
