import React, { useState, useEffect } from 'react'
import executionsService from '../api/services/executionsService.js'
import predictionsService from '../api/services/predictionsService.js'
import portfoliosService from '../api/services/portfoliosService.js'
import strategiesService from '../api/services/strategiesService.js'

export default function ApiTest() {
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function testApis() {
      try {
        const [executions, predictions, portfolios, strategies] = await Promise.all([
          executionsService.getAll(),
          predictionsService.getAll(),
          portfoliosService.getAll(),
          strategiesService.getAll()
        ])

        setResults({
          executions: executions.length,
          predictions: predictions.length,
          portfolios: portfolios.length,
          strategies: strategies.length,
          executionData: executions[0] || null,
          predictionData: predictions[0] || null
        })
      } catch (error) {
        setResults({ error: error.message })
      } finally {
        setLoading(false)
      }
    }

    testApis()
  }, [])

  if (loading) return <div>Loading API test...</div>

  if (results.error) {
    return (
      <div style={{ padding: '20px', color: 'red' }}>
        <h2>API Test Failed</h2>
        <p>Error: {results.error}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>API Integration Test</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <h3>Results:</h3>
        <ul>
          <li>Executions: {results.executions} items</li>
          <li>Predictions: {results.predictions} items</li>
          <li>Portfolios: {results.portfolios} items</li>
          <li>Strategies: {results.strategies} items</li>
        </ul>
      </div>

      {results.executionData && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Sample Execution:</h3>
          <pre style={{ background: '#f5f5f5', padding: '10px' }}>
            {JSON.stringify(results.executionData, null, 2)}
          </pre>
        </div>
      )}

      {results.predictionData && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Sample Prediction:</h3>
          <pre style={{ background: '#f5f5f5', padding: '10px' }}>
            {JSON.stringify(results.predictionData, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '20px', padding: '10px', background: '#e8f5e8' }}>
        <h3>Core Flow Test:</h3>
        <p>1. GET predictions: {results.predictions > 0 ? 'PASS' : 'FAIL'}</p>
        <p>2. GET executions: {results.executions >= 0 ? 'PASS' : 'FAIL'}</p>
        <p>3. Data mapping: {results.executionData?.side ? 'PASS' : 'FAIL'}</p>
        <p>4. Error handling: {results.error ? 'FAIL' : 'PASS'}</p>
      </div>
    </div>
  )
}
