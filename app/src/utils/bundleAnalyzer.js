// Bundle Size Analysis and Optimization Utilities
import { analyzeBuild } from 'vite-bundle-analyzer'

// Bundle size analysis script
export const analyzeBundle = async (buildDir = 'dist') => {
  try {
    const stats = await analyzeBuild({
      bundleDir: `${buildDir}/.vite`,
      analyzerMode: 'static',
      openAnalyzer: false,
      generateStatsFile: true,
      statsFilename: `${buildDir}/bundle-stats.json`
    })
    
    return stats
  } catch (error) {
    console.error('Bundle analysis failed:', error)
    return null
  }
}

// Bundle size monitoring
export const monitorBundleSize = (thresholds = {
  total: 2500000, // 2.5MB
  chunk: 500000,  // 500KB
  asset: 100000   // 100KB
}) => {
  return {
    name: 'bundle-size',
    generateBundle(options, bundle) {
      const chunks = []
      const assets = []
      let totalSize = 0

      // Analyze chunks
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName.endsWith('.js') || fileName.endsWith('.css')) {
          const size = chunk.code ? chunk.code.length : 0
          totalSize += size
          chunks.push({ name: fileName, size })
          
          if (size > thresholds.chunk) {
            console.warn(`Large chunk detected: ${fileName} (${formatBytes(size)})`)
          }
        }
      }

      // Analyze assets
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type === 'asset') {
          const size = asset.source ? asset.source.length : 0
          totalSize += size
          assets.push({ name: fileName, size })
          
          if (size > thresholds.asset) {
            console.warn(`Large asset detected: ${fileName} (${formatBytes(size)})`)
          }
        }
      }

      // Check total size
      if (totalSize > thresholds.total) {
        console.warn(`Large bundle size detected: ${formatBytes(totalSize)} (threshold: ${formatBytes(thresholds.total)})`)
      }

      console.log(`Bundle analysis: ${formatBytes(totalSize)} total, ${chunks.length} chunks, ${assets.length} assets`)
      
      return {
        totalSize,
        chunks,
        assets,
        warnings: []
      }
    }
  }
}

// Format bytes for human readable output
export const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

// Dynamic import optimization
export const createLazyComponent = (importFn, fallback = null) => {
  return React.lazy(() => {
    return importFn().catch(error => {
      console.error('Failed to load component:', error)
      return fallback ? { default: fallback } : { default: () => null }
    })
  })
}

// Route-based code splitting helper
export const createLazyRoute = (componentPath, fallback = null) => {
  return createLazyComponent(() => import(componentPath), fallback)
}

// Preload critical components
export const preloadComponent = (importFn) => {
  return () => {
    // Start loading the component in the background
    importFn()
  }
}

// Bundle optimization recommendations
export const getOptimizationRecommendations = (bundleStats) => {
  const recommendations = []
  
  if (!bundleStats) return recommendations
  
  // Check for large chunks
  const largeChunks = bundleStats.chunks?.filter(chunk => chunk.size > 500000) || []
  if (largeChunks.length > 0) {
    recommendations.push({
      type: 'chunk-size',
      severity: 'high',
      message: `Found ${largeChunks.length} large chunks (>500KB). Consider code splitting.`,
      chunks: largeChunks
    })
  }
  
  // Check for duplicate dependencies
  const duplicateDeps = analyzeDuplicateDependencies(bundleStats)
  if (duplicateDeps.length > 0) {
    recommendations.push({
      type: 'duplicate-deps',
      severity: 'medium',
      message: `Found duplicate dependencies. Consider deduplication.`,
      dependencies: duplicateDeps
    })
  }
  
  // Check for unused assets
  const unusedAssets = analyzeUnusedAssets(bundleStats)
  if (unusedAssets.length > 0) {
    recommendations.push({
      type: 'unused-assets',
      severity: 'low',
      message: `Found ${unusedAssets.length} potentially unused assets.`,
      assets: unusedAssets
    })
  }
  
  return recommendations
}

// Analyze duplicate dependencies
const analyzeDuplicateDependencies = (bundleStats) => {
  const deps = {}
  const duplicates = []
  
  // This would need actual bundle analysis implementation
  // For now, return empty array
  return duplicates
}

// Analyze unused assets
const analyzeUnusedAssets = (bundleStats) => {
  const assets = []
  
  // This would need actual asset analysis implementation
  // For now, return empty array
  return assets
}

// Bundle optimization script
export const optimizeBundle = async () => {
  console.log('Starting bundle optimization...')
  
  // Run bundle analysis
  const stats = await analyzeBundle()
  if (!stats) {
    console.error('Bundle analysis failed')
    return
  }
  
  // Get recommendations
  const recommendations = getOptimizationRecommendations(stats)
  
  if (recommendations.length === 0) {
    console.log('No optimization recommendations found')
    return
  }
  
  console.log('Optimization recommendations:')
  recommendations.forEach((rec, index) => {
    console.log(`${index + 1}. [${rec.severity.toUpperCase()}] ${rec.message}`)
  })
  
  return recommendations
}

// Performance budget monitoring
export const createPerformanceBudget = (budget = {
  totalSize: 2500000,
  chunkSize: 500000,
  assetSize: 100000,
  loadTime: 3000
}) => {
  return {
    checkBudget: (metrics) => {
      const violations = []
      
      if (metrics.totalSize > budget.totalSize) {
        violations.push({
          type: 'total-size',
          actual: metrics.totalSize,
          budget: budget.totalSize,
          exceeded: metrics.totalSize - budget.totalSize
        })
      }
      
      if (metrics.maxChunkSize > budget.chunkSize) {
        violations.push({
          type: 'chunk-size',
          actual: metrics.maxChunkSize,
          budget: budget.chunkSize,
          exceeded: metrics.maxChunkSize - budget.chunkSize
        })
      }
      
      if (metrics.maxAssetSize > budget.assetSize) {
        violations.push({
          type: 'asset-size',
          actual: metrics.maxAssetSize,
          budget: budget.assetSize,
          exceeded: metrics.maxAssetSize - budget.assetSize
        })
      }
      
      return violations
    }
  }
}

// Real-time bundle monitoring
export const setupBundleMonitoring = () => {
  if (typeof window !== 'undefined' && 'performance' in window) {
    // Monitor resource loading
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      
      entries.forEach(entry => {
        if (entry.name.includes('.js') || entry.name.includes('.css')) {
          console.log(`Resource loaded: ${entry.name} (${formatBytes(entry.transferSize || 0)})`)
        }
      })
    })
    
    observer.observe({ entryTypes: ['resource'] })
    
    return observer
  }
  
  return null
}

export default {
  analyzeBundle,
  monitorBundleSize,
  formatBytes,
  createLazyComponent,
  createLazyRoute,
  preloadComponent,
  getOptimizationRecommendations,
  optimizeBundle,
  createPerformanceBudget,
  setupBundleMonitoring
}
