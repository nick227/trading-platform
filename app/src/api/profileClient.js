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

/** Returns the current user from the server cookie, or null if not logged in. */
export async function getSessionUser() {
  try {
    return await apiFetch('/auth/me')
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
  return apiFetch('/auth/logout', { method: 'POST' })
}

// ── Broker credentials ───────────────────────────────────────────────────────

export async function saveBrokerCredentials(apiKey, apiSecret, paper = true) {
  return apiFetch('/account/broker-credentials', {
    method: 'POST',
    body: JSON.stringify({ apiKey, apiSecret, paper })
  })
}

export async function getBrokerStatus() {
  return apiFetch('/account/broker-credentials')
}

// ── Profile updates ──────────────────────────────────────────────────────────
// These are placeholders — implement the server endpoints when needed.

export async function resetPassword(_currentPassword, _nextPassword) {
  // TODO: POST /api/auth/change-password
  throw new Error('Password change not yet implemented')
}
