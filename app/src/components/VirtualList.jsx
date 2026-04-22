import { useState, useEffect, useRef, useMemo } from 'react'

export default function VirtualList({
  items = [],
  itemHeight = 50,
  containerHeight = 400,
  renderItem,
  overscan = 5,
  className = '',
  ...props
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const scrollElementRef = useRef(null)

  // Calculate visible range
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    )
    return { startIndex, endIndex }
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan])

  // Calculate total height and offset
  const totalHeight = items.length * itemHeight
  const offsetY = visibleRange.startIndex * itemHeight

  // Handle scroll events
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop)
  }, [])

  // Visible items
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex + 1)
  }, [items, visibleRange.startIndex, visibleRange.endIndex])

  return (
    <div
      ref={scrollElementRef}
      className={`virtual-list ${className}`}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative'
      }}
      onScroll={handleScroll}
      {...props}
    >
      {/* Spacer for items above visible range */}
      <div style={{ height: offsetY }} />
      
      {/* Visible items */}
      <div>
        {visibleItems.map((item, index) => {
          const actualIndex = visibleRange.startIndex + index
          return (
            <div
              key={actualIndex}
              style={{
                height: itemHeight,
                position: 'relative'
              }}
            >
              {renderItem(item, actualIndex)}
            </div>
          )
        })}
      </div>
      
      {/* Spacer for items below visible range */}
      <div style={{ height: totalHeight - offsetY - (visibleItems.length * itemHeight) }} />
    </div>
  )
}

// Hook for virtual scrolling
export function useVirtualList({
  items = [],
  itemHeight = 50,
  containerHeight = 400,
  overscan = 5
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const scrollElementRef = useRef(null)

  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    )
    return { startIndex, endIndex }
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan])

  const totalHeight = items.length * itemHeight
  const offsetY = visibleRange.startIndex * itemHeight

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop)
  }, [])

  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex + 1)
  }, [items, visibleRange.startIndex, visibleRange.endIndex])

  return {
    scrollElementRef,
    visibleItems,
    visibleRange,
    totalHeight,
    offsetY,
    handleScroll
  }
}
