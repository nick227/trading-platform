// Robust financial correctness validation with field-by-field assertions

export function validateFinancialCorrectness(originalResult, optimizedResult, testName = 'test') {
  console.log(`Validating ${testName}...`)
  
  // Handle null/undefined cases
  if (!originalResult && !optimizedResult) {
    console.log(`✅ ${testName}: Both null - PASS`)
    return { passed: true, details: 'Both results null' }
  }
  
  if (!originalResult || !optimizedResult) {
    console.log(`❌ ${testName}: One result null - FAIL`)
    return { 
      passed: false, 
      details: `Original: ${!!originalResult}, Optimized: ${!!optimizedResult}` 
    }
  }
  
  // Check array lengths
  if (originalResult.length !== optimizedResult.length) {
    console.log(`❌ ${testName}: Length mismatch - FAIL`)
    return { 
      passed: false, 
      details: `Length: Original=${originalResult.length}, Optimized=${optimizedResult.length}` 
    }
  }
  
  // Field-by-field validation for each position
  for (let i = 0; i < originalResult.length; i++) {
    const original = originalResult[i]
    const optimized = optimizedResult[i]
    
    // Find position by ticker for robust comparison
    const optimizedPosition = optimizedResult.find(p => p.ticker === original.ticker)
    
    if (!optimizedPosition) {
      console.log(`❌ ${testName}: Missing ticker ${original.ticker} - FAIL`)
      return { 
        passed: false, 
        details: `Missing ticker: ${original.ticker}` 
      }
    }
    
    // Validate each critical field with tolerance for floating point
    const fieldValidations = [
      { 
        field: 'ticker', 
        original: original.ticker, 
        optimized: optimizedPosition.ticker,
        tolerance: 0 
      },
      { 
        field: 'quantity', 
        original: original.quantity, 
        optimized: optimizedPosition.quantity,
        tolerance: 0.001 
      },
      { 
        field: 'totalCost', 
        original: original.totalCost, 
        optimized: optimizedPosition.totalCost,
        tolerance: 0.01 
      },
      { 
        field: 'avgCost', 
        original: original.avgCost, 
        optimized: optimizedPosition.avgCost,
        tolerance: 0.01 
      }
    ]
    
    for (const validation of fieldValidations) {
      const originalValue = original[validation.field]
      const optimizedValue = optimizedPosition[validation.field]
      const diff = Math.abs(originalValue - optimizedValue)
      
      if (diff > validation.tolerance) {
        console.log(`❌ ${testName}: Field ${validation.field} mismatch - FAIL`)
        console.log(`  Original: ${originalValue}`)
        console.log(`  Optimized: ${optimizedValue}`)
        console.log(`  Difference: ${diff}`)
        return { 
          passed: false, 
          details: `Field ${validation.field} mismatch: ${diff} > ${validation.tolerance}` 
        }
      }
    }
  }
  
  console.log(`✅ ${testName}: All fields match - PASS`)
  return { passed: true, details: 'All fields within tolerance' }
}

export function validateFIFOCorrectness(executions, result) {
  console.log('Validating FIFO logic...')
  
  // Manually calculate expected FIFO results
  const expectedPositions = {}
  
  // Sort executions by timestamp
  const sortedExecutions = [...executions].sort((a, b) => a.createdAt - b.createdAt)
  
  for (const execution of sortedExecutions) {
    if (!expectedPositions[execution.ticker]) {
      expectedPositions[execution.ticker] = {
        ticker: execution.ticker,
        quantity: 0,
        totalCost: 0,
        buyTrades: []
      }
    }
    
    const position = expectedPositions[execution.ticker]
    
    if (execution.side === 'BUY') {
      position.quantity += execution.quantity
      position.totalCost += execution.price * execution.quantity
      position.buyTrades.push({
        quantity: execution.quantity,
        cost: execution.price * execution.quantity
      })
    } else if (execution.side === 'SELL') {
      let sharesToSell = execution.quantity
      
      while (sharesToSell > 0 && position.buyTrades.length > 0) {
        const oldestBuy = position.buyTrades[0]
        const sharesFromOldest = Math.min(sharesToSell, oldestBuy.quantity)
        
        const costToRemove = (oldestBuy.cost / oldestBuy.quantity) * sharesFromOldest
        position.totalCost -= costToRemove
        
        oldestBuy.quantity -= sharesFromOldest
        oldestBuy.cost -= costToRemove
        
        if (oldestBuy.quantity === 0) {
          position.buyTrades.shift()
        }
        
        sharesToSell -= sharesFromOldest
      }
      
      position.quantity -= execution.quantity
    }
    
    if (position.quantity > 0) {
      position.avgCost = position.totalCost / position.quantity
    }
  }
  
  const expected = Object.values(expectedPositions).filter(p => p.quantity > 0)
  
  return validateFinancialCorrectness(expected, result, 'FIFO Logic')
}

export function validateSortingCorrectness(executions, result) {
  console.log('Validating sorting correctness...')
  
  // Check if executions were processed in chronological order
  const sortedExecutions = [...executions].sort((a, b) => a.createdAt - b.createdAt)
  
  // For each position, verify the cost basis matches FIFO order
  for (const position of result) {
    const tickerExecutions = sortedExecutions.filter(e => e.ticker === position.ticker)
    
    let expectedQuantity = 0
    let expectedTotalCost = 0
    const buyTrades = []
    
    for (const execution of tickerExecutions) {
      if (execution.side === 'BUY') {
        expectedQuantity += execution.quantity
        expectedTotalCost += execution.price * execution.quantity
        buyTrades.push({
          quantity: execution.quantity,
          cost: execution.price * execution.quantity
        })
      } else if (execution.side === 'SELL') {
        let sharesToSell = execution.quantity
        
        while (sharesToSell > 0 && buyTrades.length > 0) {
          const oldestBuy = buyTrades[0]
          const sharesFromOldest = Math.min(sharesToSell, oldestBuy.quantity)
          
          const costToRemove = (oldestBuy.cost / oldestBuy.quantity) * sharesFromOldest
          expectedTotalCost -= costToRemove
          
          oldestBuy.quantity -= sharesFromOldest
          oldestBuy.cost -= costToRemove
          
          if (oldestBuy.quantity === 0) {
            buyTrades.shift()
          }
          
          sharesToSell -= sharesFromOldest
        }
        
        expectedQuantity -= execution.quantity
      }
    }
    
    const expectedAvgCost = expectedQuantity > 0 ? expectedTotalCost / expectedQuantity : 0
    
    const quantityDiff = Math.abs(position.quantity - expectedQuantity)
    const totalCostDiff = Math.abs(position.totalCost - expectedTotalCost)
    const avgCostDiff = Math.abs(position.avgCost - expectedAvgCost)
    
    if (quantityDiff > 0.001 || totalCostDiff > 0.01 || avgCostDiff > 0.01) {
      console.log(`❌ Sorting validation failed for ${position.ticker}`)
      console.log(`  Expected quantity: ${expectedQuantity}, Got: ${position.quantity}`)
      console.log(`  Expected totalCost: ${expectedTotalCost}, Got: ${position.totalCost}`)
      console.log(`  Expected avgCost: ${expectedAvgCost}, Got: ${position.avgCost}`)
      return { passed: false, details: 'Sorting order incorrect' }
    }
  }
  
  console.log('✅ Sorting validation - PASS')
  return { passed: true, details: 'Sorting order correct' }
}

export function runComprehensiveValidation(executions, originalResult, optimizedResult) {
  console.log('Running comprehensive validation...')
  
  const results = {
    financialCorrectness: validateFinancialCorrectness(originalResult, optimizedResult, 'Financial'),
    fifoLogic: validateFIFOCorrectness(executions, optimizedResult),
    sortingCorrectness: validateSortingCorrectness(executions, optimizedResult)
  }
  
  const allPassed = Object.values(results).every(result => result.passed)
  
  console.log(`\nComprehensive validation: ${allPassed ? 'PASSED' : 'FAILED'}`)
  
  for (const [testName, result] of Object.entries(results)) {
    console.log(`  ${testName}: ${result.passed ? 'PASS' : 'FAIL'} - ${result.details}`)
  }
  
  return { results, allPassed }
}
