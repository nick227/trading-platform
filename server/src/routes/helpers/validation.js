/**
 * Query parameter validation helpers
 */

/**
 * Clamps an integer value between min and max, returns defaultValue if invalid
 */
export function clampInt(value, min = 1, max = 100, defaultValue = min) {
  const num = typeof value === 'number' ? value : parseInt(value, 10)
  if (isNaN(num) || !Number.isInteger(num)) return defaultValue
  if (num < min) return min
  if (num > max) return max
  return num
}

/**
 * Safely converts to number, returns defaultValue if invalid
 */
export function clampNumber(value, min = null, max = null, defaultValue = null) {
  const num = typeof value === 'number' ? value : Number(value)
  if (isNaN(num) || !Number.isFinite(num)) return defaultValue
  if (min !== null && num < min) return min
  if (max !== null && num > max) return max
  return num
}

/**
 * Validates string is not empty, returns defaultValue if invalid
 */
export function validateString(value, defaultValue = '') {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return defaultValue
}
