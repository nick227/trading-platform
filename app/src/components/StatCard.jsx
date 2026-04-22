// Reusable stat card: icon bubble + label + big value + subtitle
export default function StatCard({
  icon,
  label,
  value,
  subtitle,
  iconTone = 'soft',
  valueTone,
  className = '',
}) {
  const iconToneClass =
    iconTone === 'positive'
      ? 'icon-bubble-positive'
      : iconTone === 'accent'
        ? 'icon-bubble-accent'
        : 'icon-bubble-soft'

  const valueToneClass =
    valueTone === 'positive'
      ? 'text-positive'
      : valueTone === 'negative'
        ? 'text-negative'
        : ''

  return (
    <article className={`card stat-card ${className}`.trim()}>
      <div className={`icon-bubble ${iconToneClass}`}>
        <span className="stat-card-icon">{icon}</span>
      </div>
      <div>
        <h3 className="stat-card-title">{label}</h3>
        <div className={`stat-card-value ${valueToneClass}`.trim()}>{value}</div>
        <div className="stat-card-subtitle">{subtitle}</div>
      </div>
    </article>
  )
}
