import { useEffect } from 'react'

export function usePolling(fn, interval = 20000) {
  useEffect(() => {
    fn()
    const id = setInterval(fn, interval)
    return () => clearInterval(id)
  }, [fn, interval])
}
