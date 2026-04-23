export default function PortfolioHeader({ user, stats, onRefresh }) {
  const totalReturn = stats?.totalReturn ?? 0
  const totalReturnPct = stats?.totalReturnPct ?? 0
  const positive = totalReturn >= 0

  const displayName = user?.fullName || user?.name || user?.email

  return (
    <div className="card card-hero">
      <div className="container">

            <div className="meta-row row">
              <span>
                <span className="muted text-xs">Total Return: </span>
                <span className={`${positive ? 'text-positive' : 'text-negative'} font-600`}>
                  {positive ? '+' : ''}
                  {`$${totalReturn.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${positive ? '+' : ''}${totalReturnPct.toFixed(1)}%)`}
                </span>
              </span>
            </div>

        <div className="hstack">
          {user?.avatar && <img className="avatar avatar-64 avatar-ring" src={user.avatar} alt="User Avatar" />}

          <div className="stack-sm">
            <h2 className="m-0 text-xxxl font-700">Hello, {displayName ?? '—'}</h2>

          </div>
        </div>
      </div>
    </div>
  )
}
