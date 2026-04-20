import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import alphaEngineService from '../../api/services/alphaEngineService.js'
import { VerdictBadge } from '../../components/ConfidenceBadge.jsx'

export default function HoldingsTable({ holdings }) {
  const navigate = useNavigate()
  const [sortConfig, setSortConfig] = useState({ key: 'marketValue', direction: 'desc' })
  const [verdicts, setVerdicts] = useState({})
  const [loadingVerdicts, setLoadingVerdicts] = useState(false)

  // Load verdicts for all holdings using batch API
  useEffect(() => {
    if (holdings.length === 0) return

    const loadVerdicts = async () => {
      setLoadingVerdicts(true)
      try {
        const tickers = holdings.map(h => h.ticker)
        const batchData = await alphaEngineService.getBatchRecommendations(tickers, 'balanced')
        
        // Transform batch response to verdict map
        const verdictMap = {}
        if (batchData.recommendations && Array.isArray(batchData.recommendations)) {
          batchData.recommendations.forEach(rec => {
            verdictMap[rec.ticker] = rec
          })
        }
        
        // Ensure all holdings have entries (null if missing)
        holdings.forEach(holding => {
          if (!(holding.ticker in verdictMap)) {
            verdictMap[holding.ticker] = null
          }
        })
        
        setVerdicts(verdictMap)
      } catch (error) {
        console.error('Failed to load batch verdicts:', error)
        // Fallback to individual calls if batch fails
        const verdictPromises = holdings.map(async (holding) => {
          try {
            const verdict = await alphaEngineService.getTickerRecommendation(holding.ticker, 'balanced')
            return { ticker: holding.ticker, verdict }
          } catch (error) {
            console.warn(`Failed to load verdict for ${holding.ticker}:`, error)
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
    setSortConfig(prev =>
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
      <div className="muted" style={{ textAlign: 'center', padding: '2rem' }}>
        No open positions.{' '}
        <button className="ghost pressable" style={{ fontSize: '14px' }} onClick={() => navigate('/orders')}>
          Place a trade
        </button>
      </div>
    )
  }

  const cols = '60px 2fr 1fr 1fr 1fr 1fr 1fr 1fr auto'

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '1rem', padding: '0.75rem 0', borderBottom: '2px solid #e9ecef', fontSize: '12px', fontWeight: 600, color: '#7a7a7a' }}>
        <div />
        <SortHeader label="Company"  sortKey="ticker"       sortConfig={sortConfig} onSort={handleSort} />
        <SortHeader label="Shares"   sortKey="shares"       sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Avg Cost" sortKey="avgCost"      sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Current"  sortKey="currentPrice" sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Change"   sortKey="changePct"    sortConfig={sortConfig} onSort={handleSort} align="right" />
        <SortHeader label="Value"    sortKey="marketValue"  sortConfig={sortConfig} onSort={handleSort} align="right" />
        <div style={{ textAlign: 'center' }}>AI Verdict</div>
        <div style={{ textAlign: 'center' }}>Actions</div>
      </div>

      {sorted.map(h => (
        <HoldingRow 
          key={h.ticker} 
          holding={h} 
          verdict={verdicts[h.ticker]}
          loadingVerdict={loadingVerdicts}
          onBuy={() => navigate(`/orders?ticker=${h.ticker}`)} 
          onSell={() => navigate(`/orders?ticker=${h.ticker}`)} 
          cols={cols} 
        />
      ))}
    </>
  )
}

function HoldingRow({ holding: h, verdict, loadingVerdict, onBuy, onSell, cols }) {
  const positive = h.change >= 0
  
  
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '1rem', padding: '1rem 0', borderBottom: '1px solid #f0f0f0', alignItems: 'center' }}>
      <div>
        <img
          src={h.avatar}
          alt={h.ticker}
          style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
          onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/initials/svg?seed=${h.ticker}` }}
        />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: '14px' }}>{h.company}</div>
        <div className="muted" style={{ fontSize: '12px' }}>{h.ticker} · {h.sector}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 600, fontSize: '14px' }}>{h.shares}</div>
        <div className="muted" style={{ fontSize: '11px' }}>{h.weight.toFixed(1)}%</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 600, fontSize: '14px' }}>${h.avgCost.toFixed(2)}</div>
        <div className="muted" style={{ fontSize: '11px' }}>{h.ageDays}d</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 600, fontSize: '14px' }}>${h.currentPrice.toFixed(2)}</div>
        <div className="muted" style={{ fontSize: '11px' }}>Market</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: positive ? '#0a7a47' : '#c0392b' }}>
          {positive ? '+' : ''}${h.change.toFixed(2)}
        </div>
        <div className="muted" style={{ fontSize: '11px', color: positive ? '#0a7a47' : '#c0392b' }}>
          {positive ? '+' : ''}{h.changePct.toFixed(1)}%
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 700, fontSize: '16px' }}>
          ${h.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        <div className="muted" style={{ fontSize: '11px' }}>{h.weight.toFixed(1)}%</div>
      </div>
      <div>
        <VerdictBadge 
          verdict={verdict} 
          loading={loadingVerdict} 
          size="small" 
        />
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="primary pressable" onClick={onBuy} style={{ padding: '0.5rem 1rem', fontSize: '12px', fontWeight: 600, minWidth: '60px' }}>Buy</button>
        <button className="ghost pressable" onClick={onSell} style={{ padding: '0.5rem 1rem', fontSize: '12px', fontWeight: 600, minWidth: '60px', borderColor: '#c0392b', color: '#c0392b' }}>Sell</button>
      </div>
    </div>
  )
}

function SortHeader({ label, sortKey, sortConfig, onSort, align = 'left' }) {
  const active = sortConfig.key === sortKey
  return (
    <div
      style={{ cursor: 'pointer', textAlign: align, display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: '4px' }}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      {active && <span style={{ fontSize: '10px' }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
    </div>
  )
}
