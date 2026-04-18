// Comprehensive test for derivePositions correctness

import { derivePositions } from '../services/derivePositions.js'
import { derivePositionsEfficient } from '../services/memoryEfficientData.js'

// Test case 1: Simple FIFO scenario
export function testFIFOCorrectness() {
  console.log('Testing FIFO correctness...')
  
  const executions = [
    {
      id: '1',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 100,
      price: 150,
      createdAt: new Date('2023-01-01T09:30:00Z').getTime()
    },
    {
      id: '2',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 50,
      price: 155,
      createdAt: new Date('2023-01-01T09:31:00Z').getTime()
    },
    {
      id: '3',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 75,
      price: 160,
      createdAt: new Date('2023-01-01T09:32:00Z').getTime()
    },
    {
      id: '4',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 25,
      price: 165,
      createdAt: new Date('2023-01-01T09:33:00Z').getTime()
    }
  ]
  
  const originalResult = derivePositions(executions)
  const optimizedResult = derivePositionsEfficient(executions)
  
  console.log('Original result:', originalResult)
  console.log('Optimized result:', optimizedResult)
  
  // Expected: 0 shares (100 + 50 - 75 - 25 = 0)
  // Expected avg cost: FIFO means first 75 shares at $150, then 25 shares at $155
  // So remaining 25 shares should have cost basis from the $155 batch
  
  const isCorrect = JSON.stringify(originalResult) === JSON.stringify(optimizedResult)
  console.log(`FIFO correctness: ${isCorrect ? 'PASS' : 'FAIL'}`)
  
  return { originalResult, optimizedResult, isCorrect }
}

// Test case 2: Multiple tickers
export function testMultipleTickers() {
  console.log('Testing multiple tickers...')
  
  const executions = [
    {
      id: '1',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 100,
      price: 150,
      createdAt: new Date('2023-01-01T09:30:00Z').getTime()
    },
    {
      id: '2',
      ticker: 'GOOGL',
      side: 'BUY',
      quantity: 50,
      price: 2500,
      createdAt: new Date('2023-01-01T09:31:00Z').getTime()
    },
    {
      id: '3',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 50,
      price: 160,
      createdAt: new Date('2023-01-01T09:32:00Z').getTime()
    },
    {
      id: '4',
      ticker: 'GOOGL',
      side: 'SELL',
      quantity: 25,
      price: 2600,
      createdAt: new Date('2023-01-01T09:33:00Z').getTime()
    }
  ]
  
  const originalResult = derivePositions(executions)
  const optimizedResult = derivePositionsEfficient(executions)
  
  console.log('Original result:', originalResult)
  console.log('Optimized result:', optimizedResult)
  
  const isCorrect = JSON.stringify(originalResult) === JSON.stringify(optimizedResult)
  console.log(`Multiple tickers correctness: ${isCorrect ? 'PASS' : 'FAIL'}`)
  
  return { originalResult, optimizedResult, isCorrect }
}

// Test case 3: Out of order executions (should be sorted)
export function testOutOfOrderExecutions() {
  console.log('Testing out-of-order executions...')
  
  const executions = [
    {
      id: '1',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 50,
      price: 160,
      createdAt: new Date('2023-01-01T09:32:00Z').getTime()
    },
    {
      id: '2',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 100,
      price: 150,
      createdAt: new Date('2023-01-01T09:30:00Z').getTime()
    },
    {
      id: '3',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 25,
      price: 165,
      createdAt: new Date('2023-01-01T09:33:00Z').getTime()
    },
    {
      id: '4',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 50,
      price: 155,
      createdAt: new Date('2023-01-01T09:31:00Z').getTime()
    }
  ]
  
  const originalResult = derivePositions(executions)
  const optimizedResult = derivePositionsEfficient(executions)
  
  console.log('Original result:', originalResult)
  console.log('Optimized result:', optimizedResult)
  
  const isCorrect = JSON.stringify(originalResult) === JSON.stringify(optimizedResult)
  console.log(`Out-of-order correctness: ${isCorrect ? 'PASS' : 'FAIL'}`)
  
  return { originalResult, optimizedResult, isCorrect }
}

// Test case 4: Cost basis calculation
export function testCostBasisCalculation() {
  console.log('Testing cost basis calculation...')
  
  const executions = [
    {
      id: '1',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 100,
      price: 150,
      createdAt: new Date('2023-01-01T09:30:00Z').getTime()
    },
    {
      id: '2',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 100,
      price: 160,
      createdAt: new Date('2023-01-01T09:31:00Z').getTime()
    },
    {
      id: '3',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 100,
      price: 170,
      createdAt: new Date('2023-01-01T09:32:00Z').getTime()
    }
  ]
  
  const originalResult = derivePositions(executions)
  const optimizedResult = derivePositionsEfficient(executions)
  
  console.log('Original result:', originalResult)
  console.log('Optimized result:', optimizedResult)
  
  // Expected: 100 shares remaining with cost basis of $160 (FIFO)
  // Total cost: $15000 + $16000 - $15000 = $16000
  // Avg cost: $16000 / 100 = $160
  
  const isCorrect = JSON.stringify(originalResult) === JSON.stringify(optimizedResult)
  console.log(`Cost basis correctness: ${isCorrect ? 'PASS' : 'FAIL'}`)
  
  return { originalResult, optimizedResult, isCorrect }
}

// Test case 5: Edge cases
export function testEdgeCases() {
  console.log('Testing edge cases...')
  
  const executions = [
    // Empty array
    [],
    // Single BUY
    [{
      id: '1',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 100,
      price: 150,
      createdAt: new Date('2023-01-01T09:30:00Z').getTime()
    }],
    // Single SELL (should handle gracefully)
    [{
      id: '1',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 100,
      price: 150,
      createdAt: new Date('2023-01-01T09:30:00Z').getTime()
    }],
    // Sell more than bought (should handle gracefully)
    [
      {
        id: '1',
        ticker: 'AAPL',
        side: 'BUY',
        quantity: 50,
        price: 150,
        createdAt: new Date('2023-01-01T09:30:00Z').getTime()
      },
      {
        id: '2',
        ticker: 'AAPL',
        side: 'SELL',
        quantity: 100,
        price: 160,
        createdAt: new Date('2023-01-01T09:31:00Z').getTime()
      }
    ]
  ]
  
  const results = []
  
  for (let i = 0; i < executions.length; i++) {
    const testExecutions = executions[i]
    const originalResult = derivePositions(testExecutions)
    const optimizedResult = derivePositionsEfficient(testExecutions)
    
    const isCorrect = JSON.stringify(originalResult) === JSON.stringify(optimizedResult)
    console.log(`Edge case ${i + 1} correctness: ${isCorrect ? 'PASS' : 'FAIL'}`)
    
    results.push({
      testCase: i + 1,
      originalResult,
      optimizedResult,
      isCorrect
    })
  }
  
  return results
}

// Run all tests
export function runAllTests() {
  console.log('Running all derivePositions correctness tests...')
  
  const results = {
    fifo: testFIFOCorrectness(),
    multipleTickers: testMultipleTickers(),
    outOfOrder: testOutOfOrderExecutions(),
    costBasis: testCostBasisCalculation(),
    edgeCases: testEdgeCases()
  }
  
  const allPassed = Object.values(results).every(result => {
    if (Array.isArray(result)) {
      return result.every(r => r.isCorrect)
    }
    return result.isCorrect
  })
  
  console.log(`\nAll tests ${allPassed ? 'PASSED' : 'FAILED'}`)
  
  return { results, allPassed }
}

// Performance comparison
export function comparePerformance() {
  console.log('Comparing performance...')
  
  // Generate test data
  const executions = []
  const tickers = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA']
  const sides = ['BUY', 'SELL']
  
  for (let i = 0; i < 10000; i++) {
    executions.push({
      id: `exec_${i}`,
      ticker: tickers[i % tickers.length],
      side: sides[i % sides.length],
      quantity: Math.random() * 100 + 1,
      price: Math.random() * 500 + 50,
      createdAt: Date.now() - (10000 - i) * 1000
    })
  }
  
  // Test original implementation
  const originalStart = performance.now()
  const originalResult = derivePositions(executions)
  const originalEnd = performance.now()
  
  // Test optimized implementation
  const optimizedStart = performance.now()
  const optimizedResult = derivePositionsEfficient(executions)
  const optimizedEnd = performance.now()
  
  const originalTime = originalEnd - originalStart
  const optimizedTime = optimizedEnd - optimizedStart
  const improvement = ((originalTime - optimizedTime) / originalTime) * 100
  
  console.log(`Original time: ${originalTime.toFixed(2)}ms`)
  console.log(`Optimized time: ${optimizedTime.toFixed(2)}ms`)
  console.log(`Improvement: ${improvement.toFixed(2)}%`)
  
  // Verify results are identical
  const isCorrect = JSON.stringify(originalResult) === JSON.stringify(optimizedResult)
  console.log(`Results identical: ${isCorrect ? 'YES' : 'NO'}`)
  
  return {
    originalTime,
    optimizedTime,
    improvement,
    isCorrect,
    originalResult,
    optimizedResult
  }
}
