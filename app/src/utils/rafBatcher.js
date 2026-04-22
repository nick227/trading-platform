import { useState, useEffect, useRef, useCallback } from 'react'

// RequestAnimationFrame Batching Service
// Optimizes DOM updates and animations by batching operations

class RAFBatcher {
  constructor() {
    this.readOperations = new Set()
    this.writeOperations = new Set()
    this.scheduled = false
    this.frameId = null
    this.stats = {
      frames: 0,
      readsPerFrame: [],
      writesPerFrame: [],
      avgReadsPerFrame: 0,
      avgWritesPerFrame: 0
    }
  }

  // Schedule a DOM read operation
  scheduleRead(callback, priority = 'normal') {
    const operation = {
      type: 'read',
      callback,
      priority,
      id: Math.random().toString(36).substr(2, 9)
    }
    
    this.readOperations.add(operation)
    this.scheduleFrame()
    
    return operation.id
  }

  // Schedule a DOM write operation
  scheduleWrite(callback, priority = 'normal') {
    const operation = {
      type: 'write',
      callback,
      priority,
      id: Math.random().toString(36).substr(2, 9)
    }
    
    this.writeOperations.add(operation)
    this.scheduleFrame()
    
    return operation.id
  }

  // Schedule the next frame
  scheduleFrame() {
    if (!this.scheduled) {
      this.scheduled = true
      this.frameId = requestAnimationFrame((timestamp) => {
        this.flush(timestamp)
      })
    }
  }

  // Execute all scheduled operations
  flush(timestamp) {
    this.scheduled = false
    this.stats.frames++
    
    const readCount = this.readOperations.size
    const writeCount = this.writeOperations.size
    
    // Sort operations by priority
    const sortedReads = Array.from(this.readOperations).sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 }
      return priorityOrder[b.priority] - priorityOrder[a.priority]
    })
    
    const sortedWrites = Array.from(this.writeOperations).sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 }
      return priorityOrder[b.priority] - priorityOrder[a.priority]
    })
    
    // Execute all read operations first (read-read-write pattern)
    const readResults = []
    sortedReads.forEach(operation => {
      try {
        const result = operation.callback(timestamp)
        readResults.push({ id: operation.id, result })
      } catch (error) {
        console.error('Read operation failed:', error)
      }
    })
    
    // Execute all write operations
    sortedWrites.forEach(operation => {
      try {
        operation.callback(timestamp, readResults)
      } catch (error) {
        console.error('Write operation failed:', error)
      }
    })
    
    // Update statistics
    this.stats.readsPerFrame.push(readCount)
    this.stats.writesPerFrame.push(writeCount)
    
    // Keep only last 60 frames for averaging
    if (this.stats.readsPerFrame.length > 60) {
      this.stats.readsPerFrame.shift()
      this.stats.writesPerFrame.shift()
    }
    
    this.stats.avgReadsPerFrame = this.stats.readsPerFrame.reduce((a, b) => a + b, 0) / this.stats.readsPerFrame.length
    this.stats.avgWritesPerFrame = this.stats.writesPerFrame.reduce((a, b) => a + b, 0) / this.stats.writesPerFrame.length
    
    // Clear operations
    this.readOperations.clear()
    this.writeOperations.clear()
  }

  // Cancel a specific operation
  cancel(operationId) {
    for (const operation of this.readOperations) {
      if (operation.id === operationId) {
        this.readOperations.delete(operation)
        return true
      }
    }
    
    for (const operation of this.writeOperations) {
      if (operation.id === operationId) {
        this.writeOperations.delete(operation)
        return true
      }
    }
    
    return false
  }

  // Clear all operations
  clear() {
    this.readOperations.clear()
    this.writeOperations.clear()
    
    if (this.scheduled) {
      cancelAnimationFrame(this.frameId)
      this.scheduled = false
    }
  }

  // Get performance statistics
  getStats() {
    return {
      ...this.stats,
      pendingReads: this.readOperations.size,
      pendingWrites: this.writeOperations.size,
      scheduled: this.scheduled
    }
  }

  // Force immediate flush (useful for testing)
  forceFlush() {
    if (this.scheduled) {
      cancelAnimationFrame(this.frameId)
      this.flush(performance.now())
    }
  }
}

// React hook for using RAF batcher
export function useRAFBatcher() {
  const batcher = useRef(new RAFBatcher()).current
  
  useEffect(() => {
    return () => {
      batcher.clear()
    }
  }, [batcher])
  
  return batcher
}

// Market data update batching
export function useMarketDataBatcher() {
  const batcher = useRAFBatcher()
  const updateQueue = useRef(new Map())
  
  const updateMarketPrice = useCallback((symbol, price, change, volume) => {
    // Queue the update
    updateQueue.current.set(symbol, { price, change, volume })
    
    // Schedule DOM write operation
    batcher.scheduleWrite((timestamp) => {
      const updates = Array.from(updateQueue.current.entries())
      updateQueue.current.clear()
      
      updates.forEach(([symbol, data]) => {
        // Update price elements
        const priceElement = document.querySelector(`[data-symbol="${symbol}"][data-type="price"]`)
        if (priceElement) {
          priceElement.textContent = `$${data.price.toFixed(2)}`
          priceElement.className = data.change >= 0 ? 'price-positive' : 'price-negative'
        }
        
        // Update change elements
        const changeElement = document.querySelector(`[data-symbol="${symbol}"][data-type="change"]`)
        if (changeElement) {
          changeElement.textContent = `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}%`
          changeElement.className = data.change >= 0 ? 'change-positive' : 'change-negative'
        }
        
        // Update volume elements
        const volumeElement = document.querySelector(`[data-symbol="${symbol}"][data-type="volume"]`)
        if (volumeElement) {
          volumeElement.textContent = formatVolume(data.volume)
        }
      })
    }, 'high')
  }, [batcher])
  
  const updateBatchPrices = useCallback((updates) => {
    Object.entries(updates).forEach(([symbol, data]) => {
      updateMarketPrice(symbol, data.price, data.change, data.volume)
    })
  }, [updateMarketPrice])
  
  return { updateMarketPrice, updateBatchPrices }
}

// Animation batching for smooth transitions
export function useAnimationBatcher() {
  const batcher = useRAFBatcher()
  const animations = useRef(new Map())
  
  const animateElement = useCallback((element, properties, duration = 300) => {
    const animationId = `${element.id || 'element'}-${Date.now()}`
    
    batcher.scheduleWrite((timestamp) => {
      const startTime = timestamp
      const startValues = {}
      
      // Read initial values
      Object.keys(properties).forEach(prop => {
        const computedStyle = window.getComputedStyle(element)
        startValues[prop] = computedStyle[prop]
      })
      
      // Schedule animation frames
      const animate = (currentTime) => {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1)
        
        batcher.scheduleWrite(() => {
          Object.entries(properties).forEach(([prop, endValue]) => {
            const startValue = startValues[prop]
            const currentValue = lerp(startValue, endValue, progress)
            element.style[prop] = currentValue
          })
        }, 'high')
        
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          animations.current.delete(animationId)
        }
      }
      
      requestAnimationFrame(animate)
      animations.current.set(animationId, { element, properties, duration })
    })
    
    return animationId
  }, [batcher])
  
  const cancelAnimation = useCallback((animationId) => {
    animations.current.delete(animationId)
  }, [])
  
  return { animateElement, cancelAnimation }
}

// Utility functions
function lerp(start, end, progress) {
  if (typeof start === 'number' && typeof end === 'number') {
    return start + (end - start) * progress
  }
  
  // Handle CSS values (e.g., colors, transforms)
  return end // Simplified for now
}

function formatVolume(volume) {
  if (volume >= 1000000) {
    return `${(volume / 1000000).toFixed(1)}M`
  } else if (volume >= 1000) {
    return `${(volume / 1000).toFixed(1)}K`
  }
  return volume.toString()
}

// Performance monitoring for RAF batching
export function useRAFPerformanceMonitor() {
  const batcher = useRAFBatcher()
  const [stats, setStats] = useState(batcher.getStats())
  
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(batcher.getStats())
    }, 1000)
    
    return () => clearInterval(interval)
  }, [batcher])
  
  return stats
}

// Global instance for non-React usage
const globalBatcher = new RAFBatcher()

export default globalBatcher
