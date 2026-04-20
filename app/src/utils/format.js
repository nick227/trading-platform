// Shared display formatting utilities.

export function formatCurrency(value, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value ?? 0)
}

export function formatPercent(value, { showSign = false, decimals = 2, asDecimal = false } = {}) {
  const num  = asDecimal ? (value ?? 0) * 100 : (value ?? 0)
  const str  = num.toFixed(decimals)
  const sign = showSign && parseFloat(str) >= 0 ? '+' : ''
  return `${sign}${str}%`
}

export function formatCompactNumber(value) {
  if (value == null) return 'N/A'
  const abs = Math.abs(value)
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `$${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString()}`
}

export function formatVolume(value) {
  if (value == null) return 'N/A'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return `${value}`
}
