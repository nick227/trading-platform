import { useState, useEffect, useRef, useCallback } from 'react'

// Comprehensive Performance Monitoring System
// Tracks real-time performance metrics and provides insights

class PerformanceMonitor {
  constructor(options = {}) {
    this.metrics = new Map()
    this.observers = new Map()
    this.thresholds = options.thresholds || {}
    this.alertCallbacks = new Set()
    this.isMonitoring = false
    this.monitoringInterval = options.interval || 1000
    this.maxHistorySize = options.maxHistorySize || 1000
    
    this.stats = {
      startTime: Date.now(),
      totalMeasurements: 0,
      alertsTriggered: 0,
      averageResponseTime: 0,
      memoryUsage: [],
      frameRates: []
    }
  }

  // Start performance monitoring
  startMonitoring() {
    if (this.isMonitoring) return
    
    this.isMonitoring = true
    this.stats.startTime = Date.now()
    
    // Monitor Core Web Vitals
    this.monitorWebVitals()
    
    // Monitor memory usage
    this.monitorMemoryUsage()
    
    // Monitor frame rate
    this.monitorFrameRate()
    
    // Monitor network performance
    this.monitorNetworkPerformance()
    
    // Start periodic collection
    this.startPeriodicCollection()
    
    console.log('Performance monitoring started')
  }

  // Stop performance monitoring
  stopMonitoring() {
    this.isMonitoring = false
    
    // Disconnect all observers
    this.observers.forEach(observer => {
      observer.disconnect()
    })
    this.observers.clear()
    
    console.log('Performance monitoring stopped')
  }

  // Monitor Core Web Vitals
  monitorWebVitals() {
    // Largest Contentful Paint (LCP)
    this.observePerformanceEntry('largest-contentful-paint', (entries) => {
      entries.forEach(entry => {
        this.recordMetric('LCP', entry.startTime, { 
          element: entry.element?.tagName,
          url: entry.url 
        })
      })
    })

    // First Input Delay (FID)
    this.observePerformanceEntry('first-input', (entries) => {
      entries.forEach(entry => {
        this.recordMetric('FID', entry.processingStart - entry.startTime, {
          eventType: entry.name,
          inputType: entry.inputType
        })
      })
    })

    // Cumulative Layout Shift (CLS)
    let clsValue = 0
    this.observePerformanceEntry('layout-shift', (entries) => {
      entries.forEach(entry => {
        if (!entry.hadRecentInput) {
          clsValue += entry.value
          this.recordMetric('CLS', clsValue, {
            sources: entry.sources?.length || 0,
            lastShift: entry.value
          })
        }
      })
    })

    // Time to First Byte (TTFB)
    this.observeNavigationEntry((entries) => {
      entries.forEach(entry => {
        const ttfb = entry.responseStart - entry.requestStart
        this.recordMetric('TTFB', ttfb, {
          domain: entry.name,
          protocol: entry.nextHopProtocol
        })
      })
    })
  }

  // Observe performance entries
  observePerformanceEntry(type, callback) {
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        callback(list.getEntries())
      })
      
      observer.observe({ type, buffered: true })
      this.observers.set(type, observer)
    }
  }

  // Observe navigation entries
  observeNavigationEntry(callback) {
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        callback(list.getEntries())
      })
      
      observer.observe({ type: 'navigation', buffered: true })
      this.observers.set('navigation', observer)
    }
  }

  // Monitor memory usage
  monitorMemoryUsage() {
    if ('memory' in performance) {
      const recordMemory = () => {
        const memory = performance.memory
        this.recordMetric('memory', memory.usedJSHeapSize, {
          total: memory.totalJSHeapSize,
          limit: memory.jsHeapSizeLimit,
          usage: (memory.usedJSHeapSize / memory.jsHeapSizeLimit * 100).toFixed(2)
        })
        
        this.stats.memoryUsage.push({
          timestamp: Date.now(),
          used: memory.usedJSHeapSize,
          total: memory.totalJSHeapSize
        })
        
        // Keep only recent history
        if (this.stats.memoryUsage.length > this.maxHistorySize) {
          this.stats.memoryUsage.shift()
        }
      }
      
      // Record memory every 5 seconds
      setInterval(recordMemory, 5000)
      recordMemory() // Initial recording
    }
  }

  // Monitor frame rate
  monitorFrameRate() {
    let lastTime = performance.now()
    let frameCount = 0
    
    const measureFrameRate = (currentTime) => {
      frameCount++
      
      if (currentTime - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime))
        
        this.recordMetric('fps', fps, {
          frameCount,
          duration: currentTime - lastTime
        })
        
        this.stats.frameRates.push({
          timestamp: Date.now(),
          fps,
          frameCount
        })
        
        // Keep only recent history
        if (this.stats.frameRates.length > this.maxHistorySize) {
          this.stats.frameRates.shift()
        }
        
        // Check for performance issues
        if (fps < 30) {
          this.triggerAlert('LOW_FPS', `Frame rate dropped to ${fps}fps`, { fps })
        }
        
        frameCount = 0
        lastTime = currentTime
      }
      
      if (this.isMonitoring) {
        requestAnimationFrame(measureFrameRate)
      }
    }
    
    requestAnimationFrame(measureFrameRate)
  }

  // Monitor network performance
  monitorNetworkPerformance() {
    // Monitor resource loading
    this.observePerformanceEntry('resource', (entries) => {
      entries.forEach(entry => {
        const duration = entry.responseEnd - entry.startTime
        this.recordMetric('resource-load', duration, {
          name: entry.name,
          type: entry.initiatorType,
          size: entry.transferSize,
          cached: entry.transferSize === 0 && entry.decodedBodySize > 0
        })
        
        // Alert on slow resources
        if (duration > 3000) {
          this.triggerAlert('SLOW_RESOURCE', `Slow resource: ${entry.name}`, {
            name: entry.name,
            duration
          })
        }
      })
    })
  }

  // Record a performance metric
  recordMetric(name, value, metadata = {}) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, [])
    }
    
    const metricData = {
      timestamp: Date.now(),
      value,
      metadata
    }
    
    this.metrics.get(name).push(metricData)
    this.stats.totalMeasurements++
    
    // Check thresholds
    this.checkThresholds(name, value, metadata)
    
    // Keep only recent history
    const history = this.metrics.get(name)
    if (history.length > this.maxHistorySize) {
      history.shift()
    }
  }

  // Check performance thresholds
  checkThresholds(name, value, metadata) {
    const threshold = this.thresholds[name]
    if (threshold) {
      if (typeof threshold === 'number' && value > threshold) {
        this.triggerAlert('THRESHOLD_EXCEEDED', `${name} exceeded threshold`, {
          metric: name,
          value,
          threshold,
          metadata
        })
      } else if (typeof threshold === 'object') {
        if (threshold.min && value < threshold.min) {
          this.triggerAlert('THRESHOLD_EXCEEDED', `${name} below minimum threshold`, {
            metric: name,
            value,
            threshold: threshold.min,
            metadata
          })
        } else if (threshold.max && value > threshold.max) {
          this.triggerAlert('THRESHOLD_EXCEEDED', `${name} above maximum threshold`, {
            metric: name,
            value,
            threshold: threshold.max,
            metadata
          })
        }
      }
    }
  }

  // Trigger performance alert
  triggerAlert(type, message, data) {
    const alert = {
      id: Date.now().toString(),
      type,
      message,
      data,
      timestamp: Date.now()
    }
    
    this.stats.alertsTriggered++
    
    // Notify all alert callbacks
    this.alertCallbacks.forEach(callback => {
      try {
        callback(alert)
      } catch (error) {
        console.error('Alert callback error:', error)
      }
    })
  }

  // Start periodic collection
  startPeriodicCollection() {
    const collect = () => {
      if (!this.isMonitoring) return
      
      // Collect current performance metrics
      if (performance.timing) {
        const timing = performance.timing
        const loadTime = timing.loadEventEnd - timing.navigationStart
        this.recordMetric('page-load-time', loadTime)
      }
      
      // Collect navigation timing
      if (performance.navigation) {
        const navigation = performance.navigation
        this.recordMetric('navigation-type', navigation.type, {
          redirectCount: navigation.redirectCount
        })
      }
    }
    
    setInterval(collect, this.monitoringInterval)
  }

  // Add alert callback
  onAlert(callback) {
    this.alertCallbacks.add(callback)
    return () => this.alertCallbacks.delete(callback)
  }

  // Get performance metrics
  getMetrics(name = null) {
    if (name) {
      return this.metrics.get(name) || []
    }
    
    const allMetrics = {}
    this.metrics.forEach((values, key) => {
      allMetrics[key] = values
    })
    
    return allMetrics
  }

  // Get metric statistics
  getMetricStats(name) {
    const values = this.metrics.get(name)
    if (!values || values.length === 0) {
      return null
    }
    
    const numericValues = values.map(v => v.value).filter(v => typeof v === 'number')
    
    if (numericValues.length === 0) {
      return null
    }
    
    const sorted = numericValues.sort((a, b) => a - b)
    const sum = numericValues.reduce((a, b) => a + b, 0)
    
    return {
      count: numericValues.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      average: sum / numericValues.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      latest: values[values.length - 1]
    }
  }

  // Get overall performance score
  getPerformanceScore() {
    const scores = {}
    
    // LCP score (Good: <2.5s, Needs Improvement: 2.5s-4s, Poor: >4s)
    const lcpStats = this.getMetricStats('LCP')
    if (lcpStats) {
      if (lcpStats.average < 2500) scores.LCP = 100
      else if (lcpStats.average < 4000) scores.LCP = 50
      else scores.LCP = 0
    }
    
    // FID score (Good: <100ms, Needs Improvement: 100-300ms, Poor: >300ms)
    const fidStats = this.getMetricStats('FID')
    if (fidStats) {
      if (fidStats.average < 100) scores.FID = 100
      else if (fidStats.average < 300) scores.FID = 50
      else scores.FID = 0
    }
    
    // CLS score (Good: <0.1, Needs Improvement: 0.1-0.25, Poor: >0.25)
    const clsStats = this.getMetricStats('CLS')
    if (clsStats) {
      if (clsStats.average < 0.1) scores.CLS = 100
      else if (clsStats.average < 0.25) scores.CLS = 50
      else scores.CLS = 0
    }
    
    // FPS score (Good: >55, Needs Improvement: 30-55, Poor: <30)
    const fpsStats = this.getMetricStats('fps')
    if (fpsStats) {
      if (fpsStats.average > 55) scores.FPS = 100
      else if (fpsStats.average > 30) scores.FPS = 50
      else scores.FPS = 0
    }
    
    // Calculate overall score
    const validScores = Object.values(scores).filter(s => s !== undefined)
    const overallScore = validScores.length > 0 
      ? validScores.reduce((a, b) => a + b, 0) / validScores.length 
      : 0
    
    return {
      ...scores,
      overall: Math.round(overallScore),
      grade: this.getPerformanceGrade(overallScore)
    }
  }

  // Get performance grade
  getPerformanceGrade(score) {
    if (score >= 90) return 'A'
    if (score >= 80) return 'B'
    if (score >= 70) return 'C'
    if (score >= 60) return 'D'
    return 'F'
  }

  // Get comprehensive report
  getReport() {
    const score = this.getPerformanceScore()
    const metrics = {}
    
    this.metrics.forEach((values, name) => {
      metrics[name] = this.getMetricStats(name)
    })
    
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.stats.startTime,
      score,
      metrics,
      stats: { ...this.stats },
      alerts: this.getRecentAlerts()
    }
  }

  // Get recent alerts
  getRecentAlerts(limit = 10) {
    const allAlerts = []
    
    // This would need to be implemented to track alerts
    // For now, return empty array
    return allAlerts.slice(-limit)
  }

  // Export performance data
  exportData(format = 'json') {
    const report = this.getReport()
    
    if (format === 'json') {
      return JSON.stringify(report, null, 2)
    } else if (format === 'csv') {
      return this.convertToCSV(report)
    }
    
    return report
  }

  // Convert report to CSV
  convertToCSV(report) {
    const headers = ['Metric', 'Count', 'Average', 'Min', 'Max', 'P95', 'P99']
    const rows = [headers.join(',')]
    
    Object.entries(report.metrics).forEach(([name, stats]) => {
      if (stats) {
        rows.push([
          name,
          stats.count,
          stats.average?.toFixed(2) || '',
          stats.min?.toFixed(2) || '',
          stats.max?.toFixed(2) || '',
          stats.p95?.toFixed(2) || '',
          stats.p99?.toFixed(2) || ''
        ].join(','))
      }
    })
    
    return rows.join('\n')
  }
}

// React hook for performance monitoring
export function usePerformanceMonitor(options = {}) {
  const monitor = useRef(new PerformanceMonitor(options)).current
  const [report, setReport] = useState(null)
  const [alerts, setAlerts] = useState([])
  
  useEffect(() => {
    monitor.startMonitoring()
    
    // Set up alert listener
    const unsubscribe = monitor.onAlert((alert) => {
      setAlerts(prev => [...prev.slice(-9), alert])
    })
    
    // Update report periodically
    const interval = setInterval(() => {
      setReport(monitor.getReport())
    }, 5000)
    
    return () => {
      monitor.stopMonitoring()
      unsubscribe()
      clearInterval(interval)
    }
  }, [monitor])
  
  return {
    report,
    alerts,
    monitor,
    getMetrics: monitor.getMetrics.bind(monitor),
    getStats: monitor.getMetricStats.bind(monitor)
  }
}

// Performance monitoring for specific components
export function useComponentPerformance(componentName) {
  const monitor = usePerformanceMonitor()
  const startTime = useRef(Date.now())
  
  const measureRender = useCallback(() => {
    const renderTime = Date.now() - startTime.current
    monitor.recordMetric(`${componentName}-render`, renderTime)
    startTime.current = Date.now()
  }, [monitor, componentName])
  
  const measureInteraction = useCallback((action) => {
    const interactionTime = Date.now() - startTime.current
    monitor.recordMetric(`${componentName}-${action}`, interactionTime)
  }, [monitor, componentName])
  
  return {
    measureRender,
    measureInteraction
  }
}

export default PerformanceMonitor
