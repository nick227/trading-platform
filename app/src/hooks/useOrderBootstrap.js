import { useState, useEffect, useCallback } from 'react'
import alphaEngineService from '../api/services/alphaEngineService.js'
import { confidenceToSignal } from '../utils/signal.js'

/**
 * Loads all data for a single ticker via the bootstrap endpoint.
 * Uses an AbortController to cancel stale in-flight requests when
 * symbol or range changes — replacing the broken useRaceProtection pattern.
 *
 * Returns:
 *   bootstrapData  — raw bootstrap payload (company, stats, quote, dataCoverage, userOwnership, …)
 *   loading        — true while fetch is in flight
 *   error          — string | null — set when the engine is unreachable
 *   priceHistory   — [{ ts, date, open, high, low, close, volume, price }] derived from bootstrapData.history
 *   priceRange     — { min, max, range } derived from priceHistory (low/high with close fallback)
 *   alpha          — normalised { signal, confidence, target, timeframe, reasoning } | null
 *   refresh        — () => void — forces a re-fetch of the current symbol/range
 */
export function useOrderBootstrap(symbol, range = '1Y', setSelectedStock = null) {
  const [bootstrapData, setBootstrapData]   = useState(null)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState(null)
  const [priceHistory, setPriceHistory]     = useState([])
  const [priceRange, setPriceRange]         = useState({ min: 0, max: 0, range: 0 })
  const [alpha, setAlpha]                   = useState(null)
  // Incrementing this forces the effect to re-run without changing symbol/range.
  const [refreshKey, setRefreshKey]         = useState(0)

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    if (!symbol) {
      setBootstrapData(null)
      setPriceHistory([])
      setPriceRange({ min: 0, max: 0, range: 0 })
      setAlpha(null)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    alphaEngineService.getBootstrapData(symbol, range, '1D')
      .then(data => {
        if (controller.signal.aborted) return
        if (!data) {
          setError('Market data unavailable')
          return
        }

        setBootstrapData(data)

        if (data.history?.length > 0) {
          setPriceHistory(data.history)
          const lows  = data.history.map(p => (Number.isFinite(p.low)  ? p.low  : p.price))
          const highs = data.history.map(p => (Number.isFinite(p.high) ? p.high : p.price))
          const min   = Math.min(...lows)
          const max   = Math.max(...highs)
          setPriceRange({ min, max, range: max - min })
        }

        const baseRec = data.recommendation ?? null
        const rec = (baseRec && typeof baseRec === 'object' && baseRec.recommendation && typeof baseRec.recommendation === 'object')
          ? baseRec.recommendation
          : baseRec

        // Avoid mixing semantics. If a recommendation exists, use it for direction + confidence.
        // Explainability (data.alpha) is used only for narrative support ("why").
        const explainability = data.alpha && typeof data.alpha === 'object' ? data.alpha : null
        const hasRec = rec && typeof rec === 'object' && (rec.action || rec.confidence != null)

        // alpha explainability uses 0–1 confidence; recommendation uses 0–100
        const alphaSource = hasRec
          ? { confidence: rec.confidence ?? 0, action: rec.action, explanation: rec.thesis?.join(' '), _scale: 'percent' }
          : explainability
            ? { ...explainability, _scale: 'fraction' }
            : null

        if (alphaSource) {
          const confidence = alphaSource._scale === 'fraction'
            ? Math.round((alphaSource.confidence ?? 0) * 100)
            : (alphaSource.confidence ?? 0)

          // action gives direction; confidence gives strength — treat independently
          const action = (alphaSource.action ?? '').toUpperCase()
          const signal = action === 'BUY'  ? (confidence >= 70 ? 'STRONG_BUY'  : 'BUY')
                       : action === 'SELL' ? (confidence >= 70 ? 'STRONG_SELL' : 'SELL')
                       : action === 'HOLD' ? 'HOLD'
                       : confidenceToSignal(confidence)

          setAlpha({
            signal,
            confidence,
            timeframe: rec?.horizon ?? explainability?.timeframe ?? '30d',
            reasoning: explainability?.explanation ?? alphaSource.explanation ?? 'No reasoning available',
            thesis:    rec?.thesis ?? [],
            avoidIf:   rec?.avoidIf ?? [],
            entryZone: rec?.entryZone ?? null,
            risk:      rec?.risk ?? null,
          })
        } else {
          setAlpha(null)
        }

        // Update selected stock with best available price/change (optional callback).
        if (typeof setSelectedStock === 'function') {
          setSelectedStock(prev => {
            if (!prev || prev.symbol !== symbol) return prev
            return {
              ...prev,
              price: (data.quote?.price ?? data.stats?.price) ?? prev.price,
              change: (data.quote?.change ?? data.stats?.dayChangePct) ?? prev.change,
              volume: data.quote?.volume ?? prev.volume,
              timestamp: data.quote?.updatedAt ?? data.quote?.timestamp ?? prev.timestamp,
              freshness: data.quote?.freshness || prev.freshness || 'unknown',
              ageMs: data.quote?.ageMs || prev.ageMs || 0
            }
          })
        }
      })
      .catch(err => {
        if (controller.signal.aborted) return
        console.error('Bootstrap load failed:', err)
        setError('Market data temporarily unavailable')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => {
      controller.abort()
      setLoading(false)
    }
  }, [symbol, range, refreshKey])

  return { bootstrapData, loading, error, priceHistory, priceRange, alpha, refresh }
}
