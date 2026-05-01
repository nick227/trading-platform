import prisma from '../loaders/prisma.js'
import { decrypt } from '../utils/encryption.js'

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets'
const LIVE_BASE_URL = 'https://api.alpaca.markets'

function getBaseUrl(paper) {
  return paper ? PAPER_BASE_URL : LIVE_BASE_URL
}

/**
 * Resolve Alpaca credentials for a user from BrokerAccount only.
 * Throws when credentials are missing or invalid.
 */
export async function getUserAlpacaCredentialsOrThrow(userId) {
  const broker = await prisma.brokerAccount.findUnique({ where: { userId } })
  if (!broker?.apiKey || !broker?.apiSecret) {
    const err = new Error('Alpaca credentials not configured')
    err.code = 'BROKER_NOT_CONFIGURED'
    throw err
  }

  const paper = broker.paper !== false
  if (!paper && process.env.ALLOW_LIVE_TRADING !== 'true') {
    const err = new Error('Live trading is disabled. Set ALLOW_LIVE_TRADING=true to enable.')
    err.code = 'LIVE_TRADING_DISABLED'
    throw err
  }

  let apiKey
  let apiSecret
  try {
    apiKey = decrypt(broker.apiKey)
    apiSecret = decrypt(broker.apiSecret)
  } catch {
    const err = new Error('Stored Alpaca credentials are invalid')
    err.code = 'BROKER_CREDENTIALS_INVALID'
    throw err
  }

  if (!apiKey || !apiSecret) {
    const err = new Error('Stored Alpaca credentials are invalid')
    err.code = 'BROKER_CREDENTIALS_INVALID'
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

