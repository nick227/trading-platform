import prisma from '../loaders/prisma.js'
import { decrypt } from '../utils/encryption.js'

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets'
const LIVE_BASE_URL = 'https://api.alpaca.markets'

function parseEnvBool(value, defaultValue) {
  if (value == null) return defaultValue
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return defaultValue
}

function getBaseUrl(paper) {
  return paper ? PAPER_BASE_URL : LIVE_BASE_URL
}

/**
 * Resolve Alpaca credentials for a user.
 * Priority: per-user BrokerAccount (decrypted) → process.env fallback.
 *
 * Returns { apiKey, apiSecret, paper, baseUrl } or null if missing.
 */
export async function resolveAlpacaCredentials(userId) {
  if (userId) {
    const broker = await prisma.brokerAccount.findUnique({ where: { userId } })
    if (broker?.apiKey && broker?.apiSecret) {
      try {
        const paper = broker.paper !== false
        if (!paper && process.env.ALLOW_LIVE_TRADING !== 'true') {
          const err = new Error('Live trading is disabled. Set ALLOW_LIVE_TRADING=true to enable.')
          err.code = 'LIVE_TRADING_DISABLED'
          throw err
        }

        const apiKey = decrypt(broker.apiKey)
        const apiSecret = decrypt(broker.apiSecret)
        return { apiKey, apiSecret, paper, baseUrl: getBaseUrl(paper) }
      } catch (err) {
        // Decryption failed or live trading is disabled — fall through to env.
        if (err?.code === 'LIVE_TRADING_DISABLED') throw err
      }
    }
  }

  const apiKey = process.env.ALPACA_API_KEY
  const apiSecret = process.env.ALPACA_API_SECRET
  if (!apiKey || !apiSecret) return null

  const paper = parseEnvBool(process.env.ALPACA_PAPER, true)
  if (!paper && process.env.ALLOW_LIVE_TRADING !== 'true') {
    const err = new Error('Live trading is disabled. Set ALLOW_LIVE_TRADING=true to enable.')
    err.code = 'LIVE_TRADING_DISABLED'
    throw err
  }

  return { apiKey, apiSecret, paper, baseUrl: getBaseUrl(paper) }
}

/**
 * Fetch the Alpaca market clock.
 * Returns a normalized payload: { isOpen, nextOpen, nextClose, timestamp }.
 */
export async function fetchAlpacaMarketClock({ apiKey, apiSecret, baseUrl }) {
  const res = await fetch(`${baseUrl}/v2/clock`, {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret
    }
  })

  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`Alpaca ${res.status}: ${text}`)
    err.statusCode = res.status
    throw err
  }

  const data = await res.json()
  return {
    isOpen: data.is_open,
    nextOpen: data.next_open,
    nextClose: data.next_close,
    timestamp: data.timestamp
  }
}

