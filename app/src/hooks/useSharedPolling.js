import { useEffect, useRef, useState } from 'react'

// Shared polling state - dedupes in-flight requests across components
const sharedPollingState = new Map()

export function useSharedPolling(key, fn, interval = 15000, condition = true, source = 'unknown') {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!condition) return

    // Initialize shared state for this key if not exists
    if (!sharedPollingState.has(key)) {
      sharedPollingState.set(key, {
        data: null,
        loading: false,
        error: null,
        lastFetch: 0,
        promise: null, // Store in-flight promise for deduping
        subscribers: new Set()
      })
    }

    const state = sharedPollingState.get(key)
    const subscriberId = Symbol('subscriber')

    // Subscribe to shared state
    state.subscribers.add(subscriberId)

    console.log(`[SharedPolling] ${key} subscribed by ${source}, total subscribers: ${state.subscribers.size}`)

    // Initial sync with shared state
    setData(state.data)
    setLoading(state.loading)
    setError(state.error)

    // Shared fetch function with promise deduping
    const sharedFetch = async (trigger = 'unknown') => {
      const now = Date.now()
      const state = sharedPollingState.get(key)

      // If a promise is already in-flight, await it instead of starting new fetch
      if (state.promise) {
        console.log(`[SharedPolling] ${key} deduped - awaiting in-flight promise (triggered by ${trigger})`)
        try {
          await state.promise
        } catch {
          // Error already handled by the original promise
        }
        return
      }

      // If data is fresh (within interval), skip
      if (state.lastFetch && now - state.lastFetch < interval) {
        console.log(`[SharedPolling] ${key} skipped - data fresh (${Math.round((now - state.lastFetch) / 1000)}s ago)`)
        return
      }

      console.log(`[SharedPolling] ${key} fetching (triggered by ${trigger}, source: ${source})`)

      // Create new promise and store it
      state.loading = true
      state.error = null
      state.lastFetch = now

      const fetchPromise = (async () => {
        try {
          const result = await fnRef.current()
          state.data = result
          state.error = null
          console.log(`[SharedPolling] ${key} fetch complete`)
        } catch (err) {
          state.error = err.message
          state.data = null
          console.error(`[SharedPolling] ${key} fetch failed:`, err.message)
        } finally {
          state.loading = false
          state.promise = null // Clear promise after completion
        }
      })()

      state.promise = fetchPromise

      // Wait for the promise to complete
      try {
        await fetchPromise
      } catch {
        // Error already handled
      }

      // Update local state
      setData(state.data)
      setLoading(state.loading)
      setError(state.error)
    }

    // Initial fetch
    sharedFetch('initial-mount')

    // Polling interval
    const pollId = setInterval(() => {
      if (condition && !document.hidden) {
        sharedFetch('poll')
        // Sync with shared state after poll
        const state = sharedPollingState.get(key)
        setData(state.data)
        setLoading(state.loading)
        setError(state.error)
      }
    }, interval)

    // Visibility change handler
    const handleVisibilityChange = () => {
      if (!document.hidden && condition) {
        sharedFetch('visibility-change')
        const state = sharedPollingState.get(key)
        setData(state.data)
        setLoading(state.loading)
        setError(state.error)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup
    return () => {
      clearInterval(pollId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)

      // Unsubscribe
      const state = sharedPollingState.get(key)
      if (state) {
        state.subscribers.delete(subscriberId)
        console.log(`[SharedPolling] ${key} unsubscribed by ${source}, remaining subscribers: ${state.subscribers.size}`)

        // Clean up shared state if no subscribers
        if (state.subscribers.size === 0) {
          sharedPollingState.delete(key)
          console.log(`[SharedPolling] ${key} cleaned up - no subscribers`)
        }
      }
    }
  }, [key, interval, condition, source])

  return { data, loading, error }
}
