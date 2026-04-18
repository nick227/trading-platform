// config: { maxQuantity: number }
// positions: array from AlpacaClient.getPositions()
export function evaluatePositionLimit(config, ticker, positions) {
  const position = positions.find(p => p.symbol === ticker)
  const currentQty = position ? Math.abs(parseFloat(position.qty)) : 0

  if (currentQty >= config.maxQuantity) {
    return {
      pass:   false,
      reason: 'position_limit_reached',
      detail: `current qty ${currentQty} >= max ${config.maxQuantity}`
    }
  }

  return { pass: true, currentQty }
}
