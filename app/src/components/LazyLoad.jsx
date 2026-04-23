import { useState, useEffect, useRef, Suspense, useMemo } from 'react'

// Simple lazy loading component
export default function LazyLoad({ 
  children, 
  fallback = null, 
  rootMargin = '100px',
  threshold = 0.1,
  className = '',
  ...props 
}) {
  const [isIntersecting, setIsIntersecting] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const elementRef = useRef(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasLoaded) {
          setIsIntersecting(true)
          setHasLoaded(true)
        }
      },
      {
        rootMargin,
        threshold,
      }
    )

    observer.observe(element)

    return () => {
      observer.unobserve(element)
    }
  }, [rootMargin, threshold, hasLoaded])

  return (
    <div ref={elementRef} className={`lazy-load ${className}`} {...props}>
      {isIntersecting ? (
        <Suspense fallback={fallback}>
          {children}
        </Suspense>
      ) : (
        fallback || <div style={{ height: '200px' }} />
      )}
    </div>
  )
}

// Hook for lazy loading any component
export function useLazyLoad(Component, fallback = null) {
  const LazyComponent = useMemo(() => {
    return function LazyWrapper(props) {
      return (
        <LazyLoad fallback={fallback}>
          <Component {...props} />
        </LazyLoad>
      )
    }
  }, [Component, fallback])

  return LazyComponent
}

// Lazy image component
export function LazyImage({ 
  src, 
  alt, 
  className = '', 
  placeholder = '/images/placeholder.png',
  ...props 
}) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isInView, setIsInView] = useState(false)
  const [hasError, setHasError] = useState(false)
  const imgRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '50px' }
    )

    if (imgRef.current) {
      observer.observe(imgRef.current)
    }

    return () => {
      if (imgRef.current) {
        observer.unobserve(imgRef.current)
      }
    }
  }, [])

  const handleLoad = () => {
    setIsLoaded(true)
  }

  const handleError = () => {
    setHasError(true)
  }

  return (
    <div ref={imgRef} className={`lazy-image ${className}`} {...props}>
      {isInView && (
        <img
          src={hasError ? placeholder : src}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          style={{
            opacity: isLoaded ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        />
      )}
      {!isLoaded && (
        <div 
          className="lazy-image-placeholder"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--color-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted)',
          }}
        >
          Loading...
        </div>
      )}
    </div>
  )
}

// Lazy chart component wrapper
export function LazyChart({ children, fallback, ...props }) {
  return (
    <LazyLoad 
      fallback={fallback || (
        <div style={{ 
          height: '300px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)'
        }}>
          <div style={{ color: 'var(--color-muted)' }}>Loading chart...</div>
        </div>
      )}
      rootMargin="200px"
      {...props}
    >
      {children}
    </LazyLoad>
  )
}

// Hook for lazy loading data
export function useLazyData(fetcher, dependencies = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [shouldFetch, setShouldFetch] = useState(false)

  useEffect(() => {
    if (shouldFetch) {
      setLoading(true)
      setError(null)
      
      fetcher()
        .then(setData)
        .catch(setError)
        .finally(() => setLoading(false))
    }
  }, [shouldFetch, ...dependencies])

  const triggerFetch = useCallback(() => {
    setShouldFetch(true)
  }, [])

  return { data, loading, error, triggerFetch }
}
