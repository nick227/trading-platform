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

        const rec = data.recommendation

        // alpha explainability uses 0–1 confidence; recommendation uses 0–100
        const alphaSource = data.alpha
          ? { ...data.alpha, _scale: 'fraction' }
          : rec
          ? { confidence: rec.confidence ?? 0, action: rec.action, explanation: rec.thesis?.join(' '), _scale: 'percent' }
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
            timeframe: rec?.horizon   ?? data.alpha?.timeframe ?? '30d',
            reasoning: alphaSource.explanation ?? 'No reasoning available',
            thesis:    rec?.thesis    ?? [],
            avoidIf:   rec?.avoidIf   ?? [],
            entryZone: rec?.entryZone ?? null,
            risk:      rec?.risk      ?? null,
          })
        }

        // Update selected stock with live price from bootstrap quote (optional callback).
        if (data.quote && typeof setSelectedStock === 'function') {
          setSelectedStock(prev => {
            if (!prev || prev.symbol !== symbol) return prev
            return {
              ...prev,
              price: data.quote.price || 0,
              change: data.quote.change || 0,
              volume: data.quote.volume || prev.volume,
              timestamp: data.quote.timestamp,
              freshness: data.quote.freshness || 'unknown',
              ageMs: data.quote.ageMs || 0
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
