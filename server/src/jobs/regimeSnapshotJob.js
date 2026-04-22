import prisma from '../loaders/prisma.js'

function getEngineUrl() {
  return process.env.ENGINE_URL ?? 'http://localhost:8090'
}

function getInternalReadKey() {
  return process.env.INTERNAL_READ_KEY
}

function parseAsOfDate(asOf) {
  if (!asOf || typeof asOf !== 'string') return null
  // Expected: YYYY-MM-DD
  const d = new Date(`${asOf}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * Fetches the latest regime snapshot for a symbol from Alpha Engine.
 *
 * Endpoint:
 *   GET {ENGINE_URL}/api/regime/{symbol}
 *
 * Header:
 *   X-Internal-Key: INTERNAL_READ_KEY (if set)
 *
 * Expected response:
 * {
 *   "ticker": "SPY",
 *   "regime": "risk_on",
 *   "score": 0.9,
 *   "asOf": "2026-04-21",
 *   "sma20": 672.197,
 *   "sma200": 664.1134,
 *   "close": 706.8299,
 *   "confirmedBars": 5
 * }
 */
export async function fetchAlphaEngineRegime(symbol) {
  const url = `${getEngineUrl()}/api/regime/${encodeURIComponent(symbol)}`
  const headers = {}
  const key = getInternalReadKey()
  if (key) headers['X-Internal-Key'] = key

  const res = await fetch(url, { headers })
  const rawText = await res.text()

  let json
  try {
    json = rawText ? JSON.parse(rawText) : null
  } catch {
    json = null
  }

  return { ok: res.ok, status: res.status, rawText, json }
}

function coerceNumber(value) {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function coerceInt(value) {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function safeTicker(symbol, payload) {
  const t = (payload?.ticker ?? symbol ?? '').toString().toUpperCase()
  return t.length ? t : symbol.toUpperCase()
}

/**
 * Fetches regime snapshots for a list of symbols and upserts MarketRegime rows.
 *
 * Behavior:
 * - 422: logs warning and skips the symbol (insufficient history)
 * - network/other non-OK: logs error and skips the symbol
 * - REGIME_DEBUG=true: prints raw response and performs NO DB writes
 * - never throws (returns a result array)
 */
export async function runRegimeSnapshot(symbols = ['SPY']) {
  const results = []

  for (const rawSymbol of symbols) {
    const symbol = String(rawSymbol).trim().toUpperCase()
    if (!symbol) continue

    try {
      const response = await fetchAlphaEngineRegime(symbol)

      if (!response.ok) {
        if (response.status === 422) {
          console.warn(`[regimeSnapshot] ${symbol}: Alpha Engine returned 422 (insufficient_history). Skipping.`)
          results.push({ symbol, skipped: true, reason: 'insufficient_history', status: 422 })
          continue
        }

        console.error(`[regimeSnapshot] ${symbol}: Alpha Engine error ${response.status}. Skipping.`)
        results.push({ symbol, skipped: true, reason: 'engine_error', status: response.status })
        continue
      }

      const data = response.json
      if (!data || typeof data !== 'object') {
        console.error(`[regimeSnapshot] ${symbol}: invalid JSON response. Skipping.`)
        results.push({ symbol, skipped: true, reason: 'invalid_json' })
        continue
      }

      if (process.env.REGIME_DEBUG === 'true') {
        console.log(`[regimeSnapshot] raw regime response (${symbol}):`, JSON.stringify(data, null, 2))
        results.push({ symbol, dryRun: true, data })
        continue
      }

      const asOf = parseAsOfDate(data.asOf)
      if (!asOf) {
        console.error(`[regimeSnapshot] ${symbol}: invalid asOf "${data.asOf}". Skipping.`)
        results.push({ symbol, skipped: true, reason: 'invalid_asof' })
        continue
      }

      const ticker = safeTicker(symbol, data)
      const regime = typeof data.regime === 'string' ? data.regime : null
      if (regime !== 'risk_on' && regime !== 'risk_off') {
        console.error(`[regimeSnapshot] ${symbol}: invalid regime "${data.regime}". Skipping.`)
        results.push({ symbol, skipped: true, reason: 'invalid_regime' })
        continue
      }

      const row = await prisma.marketRegime.upsert({
        where: { symbol_asOf: { symbol: ticker, asOf } },
        update: {
          regime,
          score: coerceNumber(data.score),
          sma20: coerceNumber(data.sma20),
          sma200: coerceNumber(data.sma200),
          priceClose: coerceNumber(data.close),
          inputsJson: data
        },
        create: {
          id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          symbol: ticker,
          asOf,
          regime,
          score: coerceNumber(data.score),
          sma20: coerceNumber(data.sma20),
          sma200: coerceNumber(data.sma200),
          priceClose: coerceNumber(data.close),
          inputsJson: data,
          createdAt: new Date()
        }
      })

      results.push({
        symbol: ticker,
        upserted: true,
        asOf: row.asOf,
        regime: row.regime,
        confirmedBars: coerceInt(data.confirmedBars)
      })
    } catch (err) {
      console.error(`[regimeSnapshot] ${symbol}: network/unexpected error. Skipping.`, err?.message ?? err)
      results.push({ symbol, skipped: true, reason: 'exception', error: err?.message ?? String(err) })
    }
  }

  return results
}
