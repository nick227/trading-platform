import { useState, useEffect, useMemo, useCallback } from 'react'

// Optimized data fetching hook with caching and debouncing
export function useOptimizedData(fetchFn, dependencies = [], options = {}) {
  const { cacheKey, debounceMs = 300, staleWhileRevalidate = false } = options
  
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastFetch, setLastFetch] = useState(0)
  
  // Memoized fetch function to prevent unnecessary recreations
  const memoizedFetch = useCallback(async () => {
    const now = Date.now()
    
    // Skip if we fetched recently (debouncing)
    if (now - lastFetch < debounceMs) {
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await fetchFn()
      setData(result)
      setLastFetch(now)
    } catch (err) {
      setError(err.message)
      if (!staleWhileRevalidate) {
        setData(null)
      }
    } finally {
      setLoading(false)
    }
  }, [fetchFn, debounceMs, lastFetch, staleWhileRevalidate])
  
  // Auto-fetch on mount and dependency changes
  useEffect(() => {
    memoizedFetch()
  }, [memoizedFetch, ...dependencies])
  
  // Optimized refetch function
  const refetch = useCallback(() => {
    setLastFetch(0) // Force fetch by resetting timestamp
    return memoizedFetch()
  }, [memoizedFetch])
  
  return { data, loading, error, refetch }
}

// Optimized search hook with debouncing and caching
export function useOptimizedSearch(items, searchFn, debounceMs = 300) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchCache, setSearchCache] = useState(new Map())
  
  // Debounced search with memoization
  const debouncedSearch = useMemo(() => {
    let timeoutId
    
    return (searchQuery) => {
      clearTimeout(timeoutId)
      
      timeoutId = setTimeout(() => {
        if (searchQuery.trim() === '') {
          setResults(items)
          return
        }
        
        // Check cache first
        if (searchCache.has(searchQuery)) {
          setResults(searchCache.get(searchQuery))
          return
        }
        
        // Perform search
        const searchResults = searchFn(items, searchQuery)
        setResults(searchResults)
        
        // Cache results (limit cache size)
        if (searchCache.size > 100) {
          const firstKey = searchCache.keys().next().value
          searchCache.delete(firstKey)
        }
        searchCache.set(searchQuery, searchResults)
      }, debounceMs)
    }
  }, [items, searchFn, searchCache, debounceMs])
  
  // Update query and trigger search
  const handleSearch = useCallback((newQuery) => {
    setQuery(newQuery)
    debouncedSearch(newQuery)
  }, [debouncedSearch])
  
  // Initial search
  useEffect(() => {
    setResults(items)
  }, [items])
  
  return { query, results, handleSearch }
}

// Optimized pagination hook
export function useOptimizedPagination(items, itemsPerPage = 10) {
  const [currentPage, setCurrentPage] = useState(1)
  
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return items.slice(startIndex, endIndex)
  }, [items, currentPage, itemsPerPage])
  
  const totalPages = useMemo(() => {
    return Math.ceil(items.length / itemsPerPage)
  }, [items.length, itemsPerPage])
  
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

// Optimized sorting hook with stable sorting
export function useOptimizedSort(items, key, direction = 'asc') {
  const sortedItems = useMemo(() => {
    if (!key || items.length === 0) return items
    
    // Create stable sort with index tracking
    const indexedItems = items.map((item, index) => ({ item, index }))
    
    indexedItems.sort((a, b) => {
      const aValue = a.item[key]
      const bValue = b.item[key]
      
      let comparison = 0
      if (aValue < bValue) comparison = -1
      else if (aValue > bValue) comparison = 1
      
      // Stable sort: use original index as tiebreaker
      if (comparison === 0) {
        comparison = a.index - b.index
      }
      
      return direction === 'desc' ? -comparison : comparison
    })
    
    return indexedItems.map(({ item }) => item)
  }, [items, key, direction])
  
  return sortedItems
}

// Optimized filtering hook with memoization
export function useOptimizedFilter(items, filterFn, dependencies = []) {
  const filteredItems = useMemo(() => {
    if (!filterFn || items.length === 0) return items
    return items.filter(filterFn)
  }, [items, filterFn, ...dependencies])
  
  return filteredItems
}
