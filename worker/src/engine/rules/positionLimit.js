// config: { maxQuantity: number }
// positions: array from AlpacaClient.getPositions()
export function evaluatePositionLimit(config, ticker, positions) {
  const symbol = String(ticker).toUpperCase()
  const position = positions.find(p =>
    String(p?.symbol ?? p?.ticker ?? '').toUpperCase() === symbol
  )
  const currentQty = position ? Math.abs(parseFloat(position.qty ?? position.quantity ?? 0)) : 0

  if (currentQty >= config.maxQuantity) {
    return {
      pass:   false,
      reason: 'position_limit_reached',
      detail: `current qty ${currentQty} >= max ${config.maxQuantity}`
    }
  }

  return { pass: true, currentQty }
}
