import { useApp } from '../../app/AppProvider'

export default function BotsTab() {
  const { state } = useApp()

  return (
    <div className="list">
      {state.bots.map((bot) => (
        <div key={bot.id} className="row">
          <span>{bot.name}</span>
          <span className="muted">{bot.asset}</span>
          <button className="btn btn-ghost">
            {bot.enabled ? 'Pause' : 'Start'}
          </button>
        </div>
      ))}
    </div>
  )
}
