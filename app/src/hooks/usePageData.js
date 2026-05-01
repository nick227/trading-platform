import { useState, useEffect, useCallback } from 'react'

const pageCache = new Map()
const inflightCache = new Map()

function getCacheEntry(key, staleTime) {
  if (!key || !pageCache.has(key)) return null
  const entry = pageCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > staleTime) return null
  return entry
}

export async function prefetchPageData({ key, fetcher, staleTime = 15000 }) {
  if (!key || typeof fetcher !== 'function') return null
  const cached = getCacheEntry(key, staleTime)
  if (cached) return cached.data
  if (inflightCache.has(key)) return inflightCache.get(key)

  const request = fetcher()
    .then((result) => {
      pageCache.set(key, { data: result, ts: Date.now() })
      inflightCache.delete(key)
      return result
    })
    .catch((error) => {
      inflightCache.delete(key)
      throw error
    })

  inflightCache.set(key, request)
  return request
}

export default function usePageData({ key, fetcher, staleTime = 15000 }) {
  const cached = getCacheEntry(key, staleTime)
  
  const [data, setData] = useState(cached?.data ?? null)
  const [loading, setLoading] = useState(!cached)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (force = false) => {
    let hasFreshCache = false
    if (!force) {
      const fresh = getCacheEntry(key, staleTime)
      if (fresh) {
        setData(fresh.data)
        setLoading(false)
        hasFreshCache = true
      }
    }

    try {
      const hasData = hasFreshCache || data != null
      if (hasData) setIsRefreshing(true)
      else setLoading(true)
      setError(null)
      const result = await prefetchPageData({ key, fetcher, staleTime })
      setData(result)
      return result
    } catch (err) {
      console.error('usePageData fetch error:', err)
      setError(err)
      throw err
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [fetcher, key, staleTime])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  const retry = useCallback(() => load(true), [load])

  return { data, loading, isRefreshing, error, retry }
}
