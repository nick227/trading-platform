// Loop consolidation and optimization service

// Single-pass multi-operation processor
export function createConsolidatedLoopProcessor(operations) {
  return (items) => {
    const results = {
      filtered: [],
      mapped: [],
      reduced: null,
      counted: 0,
      summed: 0,
      found: null,
      first: null,
      last: null
    }
    
    // Single pass through items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let shouldInclude = true
      let mappedItem = item
      
      // Apply all operations in single pass
      for (const operation of operations) {
        switch (operation.type) {
          case 'filter':
            if (!operation.fn(item, i)) {
              shouldInclude = false
              continue // Skip to next item
            }
            break
            
          case 'map':
            mappedItem = operation.fn(item, i)
            break
            
          case 'reduce':
            if (results.reduced === null) {
              results.reduced = operation.initialValue
            }
            results.reduced = operation.fn(results.reduced, item, i)
            break
            
          case 'count':
            if (operation.fn(item, i)) {
              results.counted++
            }
            break
            
          case 'sum':
            if (operation.fn(item, i)) {
              results.summed += operation.getValue(item, i)
            }
            break
            
          case 'find':
            if (results.found === null && operation.fn(item, i)) {
              results.found = item
            }
            break
            
          case 'first':
            if (results.first === null && operation.fn(item, i)) {
              results.first = item
            }
            break
            
          case 'last':
            if (operation.fn(item, i)) {
              results.last = item
            }
            break
        }
      }
      
      // Add to results if item passed all filters
      if (shouldInclude) {
        results.filtered.push(item)
        results.mapped.push(mappedItem)
      }
    }
    
    return results
  }
}

// Memory-efficient loop with object pooling
export function createPooledLoopProcessor(objectPool, processor) {
  return (items) => {
    const results = new Array(items.length)
    
    for (let i = 0; i < items.length; i++) {
      // Acquire object from pool
      const context = objectPool.acquire()
      
      try {
        // Process item with pooled context
        const result = processor(items[i], i, context)
        results[i] = result
      } finally {
        // Return object to pool
        objectPool.release(context)
      }
    }
    
    return results
  }
}

// Early-termination loop processor
export function createEarlyExitLoopProcessor(exitConditions, processor) {
  return (items) => {
    const results = []
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      
      // Check exit conditions
      for (const condition of exitConditions) {
        if (condition.fn(item, i)) {
          return {
            results,
            exited: true,
            reason: condition.reason,
            index: i,
            item
          }
        }
      }
      
      // Process item
      const result = processor(item, i)
      results.push(result)
    }
    
    return {
      results,
      exited: false,
      reason: null,
      index: -1,
      item: null
    }
  }
}

// Batch-processed loop for memory management
export function createBatchLoopProcessor(batchSize, processor, options = {}) {
  const { 
    memoryThreshold = 50 * 1024 * 1024, // 50MB
    gcInterval = 1000 // 1 second
  } = options
  
  return (items) => {
    const results = []
    let lastGc = Date.now()
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const batchResults = batch.map(processor)
      results.push(...batchResults)
      
      // Check memory and GC if needed
      const now = Date.now()
      if (now - lastGc > gcInterval) {
        if (global.gc) {
          global.gc()
        }
        lastGc = now
      }
    }
    
    return results
  }
}

// Parallelizable loop processor (for Web Workers)
export function createParallelLoopProcessor(workerCount, processor) {
  return (items) => {
    // Split items into chunks for parallel processing
    const chunkSize = Math.ceil(items.length / workerCount)
    const chunks = []
    
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize))
    }
    
    // For now, process sequentially (Web Workers would be implemented separately)
    const results = []
    for (const chunk of chunks) {
      const chunkResults = chunk.map(processor)
      results.push(...chunkResults)
    }
    
    return results
  }
}

// Optimized string processing loop
export function createStringLoopProcessor(processor) {
  return (strings) => {
    // Pre-allocate result array
    const results = new Array(strings.length)
    
    // Single pass with string optimization
    for (let i = 0; i < strings.length; i++) {
      const str = strings[i]
      
      // Avoid string concatenation in loops
      if (typeof str === 'string' && str.length > 0) {
        results[i] = processor(str, i)
      } else {
        results[i] = str
      }
    }
    
    return results
  }
}

// Numeric loop processor with pre-allocation
export function createNumericLoopProcessor(processor) {
  return (numbers) => {
    // Pre-allocate typed array for better performance
    const results = new Float64Array(numbers.length)
    
    for (let i = 0; i < numbers.length; i++) {
      const num = numbers[i]
      
      // Type checking and processing
      if (typeof num === 'number' && !isNaN(num)) {
        results[i] = processor(num, i)
      } else {
        results[i] = 0
      }
    }
    
    // Convert back to regular array
    return Array.from(results)
  }
}

// Consolidated data transformation loop
export function createTransformLoopProcessor(transformations) {
  return (items) => {
    // Group transformations by type for optimization
    const filters = transformations.filter(t => t.type === 'filter')
    const maps = transformations.filter(t => t.type === 'map')
    const validators = transformations.filter(t => t.type === 'validate')
    
    const results = []
    
    // Single pass with all transformations
    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      let isValid = true
      
      // Apply validators first
      for (const validator of validators) {
        if (!validator.fn(item, i)) {
          isValid = false
          break
        }
      }
      
      if (!isValid) continue
      
      // Apply filters
      for (const filter of filters) {
        if (!filter.fn(item, i)) {
          isValid = false
          break
        }
      }
      
      if (!isValid) continue
      
      // Apply maps
      for (const map of maps) {
        item = map.fn(item, i)
      }
      
      results.push(item)
    }
    
    return results
  }
}

// Memory-aware loop processor
export function createMemoryAwareLoopProcessor(options = {}) {
  const {
    maxMemoryUsage = 50 * 1024 * 1024, // 50MB
    gcThreshold = 0.8, // GC at 80% of max memory
    batchSize = 1000
  } = options
  
  let memoryUsage = 0
  
  return (processor) => {
    return (items) => {
      const results = []
      
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)
        const batchResults = batch.map(processor)
        results.push(...batchResults)
        
        // Estimate memory usage
        memoryUsage += batchResults.length * 100 // Rough estimate
        
        // Trigger GC if needed
        if (memoryUsage > maxMemoryUsage * gcThreshold) {
          if (global.gc) {
            global.gc()
          }
          memoryUsage = 0
        }
      }
      
      return results
    }
  }
}

// Loop performance analyzer
export function analyzeLoopPerformance(fn, testData) {
  const iterations = 1000
  const times = []
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn(testData)
    const end = performance.now()
    times.push(end - start)
  }
  
  const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  
  return {
    average: avgTime,
    min: minTime,
    max: maxTime,
    iterations,
    totalTime: times.reduce((sum, time) => sum + time, 0)
  }
}

// Consolidated loop utilities
export const LoopUtils = {
  // Find and map in single pass
  findMap: (items, predicate, mapper) => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (predicate(item, i)) {
        return mapper(item, i)
      }
    }
    return null
  },
  
  // Filter and map in single pass
  filterMap: (items, predicate, mapper) => {
    const results = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (predicate(item, i)) {
        results.push(mapper(item, i))
      }
    }
    return results
  },
  
  // Find and reduce in single pass
  findReduce: (items, predicate, reducer, initialValue) => {
    let result = initialValue
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (predicate(item, i)) {
        result = reducer(result, item, i)
      }
    }
    return result
  },
  
  // Count and sum in single pass
  countSum: (items, predicate, getValue) => {
    let count = 0
    let sum = 0
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (predicate(item, i)) {
        count++
        sum += getValue(item, i)
      }
    }
    return { count, sum }
  },
  
  // Min and max in single pass
  minMax: (items, getValue) => {
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < items.length; i++) {
      const value = getValue(items[i], i)
      if (value < min) min = value
      if (value > max) max = value
    }
    return { min, max }
  }
}
