import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import alphaEngineService from '../../api/services/alphaEngineService.js'
import { VerdictBadge } from '../../components/ConfidenceBadge.jsx'

export default function HoldingsTable({ holdings }) {
  const navigate = useNavigate()
  const [sortConfig, setSortConfig] = useState({ key: 'marketValue', direction: 'desc' })
  const [verdicts, setVerdicts] = useState({})
  const [loadingVerdicts, setLoadingVerdicts] = useState(false)

  useEffect(() => {
    if (holdings.length === 0) return

    const loadVerdicts = async () => {
      setLoadingVerdicts(true)
      try {
        const tickers = holdings.map((h) => h.ticker)
        const batchData = await alphaEngineService.getBatchRecommendations(tickers, 'balanced')

        const verdictMap = {}
        if (batchData.recommendations && Array.isArray(batchData.recommendations)) {
          batchData.recommendations.forEach((rec) => {
            verdictMap[rec.ticker] = rec
          })
        }

        holdings.forEach((holding) => {
          if (!(holding.ticker in verdictMap)) verdictMap[holding.ticker] = null
        })

        setVerdicts(verdictMap)
      } catch (error) {
        console.error('Failed to load batch verdicts:', error)

        const verdictPromises = holdings.map(async (holding) => {
          try {
            const verdict = await alphaEngineService.getTickerRecommendation(holding.ticker, 'balanced')
            return { ticker: holding.ticker, verdict }
          } catch (innerError) {
            console.warn(`Failed to load verdict for ${holding.ticker}:`, innerError)
            return { ticker: holding.ticker, verdict: null }
          }
        })

        const results = await Promise.all(verdictPromises)
        const verdictMap = {}
        results.forEach(({ ticker, verdict }) => {
          verdictMap[ticker] = verdict
        })
        setVerdicts(verdictMap)
      } finally {
        setLoadingVerdicts(false)
      }
    }

    loadVerdicts()
  }, [holdings])

  const handleSort = (key) => {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'asc' }
    )
  }

  const sorted = useMemo(() => {
    return [...holdings].sort((a, b) => {
      const aVal = a[sortConfig.key]
      const bVal = b[sortConfig.key]
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal
      }
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [holdings, sortConfig.key, sortConfig.direction])

  if (holdings.length === 0) {
    return (
      <div className="panel-empty"></div>
    )
  }

  const cols = '60px 2fr 1fr 1fr 1fr 1fr 1fr 1fr auto'
  const gridStyle = { '--cols': cols }

  return (
    <>
      <div className="grid-table grid-table-head" style={gridStyle}>
        <div />
        <SortHeader label="Company" sortKey="ticker" sortConfig={sortConfig} onSort={handleSort} />
        <SortHeader label="Shares" sortKey="shares" sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Avg Cost" sortKey="avgCost" sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Current" sortKey="currentPrice" sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Change" sortKey="changePct" sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Value" sortKey="marketValue" sortConfig={sortConfig} onSort={handleSort} align="right" />
        <div className="text-center">AI Verdict</div>
        <div className="text-center">Actions</div>
      </div>

      {sorted.map((h) => (
        <HoldingRow
          key={h.ticker}
          holding={h}
          verdict={verdicts[h.ticker]}
          loadingVerdict={loadingVerdicts}
          onBuy={() => navigate(`/orders?ticker=${h.ticker}`)}
          onSell={() => navigate(`/orders?ticker=${h.ticker}`)}
          gridStyle={gridStyle}
        />
      ))}
    </>
  )
}

function HoldingRow({ holding: h, verdict, loadingVerdict, onBuy, onSell, gridStyle }) {
  const positive = h.change >= 0

  return (
    <div className="grid-table grid-table-row" style={gridStyle}>
      <div>
        <img
          className="avatar avatar-32"
          src={h.avatar}
          alt={h.ticker}
          onError={(e) => {
            e.target.src = `https://api.dicebear.com/7.x/initials/svg?seed=${h.ticker}`
          }}
        />
      </div>

      <div className="stack-sm">
        <div className="text-sm font-600">{h.company}</div>
        <div className="muted text-xs">
          {h.ticker} · {h.sector}
        </div>
      </div>

      <div className="text-right">
        <div className="text-sm font-600">{h.shares}</div>
        <div className="muted text-xs">{h.weight.toFixed(1)}%</div>
      </div>

      <div className="text-right">
        <div className="text-sm font-600">${h.avgCost.toFixed(2)}</div>
        <div className="muted text-xs">{h.ageDays}d</div>
      </div>

      <div className="text-right">
        <div className="text-sm font-600">${h.currentPrice.toFixed(2)}</div>
        <div className="muted text-xs">Market</div>
      </div>

      <div className="text-right">
        <div className={`text-sm font-600 ${positive ? 'text-positive' : 'text-negative'}`}>
          {positive ? '+' : ''}${h.change.toFixed(2)}
        </div>
        <div className={`text-xs font-600 ${positive ? 'text-positive' : 'text-negative'}`}>
          {positive ? '+' : ''}
          {h.changePct.toFixed(1)}%
        </div>
      </div>

      <div className="text-right">
        <div className="text-md font-700">${h.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        <div className="muted text-xs">{h.weight.toFixed(1)}%</div>
      </div>

      <div className="text-center">
        <VerdictBadge verdict={verdict} loading={loadingVerdict} size="small" />
      </div>

      <div className="table-actions">
        <button className="btn btn-xs btn-primary" type="button" onClick={onBuy}>
          Buy
        </button>
        <button className="btn btn-xs btn-ghost text-negative" type="button" onClick={onSell}>
          Sell
        </button>
      </div>
    </div>
  )
}

function SortHeader({ label, sortKey, sortConfig, onSort, align = 'left' }) {
  const active = sortConfig.key === sortKey
  const arrow = sortConfig.direction === 'asc' ? '↑' : '↓'
  const alignClass = align === 'right' ? 'sort-head-right text-right' : ''

  return (
    <button
      type="button"
      className={`sort-head ${alignClass}`}
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      {active && <span className="text-xs">{arrow}</span>}
    </button>
  )
}

