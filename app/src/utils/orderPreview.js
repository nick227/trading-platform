/**
 * calculateOrderPreview — pure function, shared between OrdersPage and OrderConfirm.
 *
 * Accepts either string form-field inputs or already-resolved number values for
 * quantity/amount, so it works in both the entry form and the confirmation screen.
 *
 * Returns null when price is missing or zero.
 */
export function calculateOrderPreview({ orderType, quantity: rawQty, amount: rawAmt, price, bankBalance }) {
  if (!price || price <= 0) return null

  const amt = parseFloat(rawAmt) || 0
  const qty = parseFloat(rawQty) || 0

  // Resolve canonical quantity and total value from whichever input is set.
  const resolvedQty   = qty  || (amt > 0 ? Math.floor(amt / price) : 0)
  const resolvedValue = amt  || resolvedQty * price

  if (orderType === 'SELL') {
    return {
      price,
      quantity:     resolvedQty,
      totalValue:   resolvedQty * price,
      afterBalance: bankBalance + resolvedQty * price,
      canAfford:    resolvedQty > 0,
      maxQuantity:  null,
    }
  }

  // BUY
  const maxQuantity = bankBalance > 0 ? Math.floor(bankBalance / price) : 0
  return {
    price,
    quantity:     resolvedQty,
    totalValue:   resolvedValue,
    afterBalance: bankBalance - resolvedValue,
    canAfford:    resolvedValue > 0 && resolvedValue <= bankBalance,
    maxQuantity,
  }
}
