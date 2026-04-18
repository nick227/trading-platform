import { useEffect, useRef } from 'react'

export function usePolling(fn, interval = 20000, dependencies = []) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    // Execute immediately
    fnRef.current()
    
    const id = setInterval(() => {
      fnRef.current()
    }, interval)
    
    return () => clearInterval(id)
  }, [interval, ...dependencies])
}

export function useConditionalPolling(fn, interval, condition) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  
  useEffect(() => {
    if (!condition) return
    
    fnRef.current()
    const id = setInterval(() => {
      if (condition) {
        fnRef.current()
      }
    }, interval)
    
    return () => clearInterval(id)
  }, [interval, condition])
}
