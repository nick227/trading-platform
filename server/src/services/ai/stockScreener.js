/**
 * Point-in-time stock screening. No language-model calls and no orders.
 * Only uses bars available at the exact completed exchange session.
 */
const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/
const DAY_MS = 86_400_000

function round(value, decimals = 4) {
  return Number(value.toFixed(decimals))
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function scoreStockBars(symbol, bars, session, {
  minBars = 51,
  minPrice = 5,
  minDollarVolume = 10_000_000
} = {}) {
  if (!SYMBOL_RE.test(symbol)) return { symbol, eligible: false, reason: 'invalid_symbol' }
  if (!Array.isArray(bars) || bars.length < minBars) {
    return { symbol, eligible: false, reason: 'insufficient_history' }
  }

  let previousDate = ''
  const closes = []
  const volumes = []
  for (const bar of bars) {
    if (!Array.isArray(bar) || bar.length < 6) {
      return { symbol, eligible: false, reason: 'invalid_bar' }
    }
    const [date, open, high, low, close, volume] = bar
    if (typeof date !== 'string' || date <= previousDate || date > session) {
      return { symbol, eligible: false, reason: date > session ? 'future_data' : 'invalid_chronology' }
    }
    previousDate = date
    if (![open, high, low, close, volume].every(Number.isFinite) ||
        open <= 0 || close <= 0 || volume < 0 || low <= 0 ||
        high < Math.max(open, close) || low > Math.min(open, close)) {
      return { symbol, eligible: false, reason: 'invalid_bar' }
    }
    closes.push(close)
    volumes.push(volume)
  }
  if (previousDate !== session) return { symbol, eligible: false, reason: 'stale_data' }

  const price = closes.at(-1)
  const sma20 = average(closes.slice(-20))
  const sma50 = average(closes.slice(-50))
  const volume20 = average(volumes.slice(-20))
  const ratio = volume20 > 0 ? volumes.at(-1) / volume20 : 0
  const dollarVolume = price * volume20
  if (price < minPrice || dollarVolume < minDollarVolume) {
    return { symbol, eligible: false, reason: 'liquidity_or_price' }
  }

  const return5dPct = 100 * (price / closes.at(-6) - 1)
  const return20dPct = 100 * (price / closes.at(-21) - 1)
  const excess20Pct = 100 * (price / sma20 - 1)
  const excess50Pct = 100 * (price / sma50 - 1)

  // Ranking score is intentionally transparent and bounded.
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
  const score = round(
    clamp(return20dPct, -20, 20) * 2 +
    clamp(return5dPct, -10, 10) * 1.5 +
    clamp(excess20Pct, -15, 15) +
    clamp(excess50Pct, -20, 20) * 0.5 +
    clamp((ratio - 1) * 10, -10, 20)
  )

  return {
    symbol,
    eligible: true,
    score,
    indicators: {
      price: round(price),
      sma20: round(sma20),
      sma50: round(sma50),
      volumeRatio: round(ratio),
      return5dPct: round(return5dPct),
      return20dPct: round(return20dPct),
      excess20Pct: round(excess20Pct),
      excess50Pct: round(excess50Pct),
      averageDollarVolume: round(dollarVolume, 2)
    }
  }
}

export async function screenAiStockUniverse({
  engine,
  session,
  symbols,
  heldSymbols = [],
  shortlistLimit = 15,
  lookbackDays = 150,
  options = {}
}) {
  if (!engine || typeof engine.getDailyBars !== 'function') throw new TypeError('Market data client is required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session) || Number.isNaN(Date.parse(session + 'T00:00:00Z'))) {
    throw new Error('Valid as-of session required')
  }
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > 500) {
    throw new Error('Stock universe must contain 1–500 symbols')
  }
  if (!Number.isInteger(shortlistLimit) || shortlistLimit < 1 || shortlistLimit > 100) {
    throw new Error('Invalid shortlist limit')
  }
  const universe = [...new Set(symbols.map(s => String(s).trim().toUpperCase()))].sort()
  const holdings = [...new Set(heldSymbols.map(s => String(s).trim().toUpperCase()))].sort()
  // Holdings are always evaluated, including those not in the new-buy universe.
  const allSymbols = [...new Set([...universe, ...holdings])].sort()
  const lookbackStart = new Date(Date.parse(session + 'T00:00:00Z') - lookbackDays * DAY_MS).toISOString().slice(0, 10)

  const evaluated = await Promise.all(allSymbols.map(async symbol => {
    try {
      const result = await engine.getDailyBars(symbol, lookbackStart, session)
      const assessment = scoreStockBars(symbol, result?.bars, session, options)
      return { ...assessment, held: holdings.includes(symbol), inUniverse: universe.includes(symbol) }
    } catch {
      return { symbol, held: holdings.includes(symbol), inUniverse: universe.includes(symbol), eligible: false, reason: 'market_data_unavailable' }
    }
  }))

  const ranked = evaluated.filter(row => row.eligible && row.inUniverse)
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
  const shortlist = ranked.slice(0, shortlistLimit)
  const included = new Set(shortlist.map(s => s.symbol))
  // Existing positions can require a SELL/HOLD decision even if not shortlisted.
  for (const item of evaluated.filter(row => row.held)) {
    if (!included.has(item.symbol)) {
      shortlist.push(item)
      included.add(item.symbol)
    }
  }

  return {
    asOfSession: session,
    methodology: 'technical-screener-v1',
    universeSize: universe.length,
    eligibleCount: ranked.length,
    shortlist,
    excluded: evaluated.filter(row => !row.eligible),
    ranking: ranked.map(row => ({ symbol: row.symbol, score: row.score }))
  }
}
