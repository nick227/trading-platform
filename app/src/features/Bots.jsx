import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppProvider'

const botPlaybooks = [
  { name: 'Momentum Swing', cadence: 'Intraday', edge: '+2.1%' },
  { name: 'Regime Rotation', cadence: 'Daily', edge: '+1.6%' },
  { name: 'DCA Engine', cadence: 'Weekly', edge: '+0.9%' }
]

export default function Bots() {
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const runningCount = state.bots.filter((bot) => bot.status === 'running').length

  return (
    <div className="page container" style={{ maxWidth: 1040, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 className="hero" style={{ marginBottom: '0.5rem' }}>Bots</h1>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ color: '#0a7a47', fontWeight: 700 }}>{runningCount} running</div>
          <div className="muted">{state.bots.length - runningCount} paused</div>
          <div className="muted">Execution health normal</div>
        </div>
      </header>

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1.4fr 1fr', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Active Bot Queue</strong>
          <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.7rem' }}>
            {state.bots.map((bot) => (
              <div key={bot.id} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <div>
                    <strong>{bot.name}</strong>
                    <div className="muted">Asset: {bot.asset}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: bot.status === 'running' ? '#0a7a47' : '#aa7a00', fontWeight: 600 }}>{bot.status}</div>
                    <button
                      className="primary pressable"
                      onClick={() => {
                        dispatch({ type: 'SELECT_BOT', payload: bot.id })
                        navigate('/bots/confirm')
                      }}
                    >
                      Review
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article style={{ background: 'linear-gradient(140deg, #111, #2a2a2a)', color: '#fff', borderRadius: 24, padding: '1rem' }}>
          <div className="eyebrow" style={{ color: '#d9d9d9' }}>Bot Performance</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700 }}>+6.8% this month</div>
          <div style={{ marginTop: '0.45rem', opacity: 0.88 }}>Win rate: 64%</div>
          <div style={{ opacity: 0.88 }}>Avg hold: 1.8 sessions</div>
          <div style={{ marginTop: '0.7rem', color: '#6effb6', fontWeight: 700 }}>Best actor: Momentum Swing</div>
        </article>
      </section>

      <section style={{ background: 'white', borderRadius: 22, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
        <strong>Top Playbooks</strong>
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.55rem' }}>
          {botPlaybooks.map((playbook) => (
            <div key={playbook.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', borderBottom: '1px solid #eee', paddingBottom: '0.45rem' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{playbook.name}</div>
                <div className="muted">Cadence: {playbook.cadence}</div>
              </div>
              <div style={{ color: '#0a7a47', fontWeight: 700 }}>{playbook.edge}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
