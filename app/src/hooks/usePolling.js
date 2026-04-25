import { useEffect, useRef } from 'react'

export function usePolling(fn, interval = 20000, dependencies = []) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    // Execute immediately
    fnRef.current()

    const id = setInterval(() => {
      // Only poll if tab is visible
      if (!document.hidden) {
        fnRef.current()
      }
    }, interval)

    // Pause polling when tab is hidden, resume when visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fnRef.current() // Refresh immediately when tab becomes visible
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [interval, ...dependencies])
}

export function useConditionalPolling(fn, interval, condition) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!condition) return

    fnRef.current()
    const id = setInterval(() => {
      if (condition && !document.hidden) {
        fnRef.current()
      }
    }, interval)

    // Pause polling when tab is hidden, resume when visible
    const handleVisibilityChange = () => {
      if (!document.hidden && condition) {
        fnRef.current() // Refresh immediately when tab becomes visible
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [interval, condition])
}
