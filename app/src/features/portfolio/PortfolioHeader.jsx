export default function PortfolioHeader({ user, stats, onRefresh }) {
  const totalReturn = stats?.totalReturn ?? 0
  const totalReturnPct = stats?.totalReturnPct ?? 0
  const positive = totalReturn >= 0

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '1.5rem',
      background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
      borderRadius: '16px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img
          src={user.avatar}
          alt="User Avatar"
          style={{
            width: '64px', height: '64px', borderRadius: '50%',
            marginRight: '1rem', border: '3px solid white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        />
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>Welcome back</div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#111' }}>{user.name}</h2>
          <div className="muted" style={{ fontSize: '14px', marginBottom: '0.5rem' }}>
            {positive ? 'Portfolio performing well today' : 'Market taking a breather'}
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div>
              <span className="muted" style={{ fontSize: '12px' }}>Portfolio Value: </span>
              <span style={{ fontSize: '16px', fontWeight: 600 }}>
                ${stats?.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}
              </span>
            </div>
            <div>
              <span className="muted" style={{ fontSize: '12px' }}>Total Return: </span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: positive ? '#0a7a47' : '#c0392b' }}>
                {positive ? '+' : ''}${totalReturn.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({positive ? '+' : ''}{totalReturnPct.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <div className="muted" style={{ fontSize: '12px', marginBottom: '0.25rem' }}>Last Updated</div>
        <div style={{ fontSize: '16px', fontWeight: 600 }}>
          {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <button className="ghost pressable" style={{ fontSize: '12px', marginTop: '0.5rem' }} onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </div>
  )
}
