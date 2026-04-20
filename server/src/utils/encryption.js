import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'

let _cachedKey = null
let _warnedTestDefault = false

function getKey() {
  if (_cachedKey) return _cachedKey

  const raw = process.env.ENCRYPTION_KEY

  // In tests we allow a deterministic fallback key so modules can import cleanly
  // without requiring local secrets in CI/dev shells.
  if ((!raw || raw.length === 0) && process.env.NODE_ENV === 'test') {
    if (!_warnedTestDefault) {
      _warnedTestDefault = true
      console.warn('[encryption] ENCRYPTION_KEY missing; using deterministic test key')
    }
    _cachedKey = Buffer.alloc(32, 0)
    return _cachedKey
  }

  if (!raw || raw.length === 0) {
    throw new Error('ENCRYPTION_KEY is required')
  }

  const key = Buffer.from(raw, 'hex')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)')
  }

  _cachedKey = key
  return _cachedKey
}

export function encrypt(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

export function decrypt(ciphertext) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}
