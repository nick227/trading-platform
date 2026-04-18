// React optimization hooks for re-render management

import { useMemo, useCallback, useRef, useEffect } from 'react'

// Optimized component wrapper with memoization
export function createOptimizedComponent(Component, areEqual = null) {
  const MemoizedComponent = React.memo(Component, areEqual)
  
  // Add display name for debugging
  MemoizedComponent.displayName = `Optimized${Component.displayName || Component.name}`
  
  return MemoizedComponent
}

// Stable callback that prevents unnecessary re-renders
export function useStableCallback(fn, deps = []) {
  const fnRef = useRef(fn)
  const depsRef = useRef(deps)
  
  // Update ref if function changes
  useEffect(() => {
    fnRef.current = fn
  }, [fn])
  
  // Check if dependencies changed
  const depsChanged = deps.length !== depsRef.current.length || 
    deps.some((dep, i) => dep !== depsRef.current[i])
  
  if (depsChanged) {
    depsRef.current = deps
  }
  
  // Return stable callback
  return useCallback((...args) => fnRef.current(...args), [depsChanged])
}

// Optimized selector with memoization
export function useSelector(selector, dependencies = []) {
  return useMemo(() => selector(), dependencies)
}

// Debounced value hook to prevent excessive re-renders
export function useDebouncedValue(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    
    return () => clearTimeout(handler)
  }, [value, delay])
  
  return debouncedValue
}

// Virtual scrolling for large lists
export function useVirtualScrolling(items, itemHeight = 40, containerHeight = 400) {
  const [scrollTop, setScrollTop] = useState(0)
  
  const visibleRange = useMemo(() => {
    const startIndex = Math.floor(scrollTop / itemHeight)
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / itemHeight) + 1,
      items.length
    )
    
    return { startIndex, endIndex }
  }, [scrollTop, itemHeight, containerHeight, items.length])
  
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex)
  }, [items, visibleRange])
  
  const totalHeight = items.length * itemHeight
  
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop)
  }, [])
  
  return {
    visibleItems,
    totalHeight,
    offsetY: visibleRange.startIndex * itemHeight,
    handleScroll
  }
}

// Optimized data fetching with stale-while-revalidate
export function useOptimizedData(fetchFn, options = {}) {
  const {
    dependencies = [],
    staleWhileRevalidate = false,
    revalidateOnFocus = false,
    revalidateOnReconnect = false,
    dedupingInterval = 2000,
    errorRetryCount = 3,
    errorRetryInterval = 1000
  } = options
  
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastFetch, setLastFetch] = useState(0)
  
  const fetchRef = useRef(fetchFn)
  const abortControllerRef = useRef(null)
  
  // Update ref if fetch function changes
  useEffect(() => {
    fetchRef.current = fetchFn
  }, [fetchFn])
  
  const fetchData = useCallback(async () => {
    const now = Date.now()
    
    // Deduping
    if (now - lastFetch < dedupingInterval) {
      return
    }
    
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    abortControllerRef.current = new AbortController()
    
    setLoading(true)
    setError(null)
    setLastFetch(now)
    
    try {
      const result = await fetchRef.current()
      
      // Don't update if request was aborted
      if (!abortControllerRef.current.signal.aborted) {
        setData(result)
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
        if (!staleWhileRevalidate) {
          setData(null)
        }
      }
    } finally {
      setLoading(false)
      abortControllerRef.current = null
    }
  }, [lastFetch, dedupingInterval, staleWhileRevalidate])
  
  // Fetch on mount and dependency changes
  useEffect(() => {
    fetchData()
  }, [fetchData, ...dependencies])
  
  // Revalidate on focus
  useEffect(() => {
    if (!revalidateOnFocus) return
    
    const handleFocus = () => {
      fetchData()
    }
    
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [fetchData, revalidateOnFocus])
  
  // Revalidate on reconnect
  useEffect(() => {
    if (!revalidateOnReconnect) return
    
    const handleOnline = () => {
      fetchData()
    }
    
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [fetchData, revalidateOnReconnect])
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])
  
  return { data, error, loading, refetch: fetchData }
}

// Optimized pagination with virtual scrolling
export function useOptimizedPagination(items, itemsPerPage = 10) {
  const [currentPage, setCurrentPage] = useState(1)
  
  const totalPages = useMemo(() => {
    return Math.ceil(items.length / itemsPerPage)
  }, [items.length, itemsPerPage])
  
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return items.slice(startIndex, endIndex)
  }, [items, currentPage, itemsPerPage])
  
  const goToPage = useCallback((page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }, [totalPages])
  
  const nextPage = useCallback(() => {
    goToPage(currentPage + 1)
  }, [currentPage, goToPage])
  
  const prevPage = useCallback(() => {
    goToPage(currentPage - 1)
  }, [currentPage, goToPage])
  
  return {
    currentPage,
    totalPages,
    paginatedItems,
    goToPage,
    nextPage,
    prevPage,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1
  }
}

// WebSocket optimization with batching
export function useOptimizedWebSocket(url, options = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
    batchSize = 10,
    batchInterval = 100
  } = options
  
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const wsRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const batchRef = useRef([])
  const batchTimerRef = useRef(null)
  
  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      
      ws.onopen = () => {
        setConnected(true)
        setError(null)
        reconnectAttemptsRef.current = 0
        onConnect?.()
      }
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        
        // Batch messages if needed
        if (batchSize > 1) {
          batchRef.current.push(data)
          
          if (batchRef.current.length >= batchSize) {
            flushBatch()
          } else if (!batchTimerRef.current) {
            batchTimerRef.current = setTimeout(flushBatch, batchInterval)
          }
        } else {
          onMessage?.(data)
        }
      }
      
      ws.onclose = () => {
        setConnected(false)
        onDisconnect?.()
        
        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          setTimeout(connect, reconnectInterval)
        }
      }
      
      ws.onerror = (err) => {
        setError(err)
        onError?.(err)
      }
    } catch (err) {
      setError(err)
      onError?.(err)
    }
  }, [url, onConnect, onDisconnect, onError, reconnectInterval, maxReconnectAttempts, batchSize, batchInterval])
  
  const flushBatch = useCallback(() => {
    if (batchRef.current.length > 0) {
      onMessage?.(batchRef.current)
      batchRef.current = []
    }
    
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
  }, [onMessage])
  
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
  }, [])
  
  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])
  
  // Auto-connect on mount
  useEffect(() => {
    connect()
    
    return () => {
      disconnect()
    }
  }, [connect, disconnect])
  
  return {
    connected,
    error,
    send,
    disconnect,
    reconnect: connect
  }
}

// Performance monitoring for React components
export function usePerformanceMonitor(componentName) {
  const renderCountRef = useRef(0)
  const lastRenderRef = useRef(Date.now())
  
  useEffect(() => {
    renderCountRef.current++
    const now = Date.now()
    const timeSinceLastRender = now - lastRenderRef.current
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`${componentName} render #${renderCountRef.current}, time since last: ${timeSinceLastRender}ms`)
    }
    
    lastRenderRef.current = now
  })
  
  return {
    renderCount: renderCountRef.current,
    timeSinceLastRender: Date.now() - lastRenderRef.current
  }
}

// Bundle size monitoring
export function useBundleSizeMonitor() {
  const [bundleSize, setBundleSize] = useState(null)
  
  useEffect(() => {
    if (performance.memory) {
      const updateBundleSize = () => {
        const memoryInfo = performance.memory
        setBundleSize({
          used: memoryInfo.usedJSHeapSize,
          total: memoryInfo.totalJSHeapSize,
          limit: memoryInfo.jsHeapSizeLimit
        })
      }
      
      updateBundleSize()
      const interval = setInterval(updateBundleSize, 5000)
      
      return () => clearInterval(interval)
    }
  }, [])
  
  return bundleSize
}

// Lazy loading with code splitting
export function useLazyComponent(importFn, fallback = null) {
  const [component, setComponent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const loadComponent = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const module = await importFn()
      setComponent(module.default || module)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [importFn])
  
  useEffect(() => {
    loadComponent()
  }, [loadComponent])
  
  return { component, loading, error, retry: loadComponent }
}
