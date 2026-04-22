export default function PortfolioHeader({ user, stats, onRefresh }) {
  const totalReturn = stats?.totalReturn ?? 0
  const totalReturnPct = stats?.totalReturnPct ?? 0
  const positive = totalReturn >= 0

  const displayName = user?.fullName || user?.name || user?.email

  const totalValue = Number.isFinite(stats?.totalValue)
    ? `$${stats.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : '—'

  return (
    <div className="card card-hero">
      <div className="l-row">
        <div className="hstack">
          {user?.avatar && <img className="avatar avatar-64 avatar-ring" src={user.avatar} alt="User Avatar" />}

          <div className="stack-sm">
            <div className="eyebrow">Welcome back</div>
            <h2 className="m-0 text-lg font-700">{displayName ?? '—'}</h2>
            <div className="muted text-sm">
              {positive ? 'Portfolio performing well today' : 'Market taking a breather'}
            </div>

            <div className="meta-row">
              <span>
                <span className="muted text-xs">Portfolio Value: </span>
                <span className="font-600">{totalValue}</span>
              </span>
              <span>
                <span className="muted text-xs">Total Return: </span>
                <span className={`${positive ? 'text-positive' : 'text-negative'} font-600`}>
                  {positive ? '+' : ''}
                  {`$${totalReturn.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${positive ? '+' : ''}${totalReturnPct.toFixed(1)}%)`}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="muted text-xs mb-1">Last Updated</div>
          <div className="text-sm font-600">
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <button className="btn btn-xs btn-ghost mt-2" type="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}
