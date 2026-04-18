import React, { useState } from 'react'
import executionsService from '../api/services/executionsService.js'
import predictionsService from '../api/services/predictionsService.js'
import { getPositions } from '../services/derivePositions.js'

export default function ExecutionTest() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  async function testExecutionFlow() {
    setLoading(true)
    try {
      // Step 1: Get predictions
      const predictions = await predictionsService.getAll()
      const firstPrediction = predictions[0]
      
      // Step 2: Create execution
      const execution = await executionsService.create({
        portfolioId: 'prt_demo',
        strategyId: 'str_demo',
        signalId: firstPrediction?.id || 'pred_demo',
        ticker: 'NVDA',
        side: 'BUY',
        quantity: 10,
        price: 100
      })
      
      // Step 3: Get all executions
      const allExecutions = await executionsService.getAll()
      
      // Step 4: Derive positions
      const positions = await getPositions()
      
      setResult({
        step1: {
          predictions: predictions.length,
          firstPrediction: firstPrediction?.ticker || 'none'
        },
        step2: {
          created: !!execution,
          executionId: execution?.id,
          mappedSide: execution?.side
        },
        step3: {
          totalExecutions: allExecutions.length,
          latestExecution: allExecutions[0]?.id
        },
        step4: {
          positions: positions.length,
          firstPosition: positions[0]?.ticker || 'none'
        }
      })
    } catch (error) {
      setResult({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Execution Flow Test</h2>
      
      <button 
        onClick={testExecutionFlow}
        disabled={loading}
        style={{ 
          padding: '10px 20px', 
          marginBottom: '20px',
          backgroundColor: loading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px'
        }}
      >
        {loading ? 'Testing...' : 'Test Complete Flow'}
      </button>

      {result?.error && (
        <div style={{ color: 'red', marginBottom: '20px' }}>
          <h3>Error:</h3>
          <p>{result.error}</p>
        </div>
      )}

      {result && !result.error && (
        <div>
          <h3>Test Results:</h3>
          
          <div style={{ marginBottom: '15px', padding: '10px', background: '#f8f9fa' }}>
            <h4>Step 1: Get Predictions</h4>
            <p>Predictions found: {result.step1.predictions}</p>
            <p>First prediction ticker: {result.step1.firstPrediction}</p>
          </div>

          <div style={{ marginBottom: '15px', padding: '10px', background: '#f8f9fa' }}>
            <h4>Step 2: Create Execution</h4>
            <p>Execution created: {result.step2.created ? 'YES' : 'NO'}</p>
            <p>Execution ID: {result.step2.executionId}</p>
            <p>Mapped side: {result.step2.mappedSide}</p>
          </div>

          <div style={{ marginBottom: '15px', padding: '10px', background: '#f8f9fa' }}>
            <h4>Step 3: Get Executions</h4>
            <p>Total executions: {result.step3.totalExecutions}</p>
            <p>Latest execution: {result.step3.latestExecution}</p>
          </div>

          <div style={{ marginBottom: '15px', padding: '10px', background: '#f8f9fa' }}>
            <h4>Step 4: Derive Positions</h4>
            <p>Positions calculated: {result.step4.positions}</p>
            <p>First position: {result.step4.firstPosition}</p>
          </div>

          <div style={{ padding: '10px', background: '#d4edda', border: '1px solid #c3e6cb' }}>
            <h4>Overall Result:</h4>
            <p>Core flow working: {
              result.step1.predictions >= 0 && 
              result.step2.created && 
              result.step3.totalExecutions >= 0 && 
              result.step4.positions >= 0 ? 'PASS' : 'FAIL'
            }</p>
          </div>
        </div>
      )}
    </div>
  )
}
