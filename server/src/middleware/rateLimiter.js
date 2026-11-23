/**
 * Lightweight in-memory sliding window rate limiter.
 * Protects public authentication endpoints from credential-stuffing and brute-force attacks.
 */

class SlidingWindowRateLimiter {
  constructor({ windowMs = 15 * 60 * 1000, maxAttempts = 5, message = 'Too many attempts. Please try again later.' } = {}) {
    this.windowMs = windowMs
    this.maxAttempts = maxAttempts
    this.message = message
    this.records = new Map() // key -> [timestamp, timestamp, ...]

    // Periodic cleanup of expired entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000)
    if (this.cleanupTimer.unref) this.cleanupTimer.unref()
  }

  _getTimestamps(key) {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const existing = this.records.get(key) || []
    const valid = existing.filter((t) => t > cutoff)
    if (valid.length === 0) {
      this.records.delete(key)
      return []
    }
    this.records.set(key, valid)
    return valid
  }

  isLimited(key) {
    const timestamps = this._getTimestamps(key)
    return timestamps.length >= this.maxAttempts
  }

  recordAttempt(key) {
    const timestamps = this._getTimestamps(key)
    timestamps.push(Date.now())
    this.records.set(key, timestamps)
    return timestamps.length >= this.maxAttempts
  }

  reset(key) {
    this.records.delete(key)
  }

  timeRemainingSec(key) {
    const timestamps = this._getTimestamps(key)
    if (timestamps.length === 0) return 0
    const oldest = timestamps[0]
    const remainingMs = Math.max(0, oldest + this.windowMs - Date.now())
    return Math.ceil(remainingMs / 1000)
  }

  cleanup() {
    const now = Date.now()
    const cutoff = now - this.windowMs
    for (const [key, timestamps] of this.records.entries()) {
      const valid = timestamps.filter((t) => t > cutoff)
      if (valid.length === 0) {
        this.records.delete(key)
      } else {
        this.records.set(key, valid)
      }
    }
  }

  destroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
  }
}

// 5 failed login attempts per 15 minutes per IP/email combination
export const loginRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  message: 'Too many failed login attempts. Please try again in 15 minutes.',
})

// 10 registration attempts per hour per IP
export const registerRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxAttempts: 10,
  message: 'Too many registration attempts from this network. Please try again later.',
})
