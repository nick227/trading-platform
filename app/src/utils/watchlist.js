const WATCHLIST_KEY = 'watchlist_v1'

export function normalizeWatchlist(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((item) => String(item ?? '').toUpperCase().trim())
    .filter(Boolean)
    .filter((symbol, idx, arr) => arr.indexOf(symbol) === idx)
}

export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return normalizeWatchlist(parsed)
  } catch {
    return []
  }
}

export function saveWatchlist(list) {
  try {
    const next = normalizeWatchlist(list)
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent('watchlist:updated', { detail: next }))
  } catch {
    // ignore
  }
}

export function isWatched(list, symbol) {
  const tkr = String(symbol ?? '').toUpperCase().trim()
  if (!tkr) return false
  return normalizeWatchlist(list).includes(tkr)
}

export function addToWatchlist(list, symbol) {
  const tkr = String(symbol ?? '').toUpperCase().trim()
  if (!tkr) return normalizeWatchlist(list)
  return [tkr, ...normalizeWatchlist(list).filter((t) => t !== tkr)]
}

export function removeFromWatchlist(list, symbol) {
  const tkr = String(symbol ?? '').toUpperCase().trim()
  if (!tkr) return normalizeWatchlist(list)
  return normalizeWatchlist(list).filter((t) => t !== tkr)
}

export function toggleWatchlist(list, symbol) {
  return isWatched(list, symbol) ? removeFromWatchlist(list, symbol) : addToWatchlist(list, symbol)
}

