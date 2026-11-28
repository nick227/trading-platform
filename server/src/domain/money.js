/**
 * Deterministic Fixed-Point Monetary & Share Arithmetic (P3 — Monetary Precision)
 *
 * All monetary amounts and share quantities are represented internally as exact `BigInt`
 * micro-units (`SCALE = 1_000_000n`, i.e., 6 decimal places: `$1.00 = 1_000_000n` micro-dollars,
 * `1 share = 1_000_000n` micro-shares).
 *
 * Rounding policy:
 * - Intermediate notional and per-share calculations round `HALF_EVEN` (banker's rounding) at
 *   micro-unit (`10^-6`) precision.
 * - Display / settled USD cent figures (`toCentsNumber`, `formatDecimal`) round `HALF_EVEN` at
 *   `10^-2` (`10_000n` micro-units = 1 cent), eliminating IEEE-754 binary floating-point drift.
 */

export const MICROS_SCALE = 1_000_000n
export const CENTS_IN_MICROS = 10_000n
export const QTY4_IN_MICROS = 100n

/**
 * Divides `numerator / denominator` (`denominator > 0n`) using exact `HALF_EVEN` (banker's) rounding.
 */
export function divRoundHalfEven(numerator, denominator) {
  const num = BigInt(numerator)
  const den = BigInt(denominator)
  if (den <= 0n) throw new Error('divRoundHalfEven requires positive denominator')
  if (num === 0n) return 0n

  const negative = num < 0n
  const absNum = negative ? -num : num
  const quotient = absNum / den
  const remainder = absNum % den
  const doubledRem = remainder * 2n

  let rounded = quotient
  if (doubledRem > den) {
    rounded = quotient + 1n
  } else if (doubledRem === den) {
    // Exact tie: round to nearest even integer
    if ((quotient & 1n) === 1n) {
      rounded = quotient + 1n
    }
  }
  return negative ? -rounded : rounded
}

/**
 * Parses a decimal string, Prisma Decimal, number, or BigInt into exact `BigInt` micro-units (`10^-6`)
 * via base-10 digit parsing (never multiplying floats by `1e6`).
 */
export function toMicros(value) {
  if (typeof value === 'bigint') return value
  if (value === null || value === undefined || value === '') return 0n
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric money value: ${value}`)
    // Convert via base-10 fixed string with 8 fractional digits to strip IEEE-754 tail noise
    return parseDecimalStringToMicros(value.toFixed(8))
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return parseDecimalStringToMicros(value.toString())
  }
  if (typeof value === 'string') {
    return parseDecimalStringToMicros(value)
  }
  throw new Error(`Unsupported monetary value type: ${typeof value}`)
}

function parseDecimalStringToMicros(raw) {
  const trimmed = String(raw).trim()
  if (!trimmed) return 0n
  if (/e/i.test(trimmed)) {
    const asNum = Number(trimmed)
    if (!Number.isFinite(asNum)) throw new Error(`Invalid scientific notation value: ${raw}`)
    return parseDecimalStringToMicros(asNum.toFixed(8))
  }
  const match = trimmed.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error(`Invalid decimal string: "${raw}"`)
  const sign = match[1] === '-' ? -1n : 1n
  const intPart = BigInt(match[2])
  const fracRaw = match[3] ?? ''

  if (fracRaw.length <= 6) {
    const padded = fracRaw.padEnd(6, '0')
    return sign * (intPart * MICROS_SCALE + BigInt(padded))
  }

  // More than 6 decimal digits: exact HALF_EVEN round to 6 decimal places
  const extraPower = 10n ** BigInt(fracRaw.length - 6)
  const fullScaled = intPart * (MICROS_SCALE * extraPower) + BigInt(fracRaw)
  return divRoundHalfEven(sign * fullScaled, extraPower)
}

/**
 * Exact `qtyMicros * priceMicros -> notionalMicros` (`HALF_EVEN` at `10^-6`).
 */
export function mulMicros(aMicros, bMicros) {
  return divRoundHalfEven(BigInt(aMicros) * BigInt(bMicros), MICROS_SCALE)
}

/**
 * Exact `numeratorMicros / denominatorMicros -> ratioMicros` (`HALF_EVEN` at `10^-6`).
 */
export function divMicros(numeratorMicros, denominatorMicros) {
  return divRoundHalfEven(BigInt(numeratorMicros) * MICROS_SCALE, BigInt(denominatorMicros))
}

/**
 * Converts micro-dollars (`10^-6`) to USD cents number (`2` decimals, `HALF_EVEN`).
 */
export function microsToDollars(micros) {
  const cents = divRoundHalfEven(BigInt(micros), CENTS_IN_MICROS)
  return Number(cents) / 100
}

/**
 * Converts micro-units (`10^-6`) to 4-decimal number (`HALF_EVEN`), used for share quantities & unit costs.
 */
export function microsTo4Decimals(micros) {
  const units = divRoundHalfEven(BigInt(micros), QTY4_IN_MICROS)
  return Number(units) / 10_000
}

/**
 * Formats micro-units (`10^-6`) to an exact fixed-scale string (for Prisma `Decimal` columns).
 */
export function microsToDecimalString(micros, decimals = 4) {
  const scaleFactor = 10n ** BigInt(6 - decimals)
  const rounded = decimals === 6 ? BigInt(micros) : divRoundHalfEven(BigInt(micros), scaleFactor)
  const negative = rounded < 0n
  const abs = negative ? -rounded : rounded
  const base = 10n ** BigInt(decimals)
  const intStr = (abs / base).toString()
  if (decimals === 0) return `${negative ? '-' : ''}${intStr}`
  const fracStr = (abs % base).toString().padStart(decimals, '0')
  return `${negative ? '-' : ''}${intStr}.${fracStr}`
}
