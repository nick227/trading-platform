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
  const isFailed = activity.type === 'failed'
  const isCancelled = activity.type === 'cancelled'
  
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      padding: '1rem', 
      background: isFailed ? '#fff5f5' : isCancelled ? '#f0f6ff' : '#f8f9fa', 
      borderRadius: '8px',
      border: isFailed ? '1px solid #fed7d7' : isCancelled ? '1px solid #bee3f8' : 'none'
    }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: '50%',
        background: isFailed ? '#fee2e2' : isCancelled ? '#e6f3ff' : isBuy ? '#e8f5e8' : '#ffeaea',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginRight: '1rem', flexShrink: 0
      }}>
        <span style={{ 
          fontSize: '14px', 
          fontWeight: 600, 
          color: isFailed ? '#c0392b' : isCancelled ? '#2563eb' : 'inherit'
        }}>
          {isFailed ? '!' : isCancelled ? 'â\u20AC" ' : (isBuy ? 'B' : 'S')}
        </span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ 
          fontWeight: 600, 
          fontSize: '14px',
          color: isFailed ? '#c0392b' : isCancelled ? '#2563eb' : 'inherit'
        }}>
          {activity.event}
        </div>
        <div className="muted" style={{ fontSize: '12px' }}>
          {activity.time}
          {(isFailed || isCancelled) && activity.quantity && activity.price && (
            <span> â\u20AC¢ {activity.quantity} @ ${activity.price.toFixed(2)}</span>
          )}
        </div>
      </div>
      <div style={{ 
        fontWeight: 700, 
        fontSize: '16px', 
        color: isFailed ? '#c0392b' : isCancelled ? '#2563eb' : (isBuy ? '#0a7a47' : '#c0392b'),
        textAlign: 'right',
        maxWidth: '200px'
      }}>
        {(isFailed || isCancelled) ? (
          <div style={{ fontSize: '12px', lineHeight: '1.3' }}>
            {activity.value}
          </div>
        ) : (
          activity.value
        )}
      </div>
    </div>
  )
}
