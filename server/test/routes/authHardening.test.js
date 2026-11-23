import { describe, it, expect, beforeEach } from 'vitest'
import { validatePassword } from '../../src/routes/auth.js'
import { loginRateLimiter } from '../../src/middleware/rateLimiter.js'

describe('Auth Hardening', () => {
  describe('Password Strength Validation', () => {
    it('rejects passwords shorter than 8 characters', () => {
      const res = validatePassword('short1')
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/at least 8 characters/)
    })

    it('rejects passwords without numbers', () => {
      const res = validatePassword('onlyletterspassword')
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/both letters and numbers/)
    })

    it('rejects passwords without letters', () => {
      const res = validatePassword('1234567890')
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/both letters and numbers/)
    })

    it('accepts strong passwords with letters and numbers', () => {
      expect(validatePassword('ValidPass123').ok).toBe(true)
      expect(validatePassword('tradeLoom2026').ok).toBe(true)
    })
  })

  describe('Brute Force Throttling', () => {
    beforeEach(() => {
      loginRateLimiter.reset('127.0.0.1:victim@example.com')
    })

    it('allows up to 4 failed attempts without blocking', () => {
      const key = '127.0.0.1:victim@example.com'
      for (let i = 0; i < 4; i++) {
        loginRateLimiter.recordAttempt(key)
      }
      expect(loginRateLimiter.isLimited(key)).toBe(false)
    })

    it('locks out after 5 consecutive failed attempts', () => {
      const key = '127.0.0.1:victim@example.com'
      for (let i = 0; i < 5; i++) {
        loginRateLimiter.recordAttempt(key)
      }
      expect(loginRateLimiter.isLimited(key)).toBe(true)
      expect(loginRateLimiter.timeRemainingSec(key)).toBeGreaterThan(800)
    })
  })
})
