export default function ActivityFeed({ activities }) {
  if (activities.length === 0) {
    return <div className="muted text-center p-6">No recent activity.</div>
  }

  return (
    <div className="data-rows">
      {activities.map((activity, index) => (
        <ActivityItem key={activity?.id ?? index} activity={activity} />
      ))}
    </div>
  )
}

function ActivityItem({ activity }) {
  const isBuy = activity.type === 'buy'
  const isFailed = activity.type === 'failed'
  const isCancelled = activity.type === 'cancelled'

  const toneClass = isFailed ? 'text-negative' : isCancelled ? 'text-accent' : ''
  const valueToneClass = isFailed ? 'text-negative' : isCancelled ? 'text-accent' : isBuy ? 'text-positive' : ''
  const cardToneClass = isFailed ? 'card-tint-negative' : isCancelled ? 'card-tint-accent' : ''
  const bubbleToneClass = isFailed
    ? 'icon-bubble-negative'
    : isCancelled
      ? 'icon-bubble-accent'
      : isBuy
        ? 'icon-bubble-positive'
        : 'icon-bubble-soft'

  const badge = isFailed ? '!' : isCancelled ? '—' : (isBuy ? 'B' : 'S')

  return (
    <div className={`subcard ${cardToneClass}`}>
      <div className="l-row">
        <div className="hstack flex-1">
          <div className={`icon-bubble ${bubbleToneClass}`}>
            <span className={`text-sm font-700 ${toneClass}`}>{badge}</span>
          </div>

          <div className="stack-sm flex-1">
            <div className={`text-sm font-600 ${toneClass}`}>{activity.event}</div>
            <div className="muted text-xs">
              {activity.time}
              {(isFailed || isCancelled) && activity.quantity && activity.price && (
                <span>{` • ${activity.quantity} @ $${activity.price.toFixed(2)}`}</span>
              )}
            </div>
          </div>
        </div>

        <div className={`text-right font-700 ${valueToneClass}`}>
          {(isFailed || isCancelled) ? (
            <div className="text-xs font-600">{activity.value}</div>
          ) : (
            activity.value
          )}
        </div>
      </div>
    </div>
  )
}
