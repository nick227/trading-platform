import { useEffect, useMemo, useState } from 'react'
import { get } from '../../../api/client.js'
import { transformSignalsToLiveFormat } from '../../../utils/predictions.js'
import { API, DEFER_MS } from '../constants.js'

export function useSignals({ priceMap, defer = DEFER_MS.signals } = {}) {
  const [signals, setSignals] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await get(API.SIGNALS)
        setSignals(Array.isArray(data) ? data : [])
      } catch (err) {
        setError(err?.message || 'Failed to load signals')
      } finally {
        setLoading(false)
      }
    }
    const t = setTimeout(load, defer)
    return () => clearTimeout(t)
  }, [defer])

  const liveSignals = useMemo(
    () => transformSignalsToLiveFormat(signals, priceMap),
    [signals, priceMap]
  )

  return { liveSignals, loading, error }
}
