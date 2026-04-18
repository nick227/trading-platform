import { useState, useEffect } from 'react'
import predictionsService from '../api/services/predictionsService.js'

export function usePredictions() {
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchPredictions = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await predictionsService.getAll()
      setPredictions(data)
    } catch (err) {
      setError(err.message)
      setPredictions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPredictions()
  }, [])

  return { predictions, loading, error, refetch: fetchPredictions }
}
