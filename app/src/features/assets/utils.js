import { useState, useEffect } from 'react'
import { RECENT_KEY } from './constants.js'

export function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : []
  } catch {
    return []
  }
}

export function saveRecentSearches(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)))
  } catch {
    // ignore
  }
}

export function fmtPct(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

export function fmtPrice(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  return `$${num.toFixed(2)}`
}

export function fmtScore(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toFixed(2)
}

export function fmtAsOf(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export function normalizeConfidence(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num <= 1) return Math.round(num * 100)
  if (num <= 100) return Math.round(num)
  return null
}

export function parseEntryZone(value) {
  if (!value) return null
  if (Array.isArray(value) && value.length >= 2) {
    const low = Number(value[0])
    const high = Number(value[1])
    if (Number.isFinite(low) && Number.isFinite(high)) return { low, high }
  }

  const text = String(value)
  const range = text.match(/([-+]?\d*\.?\d+)\s*[–-]\s*([-+]?\d*\.?\d+)/)
  if (range) {
    const low = Number(range[1])
    const high = Number(range[2])
    if (Number.isFinite(low) && Number.isFinite(high)) return { low, high }
  }

  const single = text.match(/([-+]?\d*\.?\d+)/)
  if (single) {
    const num = Number(single[1])
    if (Number.isFinite(num)) return { low: num, high: num }
  }

  return null
}

export function deriveRowPrice(row) {
  const raw =
    row?.price ??
    row?.last ??
    row?.currentPrice ??
    row?.current_price ??
    row?.entry ??
    row?.entryPrice ??
    row?.entry_price

  const num = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(num)) return num

  const zone = parseEntryZone(row?.entryZone ?? row?.entry_zone ?? row?.entry)
  if (zone) return (zone.low + zone.high) / 2

  return null
}

export function useDebounced(value, delayMs) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function throttle(fn, delayMs) {
  let last = 0
  let trailing = null

  const throttled = function(...args) {
    const now = Date.now()

    if (now - last >= delayMs) {
      last = now
      fn(...args)
    } else {
      clearTimeout(trailing)
      trailing = setTimeout(() => {
        last = Date.now()
        fn(...args)
      }, delayMs - (now - last))
    }
  }

  throttled.cancel = () => {
    clearTimeout(trailing)
    trailing = null
  }

  return throttled
}

export function fmtPercent(value, digits = 0) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  const pct = num > 1 ? num : num * 100
  return `${pct.toFixed(digits)}%`
}

export function fmtDays(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return '—'
  if (num < 1) return `${Math.round(num * 24)}h`
  return `${Math.round(num)}d`
}

export function normalizeSymbol(s) {
  return String(s).toUpperCase().replace('.', '-')
}

export function getSymbol(row) {
  return normalizeSymbol(row?.ticker ?? row?.symbol ?? row?.tkr)
}
