import { useState, useEffect } from 'react'
import executionsService from '../api/services/executionsService.js'
import { useSharedPolling } from './useSharedPolling.js'

export function useExecutions({ poll = false } = {}) {
  const [executions, setExecutions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchExecutions = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await executionsService.getAll()
      setExecutions(data)
    } catch (err) {
      setError(err.message)
      setExecutions([])
    } finally {
      setLoading(false)
    }
  }

  const createExecution = async (executionData) => {
    try {
      const execution = await executionsService.create(executionData)
      setExecutions(prev => [execution, ...prev])
      return execution
    } catch (err) {
      setError(err.message)
      throw err
    }
  }

  // Use shared polling with key 'executions' to dedupe across components
  const { data: sharedData, loading: sharedLoading, error: sharedError } = useSharedPolling(
    'executions',
    fetchExecutions,
    15000,
    poll,
    'useExecutions'
  )

  // Sync shared state with local state
  useEffect(() => {
    if (sharedData !== null) {
      setExecutions(sharedData)
    }
    setLoading(sharedLoading)
    setError(sharedError)
  }, [sharedData, sharedLoading, sharedError])

  return { executions, loading, error, refetch: fetchExecutions, createExecution }
}
