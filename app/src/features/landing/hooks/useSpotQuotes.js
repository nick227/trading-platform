import { useCallback, useEffect, useState } from 'react'
import { alphaFetch } from '../../../api/services/alphaEngineService.js'
import { normalizeSymbol } from '../../assets/utils.js'
import { API } from '../constants.js'

export function useSpotQuotes() {
  const [spotQuotes, setSpotQuotes] = useState({})

  const load = useCallback(async () => {
    try {
      const result     = await alphaFetch(API.SPOT_QUOTES)
      const quotesData = Array.isArray(result) ? result : result?.data || []
      const next = {}
      for (const quote of quotesData) {
        if (quote && !quote.error) next[normalizeSymbol(quote.symbol)] = quote
      }
      setSpotQuotes(next)
    } catch {
      // non-critical — Market Context still shows regime without prices
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { spotQuotes }
}
