import { Link } from 'react-router-dom'

/**
 * Derives trading mode from broker status ({ connected, paper, status }).
 * Live trading is disabled platform-wide, so a live account is shown as such.
 */
export function getTradingMode(brokerStatus) {
  if (!brokerStatus?.connected) return 'none'
  return brokerStatus.paper === false ? 'live-disabled' : 'paper'
}

const LABELS = {
  paper: 'Paper trading',
  'live-disabled': 'Live account — trading disabled',
  none: 'No account connected',
}

export default function ModeBadge({ brokerStatus }) {
  const mode = getTradingMode(brokerStatus)
  return (
    <Link
      to="/profile/broker"
      className={`mode-badge mode-badge--${mode}`}
      data-testid="mode-badge"
      title="Trading account status"
    >
      <span className="mode-badge-dot" aria-hidden="true" />
      {LABELS[mode]}
    </Link>
  )
}
