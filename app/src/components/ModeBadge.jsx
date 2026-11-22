
/**
 * Derives trading mode from broker status ({ connected, paper, status }).
 * 'checking' and 'unknown' are neutral: never present "no account" before the
 * status is actually known. Live trading is disabled platform-wide.
 */
/** Internal historical-replay simulator: paper-like for every check, labelled distinctly. */
export function isSimulated(brokerStatus) {
  return brokerStatus?.simulated === true
}

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

function replayLabel(session) {
  const d = new Date(`${String(session).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? session : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function ModeBadge({ brokerStatus, loading = false, error = false }) {
  const mode = getTradingMode(brokerStatus, { loading, error })
  const simulated = mode === 'paper' && isSimulated(brokerStatus)
  const full = simulated ? `Simulated · ${replayLabel(brokerStatus.session)} replay` : LABELS[mode]
  const short = simulated ? 'Simulated' : SHORT_LABELS[mode]
  return (
    <span
      className={`mode-badge mode-badge--${mode}`}
      data-testid="mode-badge"
      data-mode={mode}
      title="Trading account status"
      role="status"
      aria-label={full}
      aria-busy={mode === 'checking' || undefined}
    >
      <span className="mode-badge-dot" aria-hidden="true" />
      <span className="mode-badge-full" aria-hidden="true">{full}</span>
      <span className="mode-badge-short" aria-hidden="true">{short}</span>
    </span>
  )
}
