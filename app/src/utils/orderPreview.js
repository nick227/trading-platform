/**
 * calculateOrderPreview — pure function, shared between OrdersPage and OrderConfirm.
 *
 * Accepts either string form-field inputs or already-resolved number values for
 * quantity/amount, so it works in both the entry form and the confirmation screen.
 *
 * Returns null when price is missing or zero.
 */
export function calculateOrderPreview({ orderType, quantity: rawQty, amount: rawAmt, price, bankBalance, currentShares = 0, pendingOrders = [] }) {
  if (!price || price <= 0) return null

  const amt = parseFloat(rawAmt) || 0
  const qty = parseFloat(rawQty) || 0

  // Resolve canonical quantity and total value from whichever input is set.
  const resolvedQty   = qty  || (amt > 0 ? Math.floor(amt / price) : 0)
  const resolvedValue = amt  || resolvedQty * price

  if (orderType === 'SELL') {
    // Validate that user owns enough shares to sell
    const canAfford = resolvedQty > 0 && resolvedQty <= currentShares
    return {
      price,
      quantity:     resolvedQty,
      totalValue:   resolvedQty * price,
      afterBalance: bankBalance + resolvedQty * price,
      canAfford,
      maxQuantity:  currentShares,
    }
  }

  // BUY - Calculate pending order commitments
  const pendingBuyOrders = pendingOrders.filter(o => 
    o.status === 'queued' && o.side === 'BUY'
  )
  const pendingBuyValue = pendingBuyOrders.reduce((sum, o) => 
    sum + (o.quantity * o.price), 0
  )
  
  const effectiveBalance = bankBalance - pendingBuyValue
  const maxQuantity = effectiveBalance > 0 ? Math.floor(effectiveBalance / price) : 0
  
  return {
    price,
    quantity:     resolvedQty,
    totalValue:   resolvedValue,
    afterBalance: effectiveBalance - resolvedValue,
    canAfford:    resolvedValue >= 0 && resolvedValue <= effectiveBalance,
    maxQuantity,
    pendingBuyValue,
    effectiveBalance,
  }
}
