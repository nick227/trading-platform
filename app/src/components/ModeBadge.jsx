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

// Shown instead of the full label on narrow screens.
const SHORT_LABELS = {
  paper: 'Paper',
  'live-disabled': 'Live: off',
  none: 'No account',
}

export default function ModeBadge({ brokerStatus }) {
  const mode = getTradingMode(brokerStatus)
  return (
    <Link
      to="/profile/broker"
      className={`mode-badge mode-badge--${mode}`}
      data-testid="mode-badge"
      title="Trading account status"
      aria-label={LABELS[mode]}
    >
      <span className="mode-badge-dot" aria-hidden="true" />
      <span className="mode-badge-full" aria-hidden="true">{LABELS[mode]}</span>
      <span className="mode-badge-short" aria-hidden="true">{SHORT_LABELS[mode]}</span>
    </Link>
  )
}
