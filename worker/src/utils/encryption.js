import { createDecipheriv } from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey() {
  const raw = process.env.ENCRYPTION_KEY

  if (!raw || raw.length === 0) {
    throw new Error('ENCRYPTION_KEY is required')
  }

  const key = Buffer.from(raw, 'hex')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)')
  }

  return key
}

export function decrypt(ciphertext) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}
