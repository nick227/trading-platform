import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loginRateLimiter, registerRateLimiter } from '../../src/middleware/rateLimiter.js'

describe('rateLimiter', () => {
  beforeEach(() => {
    loginRateLimiter.reset('127.0.0.1:user@test.com')
    registerRateLimiter.reset('127.0.0.1')
  })

  it('allows attempts within the threshold', () => {
    const key = '127.0.0.1:user@test.com'
    expect(loginRateLimiter.isLimited(key)).toBe(false)
    loginRateLimiter.recordAttempt(key)
    loginRateLimiter.recordAttempt(key)
    loginRateLimiter.recordAttempt(key)
    expect(loginRateLimiter.isLimited(key)).toBe(false)
  })

  it('limits attempts once threshold is exceeded', () => {
    const key = '127.0.0.1:user@test.com'
    for (let i = 0; i < 5; i++) {
      loginRateLimiter.recordAttempt(key)
    }
    expect(loginRateLimiter.isLimited(key)).toBe(true)
    expect(loginRateLimiter.timeRemainingSec(key)).toBeGreaterThan(0)
  })

  it('resets attempts on reset call (e.g. successful login)', () => {
    const key = '127.0.0.1:user@test.com'
    for (let i = 0; i < 5; i++) {
      loginRateLimiter.recordAttempt(key)
    }
    expect(loginRateLimiter.isLimited(key)).toBe(true)
    loginRateLimiter.reset(key)
    expect(loginRateLimiter.isLimited(key)).toBe(false)
  })
})
