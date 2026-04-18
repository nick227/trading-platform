export function StatCard({ label, value, note }) {
  return (
    <article className="stat-card">
      <span className="eyebrow">{label}</span>
      <h3 className="stat-value">{value}</h3>
      {note ? <p className="muted">{note}</p> : null}
    </article>
  )
}
