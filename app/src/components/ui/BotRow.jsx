import { Button } from './Button'

export function BotRow({ bot, onToggle }) {
  return (
    <article className="bot-row">
      <div>
        <div className="asset-symbol">{bot.name}</div>
        <div className="muted">{bot.asset} · {bot.status}</div>
      </div>

      <div className="bot-side">
        <strong>{bot.pnl}</strong>
        <Button variant={bot.enabled ? 'ghost' : 'primary'} onClick={() => onToggle(bot.id)}>
          {bot.enabled ? 'Pause' : 'Resume'}
        </Button>
      </div>
    </article>
  )
}
