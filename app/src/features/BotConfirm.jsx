import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppProvider'

export default function BotConfirm() {
  const navigate = useNavigate()
  const { state } = useApp()
  const bot = state.bots.find((item) => item.id === state.selectedBotId)

  return (
    <div className="page container">
      <h1 className="hero">Bot Confirmation</h1>
      <p className="muted">Review + execute</p>

      <div className="card section">
        <strong>{bot.name}</strong>
        <div className="muted">Asset: {bot.asset}</div>
      </div>

      <div className="actions">
        <button className="pressable" onClick={() => navigate('/bots')}>
          Execute Bot
        </button>
        <button className="pressable ghost" onClick={() => navigate('/bots')}>
          Back
        </button>
      </div>
    </div>
  )
}
