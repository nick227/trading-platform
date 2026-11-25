/**
 * AI Market Data Ingestion & Freshness Validation Service
 * 
 * Verifies that the point-in-time OHLCV market bars for the complete 10-symbol universe
 * are genuine, complete, strictly historical, and fresh from Alpha Engine.
 */
import { DEFAULT_TRADABLE_SYMBOLS } from '../simulationService.js'
import { engineClient } from '../../clients/engine.js'
import { isExchangeTradingDay } from '../../utils/marketCalendar.js'

export { DEFAULT_TRADABLE_SYMBOLS }

/**
 * Validates that daily OHLCV market bars for all required symbols are present,
 * chronologically sound, and have sufficient historical context up to `session`.
 * 
 * @param {object} options
 * @param {string} options.session Target trading session date (YYYY-MM-DD)
 * @param {string[]} [options.symbols] Universe of symbols (defaults to DEFAULT_TRADABLE_SYMBOLS)
 * @param {object} [options.engine] Alpha Engine client instance
 * @param {number} [options.lookbackBars] Minimum required historical bars (default: 20)
 * @returns {Promise<{
 *   valid: boolean,
 *   session: string,
 *   symbolsValidated: number,
 *   symbolDetails: Record<string, object>,
 *   missingSymbols: string[],
 *   staleSymbols: string[],
 *   invalidBars: string[],
 *   reason?: string
 * }>}
 */
export async function validateAndIngestDailyMarketData({
  session,
  symbols = DEFAULT_TRADABLE_SYMBOLS,
  engine = engineClient,
  lookbackBars = 20
} = {}) {
  if (!session || typeof session !== 'string') {
    return {
      valid: false,
      session: null,
      symbolsValidated: 0,
      symbolDetails: {},
      missingSymbols: [...symbols],
      staleSymbols: [],
      invalidBars: [],
      reason: 'invalid_session_parameter'
    }
  }

  // 1. Verify that session is an official exchange trading day (reject weekends / holidays)
  if (!isExchangeTradingDay(session)) {
    return {
      valid: false,
      session,
      symbolsValidated: 0,
      symbolDetails: {},
      missingSymbols: [],
      staleSymbols: [],
      invalidBars: [],
      reason: 'session_is_not_exchange_trading_day'
    }
  }

  // Lookback window: 120 calendar days guarantees >= 50 trading days
  const sessionDate = new Date(`${session}T00:00:00Z`)
  const lookbackStart = new Date(sessionDate.getTime() - 120 * 86_400_000).toISOString().slice(0, 10)

  const missingSymbols = []
  const staleSymbols = []
  const invalidBars = []
  const symbolDetails = {}

  // 2. Query market bars for each symbol in parallel
  await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await engine.getDailyBars(sym, lookbackStart, session)
      const bars = Array.isArray(res?.bars) ? res.bars : []

      if (!bars.length) {
        missingSymbols.push(sym)
        return
      }

      // Format of each bar: [date, open, high, low, close, volume]
      const latestBar = bars[bars.length - 1]
      const barDate = latestBar[0]

      // Check for stale data: latest bar must match the requested session
      if (barDate < session) {
        staleSymbols.push({ symbol: sym, latestBarDate: barDate, expectedSession: session })
        return
      }

      // Check strictly for zero lookahead: no bar can exceed session
      const futureBar = bars.find(b => b[0] > session)
      if (futureBar) {
        invalidBars.push({ symbol: sym, barDate: futureBar[0], reason: 'future_data_leak' })
        return
      }

      // Check data integrity of the latest bar
      const [date, open, high, low, close, volume] = latestBar
      const numOpen = Number(open)
      const numHigh = Number(high)
      const numLow = Number(low)
      const numClose = Number(close)
      const numVol = Number(volume)

      const isNumericallySound = 
        numOpen > 0 &&
        numClose > 0 &&
        numHigh >= numLow &&
        numHigh >= numOpen &&
        numHigh >= numClose &&
        numLow <= numOpen &&
        numLow <= numClose &&
        numVol >= 0

      if (!isNumericallySound) {
        invalidBars.push({ symbol: sym, bar: latestBar, reason: 'invalid_ohlcv_values' })
        return
      }

      // Check sufficient historical context
      if (bars.length < lookbackBars) {
        invalidBars.push({ symbol: sym, count: bars.length, required: lookbackBars, reason: 'insufficient_history' })
        return
      }

      symbolDetails[sym] = {
        symbol: sym,
        session: barDate,
        barsCount: bars.length,
        open: numOpen,
        high: numHigh,
        low: numLow,
        close: numClose,
        volume: numVol,
        source: res?.source || 'alpha-engine'
      }
    } catch (err) {
      missingSymbols.push(sym)
    }
  }))

  const hasMissing = missingSymbols.length > 0
  const hasStale = staleSymbols.length > 0
  const hasInvalid = invalidBars.length > 0
  const valid = !hasMissing && !hasStale && !hasInvalid

  let reason = null
  if (hasMissing) reason = `missing_symbols: ${missingSymbols.join(',')}`
  else if (hasStale) reason = `stale_symbols: ${staleSymbols.map(s => `${s.symbol}@${s.latestBarDate}`).join(',')}`
  else if (hasInvalid) reason = `invalid_bars: ${invalidBars.map(i => `${i.symbol}(${i.reason})`).join(',')}`

  return {
    valid,
    session,
    symbolsValidated: Object.keys(symbolDetails).length,
    symbolDetails,
    missingSymbols,
    staleSymbols,
    invalidBars,
    reason
  }
}
