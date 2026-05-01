export default function SectionHeader({ title, right }) {
  return (
    <div className="l-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      {right ? <span className="muted" style={{ fontSize: 12 }}>{right}</span> : <span />}
    </div>
  )
}
