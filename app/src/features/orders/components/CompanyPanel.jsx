export default function CompanyPanel({ selectedStock, bootstrapData, loading }) {
  if (!selectedStock) {
    return (
      <article className="card card-pad-md">
        <div className="panel-empty">Select a stock to view company information</div>
      </article>
    )
  }

  const company = bootstrapData?.company
  const stats = bootstrapData?.stats

  const formatDateOnly = (value) => {
    if (!value) return null
    const raw = String(value)
    // If the backend sends a YYYY-MM-DD string, format in UTC to avoid off-by-one local TZ shifts.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const d = new Date(`${raw}T00:00:00Z`)
      if (Number.isNaN(d.getTime())) return raw
      return d.toLocaleDateString(undefined, { timeZone: 'UTC' })
    }
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleDateString()
  }

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Company Information</h3>
      </div>

      {loading ? (
        <div className="panel-empty">Loading company data…</div>
      ) : (
        <div className="stack-md">
          {company && (
            <div className="stack-sm">
              <div className="text-sm font-600">{company.name || selectedStock.name}</div>
              {company.description && <div className="text-xs muted">{company.description}</div>}
            </div>
          )}

          <div className="stack-sm text-xs">
            {company?.sector && (
              <div className="kv">
                <span className="kv-key">Sector</span>
                <span>{company.sector}</span>
              </div>
            )}
            {company?.industry && (
              <div className="kv">
                <span className="kv-key">Industry</span>
                <span>{company.industry}</span>
              </div>
            )}
            {company?.employees && (
              <div className="kv">
                <span className="kv-key">Employees</span>
                <span>{company.employees.toLocaleString()}</span>
              </div>
            )}
            {company?.country && (
              <div className="kv">
                <span className="kv-key">Country</span>
                <span>{company.country}</span>
              </div>
            )}
            {company?.website && (
              <div className="kv">
                <span className="kv-key">Website</span>
                <a className="link" href={company.website} target="_blank" rel="noopener noreferrer">
                  Visit
                </a>
              </div>
            )}
            {stats?.ipoDate && (
              <div className="kv">
                <span className="kv-key">Data start</span>
                <span>{formatDateOnly(stats.ipoDate)}</span>
              </div>
            )}
            {stats?.yearsListed && (
              <div className="kv">
                <span className="kv-key">Years Listed</span>
                <span>{stats.yearsListed}</span>
              </div>
            )}
          </div>

          {stats && (
            <div className="subcard">
              <div className="text-xs font-600 muted mb-2">Market Valuation</div>
              <div className="stack-sm text-xs">
                {stats.marketCap && (
                  <div className="kv">
                    <span className="kv-key">Market Cap</span>
                    <span className="font-600">${(stats.marketCap / 1e9).toFixed(2)}B</span>
                  </div>
                )}
                {stats.ath && (
                  <div className="kv">
                    <span className="kv-key">All-Time High</span>
                    <span>${stats.ath.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
