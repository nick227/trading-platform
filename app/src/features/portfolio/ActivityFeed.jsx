export default function ActivityFeed({ activities }) {
  if (activities.length === 0) {
    return <div className="muted" style={{ textAlign: 'center', padding: '2rem' }}>No recent activity.</div>
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {activities.map((activity, index) => (
        <ActivityItem key={index} activity={activity} />
      ))}
    </div>
  )
}

function ActivityItem({ activity }) {
  const isBuy = activity.type === 'buy'
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '1rem', background: '#f8f9fa', borderRadius: '8px' }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: '50%',
        background: isBuy ? '#e8f5e8' : '#ffeaea',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginRight: '1rem', flexShrink: 0
      }}>
        <span style={{ fontSize: '14px', fontWeight: 600 }}>{isBuy ? 'B' : 'S'}</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '14px' }}>{activity.event}</div>
        <div className="muted" style={{ fontSize: '12px' }}>{activity.time}</div>
      </div>
      <div style={{ fontWeight: 700, fontSize: '16px', color: isBuy ? '#0a7a47' : '#c0392b' }}>
        {activity.value}
      </div>
    </div>
  )
}
