import { useState, useEffect } from 'react'
import executionsService from '../api/services/executionsService.js'
import { useConditionalPolling } from './usePolling.js'

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

  useEffect(() => {
    fetchExecutions()
  }, [])

  useConditionalPolling(fetchExecutions, 5000, poll)

  return { executions, loading, error, refetch: fetchExecutions, createExecution }
}
