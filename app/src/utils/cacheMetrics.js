// Cache Metrics - Performance tracking and monitoring
// Separated for better modularity and testing

// Import globalCache for size calculation
import { globalCache } from './cacheCore.js'

// Performance metrics
export const metrics = {
  hits: 0,
  misses: 0,
  invalidations: 0,
  evictions: 0,
  totalRequests: 0,
  avgLatency: 0,
  get hitRate() { return this.totalRequests > 0 ? (this.hits / this.totalRequests) * 100 : 0 }
}

export function recordHit() {
  metrics.hits++
}

export function recordMiss() {
  metrics.misses++
}

export function recordInvalidation() {
  metrics.invalidations++
}

export function recordEviction() {
  metrics.evictions++
}

export function recordRequest(latency = 0) {
  metrics.totalRequests++
  if (latency > 0) {
    metrics.avgLatency = (metrics.avgLatency * (metrics.totalRequests - 1) + latency) / metrics.totalRequests
  }
}

export function getCacheMetrics() {
  return {
    ...metrics,
    cacheSize: globalCache.size(),
    maxKeys: 500, // Should match cacheCore max size
    memoryUsageEstimate: globalCache.size() * 1024 // Rough estimate
  }
}

export function resetMetrics() {
  metrics.hits = 0
  metrics.misses = 0
  metrics.invalidations = 0
  metrics.evictions = 0
  metrics.totalRequests = 0
  metrics.avgLatency = 0
}
