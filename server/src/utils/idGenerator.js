import { randomUUID } from 'crypto'

export function generateId(prefix) {
  const timestamp = Date.now()
  const uuid = randomUUID().slice(0, 8)
  return `${prefix}_${timestamp}_${uuid}`
}

export function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

export const ID_PREFIXES = {
  PREDICTION: 'prd',
  EXECUTION: 'exe',
  STRATEGY: 'str',
  PORTFOLIO: 'prt',
  BOT: 'bot',
  EVENT: 'evt',
  RULE: 'rul',
  BROKER: 'bkr',
  TEMPLATE: 'tmpl',
  AUDIT: 'aud'
}
