import { useState, useEffect, useCallback } from 'react'

// Worker Service for Offloading Heavy Computations
class WorkerService {
  constructor() {
    this.workers = new Map()
    this.taskQueue = new Map()
    this.taskCallbacks = new Map()
    this.taskId = 0
  }

  // Get or create a worker instance
  getWorker(workerType) {
    if (!this.workers.has(workerType)) {
      const workerUrl = `/workers/${workerType}.js`
      const worker = new Worker(workerUrl)
      
      worker.addEventListener('message', (e) => {
        this.handleWorkerMessage(workerType, e.data)
      })
      
      worker.addEventListener('error', (e) => {
        console.error(`Worker error (${workerType}):`, e.error)
      })
      
      this.workers.set(workerType, worker)
    }
    
    return this.workers.get(workerType)
  }

  // Handle messages from workers
  handleWorkerMessage(workerType, data) {
    const { id, type, result, error } = data
    
    if (this.taskCallbacks.has(id)) {
      const callback = this.taskCallbacks.get(id)
      this.taskCallbacks.delete(id)
      
      if (type === 'SUCCESS') {
        callback(null, result)
      } else if (type === 'ERROR') {
        callback(new Error(error))
      }
    }
  }

  // Execute a task in a worker
  async executeTask(workerType, taskType, data, options = {}) {
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskId
      const timeout = options.timeout || 30000 // 30 seconds default
      
      // Store callback
      this.taskCallbacks.set(taskId, (error, result) => {
        if (error) {
          reject(error)
        } else {
          resolve(result)
        }
      })
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        if (this.taskCallbacks.has(taskId)) {
          this.taskCallbacks.delete(taskId)
          reject(new Error(`Worker task timed out after ${timeout}ms`))
        }
      }, timeout)
      
      // Send task to worker
      try {
        const worker = this.getWorker(workerType)
        worker.postMessage({
          id: taskId,
          type: taskType,
          data
        })
        
        // Clear timeout on successful completion
        this.taskCallbacks.set(taskId, (error, result) => {
          clearTimeout(timeoutId)
          if (error) {
            reject(error)
          } else {
            resolve(result)
          }
        })
        
      } catch (error) {
        clearTimeout(timeoutId)
        this.taskCallbacks.delete(taskId)
        reject(error)
      }
    })
  }

  // Calculate trading signals using worker
  async calculateSignals(strategy, marketData) {
    const taskType = `CALCULATE_${strategy.toUpperCase()}_SIGNALS`
    return this.executeTask('signalCalculator', taskType, marketData)
  }

  // Calculate technical indicators using worker
  async calculateIndicators(prices, indicators) {
    return this.executeTask('signalCalculator', 'CALCULATE_INDICATORS', {
      prices,
      indicators
    })
  }

  // Batch process multiple tickers
  async batchCalculateSignals(strategy, tickerData) {
    const promises = Object.entries(tickerData).map(([ticker, data]) => 
      this.calculateSignals(strategy, data)
        .then(signals => ({ ticker, signals }))
        .catch(error => ({ ticker, error: error.message }))
    )
    
    return Promise.all(promises)
  }

  // Terminate all workers
  terminateAll() {
    this.workers.forEach(worker => {
      worker.terminate()
    })
    this.workers.clear()
    this.taskCallbacks.clear()
  }

  // Get worker statistics
  getStats() {
    return {
      activeWorkers: this.workers.size,
      pendingTasks: this.taskCallbacks.size,
      totalTasks: this.taskId
    }
  }
}

// React hook for using worker service
export function useWorkerService() {
  const [workerService] = useState(() => new WorkerService())
  
  useEffect(() => {
    return () => {
      workerService.terminateAll()
    }
  }, [workerService])
  
  return workerService
}

// Signal calculation hook
export function useSignalCalculation() {
  const workerService = useWorkerService()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const calculateSignals = useCallback(async (strategy, marketData) => {
    setLoading(true)
    setError(null)
    
    try {
      const signals = await workerService.calculateSignals(strategy, marketData)
      return signals
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [workerService])
  
  const calculateIndicators = useCallback(async (prices, indicators) => {
    setLoading(true)
    setError(null)
    
    try {
      const result = await workerService.calculateIndicators(prices, indicators)
      return result
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [workerService])
  
  return {
    calculateSignals,
    calculateIndicators,
    loading,
    error
  }
}

export default WorkerService
