/**
 * On-demand company/asset metadata from Alpaca's Assets API, for supported symbols only.
 *
 * Read-only (GET /v2/assets/{symbol}) with the service-level market-data credential; never an
 * order path. Results are cached in memory for a day (asset records change rarely); failures
 * are not cached, so a later lookup retries. No market-wide ingestion, no discovery surface.
 */
import { DEFAULT_TRADABLE_SYMBOLS, simulationConfig } from './simulationService.js'

export const ASSET_TTL_MS = 24 * 60 * 60_000
const cache = new Map() // symbol -> { at, data }

export function supportedSymbols(config = simulationConfig()) {
  return config.tradableSymbols ?? DEFAULT_TRADABLE_SYMBOLS
}

export function marketDataCredentials(env = process.env) {
  const apiKey = env.ALPACA_MARKET_DATA_KEY || env.APCA_API_KEY_ID || null
  const apiSecret = env.ALPACA_MARKET_DATA_SECRET || env.APCA_API_SECRET_KEY || null
  if (!apiKey || !apiSecret) return null
  const paper = env.ALPACA_MARKET_DATA_PAPER !== 'false'
  return { apiKey, apiSecret, baseUrl: paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets' }
}

export function resetAssetCache() { cache.clear() }

/**
 * { status: 'available', symbol, name, exchange, assetClass, tradable, fractionable, shortable, source, fetchedAt }
 * | { status: 'unsupported' | 'unavailable', symbol, reason }
 */
export async function getAssetMetadata(rawSymbol, { fetchImpl = globalThis.fetch, env = process.env, config = simulationConfig(), now = Date.now } = {}) {
  const symbol = String(rawSymbol ?? '').trim().toUpperCase()
  if (!supportedSymbols(config).includes(symbol)) return { status: 'unsupported', symbol, reason: 'not_in_supported_universe' }
  const hit = cache.get(symbol)
  if (hit && now() - hit.at < ASSET_TTL_MS) return hit.data
  const creds = marketDataCredentials(env)
  if (!creds) return { status: 'unavailable', symbol, reason: 'not_configured' }
  let res
  try {
    res = await fetchImpl(`${creds.baseUrl}/v2/assets/${encodeURIComponent(symbol)}`, {
      headers: { 'APCA-API-KEY-ID': creds.apiKey, 'APCA-API-SECRET-KEY': creds.apiSecret, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    return { status: 'unavailable', symbol, reason: 'unreachable' }
  }
  if (!res.ok) return { status: 'unavailable', symbol, reason: `http_${res.status}` }
  const a = await res.json().catch(() => null)
  if (!a || String(a.symbol ?? '').toUpperCase() !== symbol) return { status: 'unavailable', symbol, reason: 'invalid_response' }
  const data = {
    status: 'available', symbol, name: a.name ?? null, exchange: a.exchange ?? null, assetClass: a.class ?? null,
    tradable: a.tradable === true, fractionable: a.fractionable === true, shortable: a.shortable === true,
    assetStatus: a.status ?? null, source: 'alpaca', fetchedAt: new Date(now()).toISOString(),
  }
  cache.set(symbol, { at: now(), data })
  return data
}
