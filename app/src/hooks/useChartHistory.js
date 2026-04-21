import { useEffect, useMemo, useRef, useState } from 'react'
import alphaEngineService from '../api/services/alphaEngineService.js'

function computeRange(points) {
  if (!Array.isArray(points) || points.length === 0) return { min: 0, max: 0, range: 0 }

  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const low = Number.isFinite(p?.low) ? p.low : (Number.isFinite(p?.price) ? p.price : null)
    const high = Number.isFinite(p?.high) ? p.high : (Number.isFinite(p?.price) ? p.price : null)
    if (low == null || high == null) continue
    if (low < min) min = low
    if (high > max) max = high
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0, range: 0 }
  return { min, max, range: max - min }
}

export function useChartHistory(symbol, range = '1Y', interval = '1D') {
  const [history, setHistory] = useState([])
  const [priceRange, setPriceRange] = useState({ min: 0, max: 0, range: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const lastSymbolRef = useRef(null)

  useEffect(() => {
    if (!symbol) {
      lastSymbolRef.current = null
      setHistory([])
      setPriceRange({ min: 0, max: 0, range: 0 })
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const symbolChanged = lastSymbolRef.current !== symbol
    lastSymbolRef.current = symbol

    // Keep prior history during range changes to avoid layout thrash.
    setLoading(true)
    setError(null)
    if (symbolChanged) {
      setHistory([])
      setPriceRange({ min: 0, max: 0, range: 0 })
    }

    ;(async () => {
      try {
        const data = await alphaEngineService.getBootstrapData(symbol, range, interval)
        const points = data?.history
        if (controller.signal.aborted) return
        const list = Array.isArray(points) ? points : []
        setHistory(list)
        setPriceRange(computeRange(list))
      } catch (e) {
        if (controller.signal.aborted) return
        console.warn('Chart history load failed:', e)
        setError('Chart data unavailable')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [symbol, range, interval])

  const dateSpan = useMemo(() => {
    if (!history.length) return null
    const first = history[0]
    const last = history[history.length - 1]
    if (!Number.isFinite(first?.ts) || !Number.isFinite(last?.ts)) return null
    return { startTs: first.ts, endTs: last.ts }
  }, [history])

  return { history, priceRange, loading, error, dateSpan }
}
