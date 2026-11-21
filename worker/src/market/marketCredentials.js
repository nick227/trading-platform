/**
 * Service-level market data credentials.
 * Alpaca market data stream is market-wide and shared across the worker.
 * It must use an explicit service-level credential, never an arbitrary customer account.
 */
export function getMarketDataCredentials() {
  const apiKey = process.env.ALPACA_MARKET_DATA_KEY ||
                 process.env.MARKET_DATA_API_KEY ||
                 process.env.APCA_API_KEY_ID ||
                 process.env.ALPACA_API_KEY_ID || null

  const apiSecret = process.env.ALPACA_MARKET_DATA_SECRET ||
                    process.env.MARKET_DATA_API_SECRET ||
                    process.env.APCA_API_SECRET_KEY ||
                    process.env.ALPACA_API_SECRET_KEY || null

  const paper = process.env.ALPACA_MARKET_DATA_PAPER !== 'false'

  if (apiKey && apiSecret) {
    return { apiKey, apiSecret, paper }
  }

  return null
}
