import { useState, useEffect } from 'react'
import executionsService from '../api/services/executionsService.js'
import { usePolling } from './usePolling.js'

export function useExecutions(poll = true) {
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

  useEffect(() => {
    fetchExecutions()
  }, [])

  // Only poll executions (not strategies/portfolios)
  if (poll) {
    usePolling(fetchExecutions, 5000) // 5 second polling for executions only
  }

  return { executions, loading, error, refetch: fetchExecutions, createExecution }
}
