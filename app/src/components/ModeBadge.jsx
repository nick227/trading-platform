import { Link } from 'react-router-dom'

/**
 * Derives trading mode from broker status ({ connected, paper, status }).
 * 'checking' and 'unknown' are neutral: never present "no account" before the
 * status is actually known. Live trading is disabled platform-wide.
 */
export function getTradingMode(brokerStatus, { loading = false, error = false } = {}) {
  if (loading) return 'checking'
  if (error) return 'unknown'
  if (!brokerStatus?.connected) return 'none'
  return brokerStatus.paper === false ? 'live-disabled' : 'paper'
}

const LABELS = {
  paper: 'Paper trading',
  'live-disabled': 'Live account — trading disabled',
  none: 'No account connected',
  checking: 'Checking account…',
  unknown: 'Account status unavailable',
}

// Shown instead of the full label on narrow screens.
const SHORT_LABELS = {
  paper: 'Paper',
  'live-disabled': 'Live: off',
  none: 'No account',
  checking: 'Checking…',
  unknown: 'Status ?',
}

export default function ModeBadge({ brokerStatus, loading = false, error = false }) {
  const mode = getTradingMode(brokerStatus, { loading, error })
  return (
    <Link
      to="/profile/broker"
      className={`mode-badge mode-badge--${mode}`}
      data-testid="mode-badge"
      data-mode={mode}
      title="Trading account status"
      aria-label={LABELS[mode]}
      aria-busy={mode === 'checking' || undefined}
    >
      <span className="mode-badge-dot" aria-hidden="true" />
      <span className="mode-badge-full" aria-hidden="true">{LABELS[mode]}</span>
      <span className="mode-badge-short" aria-hidden="true">{SHORT_LABELS[mode]}</span>
    </Link>
  )
}
