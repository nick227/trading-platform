import { useState, useEffect, useCallback } from 'react'

export default function useSectionData(fetchFn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (force = false) => {
    try {
      if (data == null || !force) setLoading(true)
      else setIsRefreshing(true)
      setError(null)
      const result = await fetchFn()
      setData(result)
      return result
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [data, fetchFn])

  useEffect(() => {
    load().catch(() => {})
  }, [load, ...deps])

  const retry = useCallback(() => load(true), [load])

  return { data, loading, isRefreshing, error, retry }
}
