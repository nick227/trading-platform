// Reusable stat card: icon bubble + label + big value + subtitle
export default function StatCard({ iconBg, icon, label, value, subtitle }) {
  return (
    <article className="card">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '50%',
          background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginRight: '1rem', flexShrink: 0
        }}>
          <span style={{ fontSize: '20px' }}>{icon}</span>
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{label}</h3>
          <div style={{ fontSize: '24px', fontWeight: 700 }}>{value}</div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: '12px' }}>{subtitle}</div>
    </article>
  )
}
