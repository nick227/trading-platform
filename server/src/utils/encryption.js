import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
export const CURRENT_KEY_VERSION = 'v1'

let _cachedPrimaryKey = null
let _cachedPreviousKey = undefined
let _warnedTestDefault = false

export function resetEncryptionKeyCache() {
  _cachedPrimaryKey = null
  _cachedPreviousKey = undefined
}

function parseHexKey(raw, label) {
  const key = Buffer.from(raw, 'hex')
  if (key.length !== 32) {
    throw new Error(`${label} must be 32 bytes hex (64 hex chars)`)
  }
  return key
}

function getPrimaryKey() {
  if (_cachedPrimaryKey) return _cachedPrimaryKey

  const raw = process.env.ENCRYPTION_KEY_CURRENT || process.env.ENCRYPTION_KEY

  if ((!raw || raw.length === 0) && process.env.NODE_ENV === 'test') {
    if (!_warnedTestDefault) {
      _warnedTestDefault = true
      console.warn('[encryption] ENCRYPTION_KEY missing; using deterministic test key')
    }
    _cachedPrimaryKey = Buffer.alloc(32, 0)
    return _cachedPrimaryKey
  }

  if (!raw || raw.length === 0) {
    throw new Error('ENCRYPTION_KEY is required')
  }

  _cachedPrimaryKey = parseHexKey(raw, 'ENCRYPTION_KEY')
  return _cachedPrimaryKey
}

function getPreviousKey() {
  if (_cachedPreviousKey !== undefined) return _cachedPreviousKey
  const raw = process.env.ENCRYPTION_KEY_PREVIOUS
  if (!raw || raw.length === 0) {
    _cachedPreviousKey = null
    return null
  }
  _cachedPreviousKey = parseHexKey(raw, 'ENCRYPTION_KEY_PREVIOUS')
  return _cachedPreviousKey
}

export function parseCiphertextVersion(ciphertext) {
  if (typeof ciphertext !== 'string' || !ciphertext) return null
  const parts = ciphertext.split(':')
  if (parts.length === 4 && parts[0].startsWith('v')) return parts[0]
  if (parts.length === 3) return 'legacy_v0'
  return null
}

export function encrypt(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, getPrimaryKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    CURRENT_KEY_VERSION,
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex')
  ].join(':')
}

function decryptWithKey(key, ivHex, tagHex, encHex) {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}

export function decrypt(ciphertext) {
  const parts = String(ciphertext ?? '').split(':')
  let ivHex, tagHex, encHex
  if (parts.length === 4 && parts[0].startsWith('v')) {
    ;[, ivHex, tagHex, encHex] = parts
  } else if (parts.length === 3) {
    ;[ivHex, tagHex, encHex] = parts
  } else {
    throw new Error('Malformed encrypted credential payload')
  }

  try {
    return decryptWithKey(getPrimaryKey(), ivHex, tagHex, encHex)
  } catch (primaryErr) {
    const prevKey = getPreviousKey()
    if (!prevKey) throw primaryErr
    return decryptWithKey(prevKey, ivHex, tagHex, encHex)
  }
}

export function reencryptWithCurrentKey(ciphertext) {
  const plaintext = decrypt(ciphertext)
  return encrypt(plaintext)
}
