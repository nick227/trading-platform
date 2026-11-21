import { STATUS_LABELS } from '../api/services/botDashboardService'

/** Running | Paused | Stopped | Error status chip. */
export default function BotStatusPill({ status }) {
  return (
    <span className={`pill bot-status bot-status--${status}`} data-testid="bot-status">
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}
