const EMPTY_STYLE = {
  background: 'white', borderRadius: '8px', padding: '1.5rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center', color: '#666',
}
const CARD_STYLE = {
  background: 'white', borderRadius: '8px', padding: '1rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'auto',
}
const ROW = { display: 'flex', justifyContent: 'space-between' }

export default function CompanyPanel({ selectedStock, bootstrapData, loading }) {
  if (!selectedStock) {
    return (
      <article style={EMPTY_STYLE}>
        <div style={{ fontSize: '14px' }}>Select a stock to view company information</div>
      </article>
    )
  }

  const company = bootstrapData?.company
  const stats   = bootstrapData?.stats

  return (
    <article style={CARD_STYLE}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '14px', fontWeight: 600 }}>Company Information</h3>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>Loading company data...</div>
      ) : (
        <div style={{ fontSize: '12px', lineHeight: '1.5' }}>
          {company && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                {company.name || selectedStock.name}
              </div>
              {company.description && (
                <div style={{ color: '#666', fontSize: '11px', lineHeight: '1.4' }}>
                  {company.description}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gap: '0.75rem', fontSize: '11px' }}>
            {company?.sector    && <div style={ROW}><span className="muted">Sector:</span>    <span>{company.sector}</span></div>}
            {company?.industry  && <div style={ROW}><span className="muted">Industry:</span>  <span>{company.industry}</span></div>}
            {company?.employees && <div style={ROW}><span className="muted">Employees:</span> <span>{company.employees.toLocaleString()}</span></div>}
            {company?.country   && <div style={ROW}><span className="muted">Country:</span>   <span>{company.country}</span></div>}
            {company?.website   && (
              <div style={ROW}>
                <span className="muted">Website:</span>
                <a href={company.website} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#0a7a47', textDecoration: 'none' }}>Visit</a>
              </div>
            )}
            {stats?.ipoDate     && <div style={ROW}><span className="muted">IPO Date:</span>     <span>{new Date(stats.ipoDate).toLocaleDateString()}</span></div>}
            {stats?.yearsListed && <div style={ROW}><span className="muted">Years Listed:</span> <span>{stats.yearsListed}</span></div>}
          </div>

          {stats && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px' }}>
              <div style={{ fontSize: '10px', color: '#666', marginBottom: '0.5rem' }}>Market Valuation</div>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {stats.marketCap && (
                  <div style={ROW}>
                    <span className="muted">Market Cap:</span>
                    <span style={{ fontWeight: 600 }}>${(stats.marketCap / 1e9).toFixed(2)}B</span>
                  </div>
                )}
                {stats.ath && (
                  <div style={ROW}>
                    <span className="muted">All-Time High:</span>
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
