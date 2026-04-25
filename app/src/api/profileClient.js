/**
 * profileClient.js — real HTTP auth client.
 * All functions call the server /api/auth/* and /api/account/* endpoints.
 * The old in-memory stub has been replaced.
 */

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include', // send httpOnly cookie
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

// ── Session ──────────────────────────────────────────────────────────────────

// In-memory cache to prevent duplicate auth calls during React StrictMode double-render
let cachedUser = null
let cachedUserExpiry = 0
const USER_CACHE_TTL_MS = 15_000

let cachedBrokerStatus = null
let cachedBrokerStatusExpiry = 0
const BROKER_STATUS_CACHE_TTL_MS = 15_000

/** Returns the current user from the server cookie, or null if not logged in. */
export async function getSessionUser() {
  const now = Date.now()
  if (cachedUser && now < cachedUserExpiry) {
    return cachedUser
  }

  try {
    const user = await apiFetch('/auth/me')
    cachedUser = user
    cachedUserExpiry = now + USER_CACHE_TTL_MS
    return user
  } catch {
    return null
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function loginWithCredentials(email, password) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
}

export async function registerWithCredentials(email, password, fullName) {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, fullName })
  })
}

export async function logoutFromServer() {
  const result = await apiFetch('/auth/logout', { method: 'POST' })
  // Invalidate caches on logout
  cachedUser = null
  cachedUserExpiry = 0
  cachedBrokerStatus = null
  cachedBrokerStatusExpiry = 0
  return result
}

// ── Broker credentials ───────────────────────────────────────────────────────

export async function saveBrokerCredentials(apiKey, apiSecret, paper = true) {
  const result = await apiFetch('/account/broker-credentials', {
    method: 'POST',
    body: JSON.stringify({ apiKey, apiSecret, paper })
  })
  // Invalidate broker status cache after saving
  cachedBrokerStatus = null
  cachedBrokerStatusExpiry = 0
  return result
}

export async function getBrokerStatus() {
  const now = Date.now()
  if (cachedBrokerStatus && now < cachedBrokerStatusExpiry) {
    return cachedBrokerStatus
  }

  const status = await apiFetch('/account/broker-credentials')
  cachedBrokerStatus = status
  cachedBrokerStatusExpiry = now + BROKER_STATUS_CACHE_TTL_MS
  return status
}

// ── Profile updates ──────────────────────────────────────────────────────────
// These are placeholders — implement the server endpoints when needed.

export async function resetPassword(_currentPassword, _nextPassword) {
  // TODO: POST /api/auth/change-password
  throw new Error('Password change not yet implemented')
}
