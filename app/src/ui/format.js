// One formatting vocabulary for every surface. Missing values render as an em dash,
// never as 0.
export const DASH = '—'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })

const isNum = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n))

export const money = (n) => (isNum(n) ? usd.format(Number(n)) : DASH)
export const moneyWhole = (n) => (isNum(n) ? usd0.format(Number(n)) : DASH)

export function signedMoney(n) {
  if (!isNum(n)) return DASH
  const v = Number(n)
  if (Math.abs(v) < 0.005) return usd.format(0)
  return `${v > 0 ? '+' : '−'}${usd.format(Math.abs(v))}`
}

export function signedPct(n, digits = 2) {
  if (!isNum(n)) return DASH
  const v = Number(n)
  if (Math.abs(v) < 0.5 * 10 ** -digits) return `${(0).toFixed(digits)}%`
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`
}

export const pct = (n, digits = 1) => (isNum(n) ? `${Number(n).toFixed(digits)}%` : DASH)
export const ratioPct = (r, digits = 1) => (isNum(r) ? `${(Number(r) * 100).toFixed(digits)}%` : DASH)
export const shares = (n) => (isNum(n) ? num.format(Number(n)) : DASH)

export function tone(n) {
  if (!isNum(n) || Math.abs(Number(n)) < 0.005) return ''
  return Number(n) > 0 ? 'tl-pos' : 'tl-neg'
}

/** "2026-11-20" → "Nov 20" (a market session, not a timestamp). */
export function sessionDate(s, { year = false } = {}) {
  if (!s) return DASH
  const d = new Date(`${String(s).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

export function dateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Compact relative time for activity ("5m ago", "3h ago", "Nov 19"). */
export function ago(iso, now = Date.now()) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function listJoin(items, max = 4) {
  const xs = (items ?? []).filter(Boolean)
  if (xs.length <= max) return xs.join(', ')
  return `${xs.slice(0, max).join(', ')} +${xs.length - max}`
}
