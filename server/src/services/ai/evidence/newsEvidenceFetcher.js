/**
 * Real, production-grade financial news evidence fetcher.
 * Connects to licensed financial news providers (Alpaca / Benzinga).
 * All returned text is untrusted research DATA with strict point-in-time bounds.
 */

const MAX_ROWS = 25
const MAX_TEXT_LEN = 1200

function sanitizeText(value, max = MAX_TEXT_LEN) {
  return String(value ?? '')
    .replace(/<[^>]{0,500}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function parseDateIso(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/**
 * Fetches news articles for a list of candidate symbols as-of a specific market session.
 *
 * @param {Object} params
 * @param {string[]} params.symbols - List of uppercase tickers
 * @param {string} params.asOfSession - YYYY-MM-DD completed session
 * @param {string} params.retrievedCutoff - ISO point-in-time barrier timestamp
 * @param {number} [params.limit=25]
 * @param {Object} [params.client] - Optional injected client for testing
 * @param {Object} [params.env=process.env]
 * @returns {Promise<Array<Object>>} Raw items ready for transform into evidenceRegistry
 */
export async function fetchNewsEvidence({
  symbols,
  asOfSession,
  retrievedCutoff,
  limit = MAX_ROWS,
  client = null,
  env = process.env
}) {
  if (!Array.isArray(symbols) || !symbols.length || !asOfSession || !retrievedCutoff) {
    return []
  }

  const validSymbols = symbols
    .filter(s => typeof s === 'string' && /^[A-Z][A-Z0-9.]{0,9}$/.test(s))
    .slice(0, 100)

  if (!validSymbols.length) return []

  const maxRows = Math.min(MAX_ROWS, Math.max(1, limit))
  const apiKey = env.ALPACA_MARKET_DATA_KEY || env.APCA_API_KEY_ID
  const apiSecret = env.ALPACA_MARKET_DATA_SECRET || env.APCA_API_SECRET_KEY

  // Injected test client / mock
  if (client?.getNews) {
    try {
      const rows = await client.getNews({
        symbols: validSymbols,
        asOfSession,
        retrievedCutoff,
        limit: maxRows
      })
      return (Array.isArray(rows) ? rows : [])
        .map(item => ({
          id: String(item.id || ''),
          title: sanitizeText(item.title || item.headline || '', 256),
          url: item.url,
          publishedAt: parseDateIso(item.publishedAt),
          availableAt: parseDateIso(item.availableAt || item.publishedAt),
          retrievedAt: parseDateIso(item.retrievedAt) || new Date().toISOString(),
          excerpt: sanitizeText(item.excerpt || item.summary || item.body || '', 600),
          symbols: Array.isArray(item.symbols) ? item.symbols : []
        }))
        .filter(item => {
          return item.id && item.title && item.url && item.publishedAt &&
            item.publishedAt <= retrievedCutoff && item.publishedAt.slice(0, 10) <= asOfSession
        })
        .slice(0, maxRows)
    } catch (err) {
      console.warn('[newsEvidenceFetcher] injected client failed:', err?.message ?? err)
      return []
    }
  }

  // If no API key configured, fail open with empty list (non-catastrophic)
  if (!apiKey || !apiSecret) {
    return []
  }

  try {
    const endTimestamp = retrievedCutoff.includes('T') ? retrievedCutoff : `${asOfSession}T23:59:59Z`
    const url = new URL('https://data.alpaca.markets/v1beta1/news')
    url.searchParams.set('symbols', validSymbols.join(','))
    url.searchParams.set('end', endTimestamp)
    url.searchParams.set('limit', String(maxRows))
    url.searchParams.set('include_content', 'false')

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(6000)
    })

    if (!response.ok) {
      console.warn(`[newsEvidenceFetcher] Alpaca news API returned status ${response.status}`)
      return []
    }

    const payload = await response.json()
    const rawNews = Array.isArray(payload?.news) ? payload.news : []
    const retrievedAt = new Date().toISOString()
    const results = []

    for (const article of rawNews) {
      const publishedAt = parseDateIso(article.created_at || article.updated_at)
      if (!publishedAt) continue

      // Strict point-in-time check: must be strictly <= retrievedCutoff and session date
      if (publishedAt > retrievedCutoff || publishedAt.slice(0, 10) > asOfSession) {
        continue
      }

      const id = String(article.id || '').trim()
      const title = sanitizeText(article.headline || '', 256)
      let articleUrl = article.url
      try {
        const parsed = new URL(articleUrl)
        if (parsed.protocol !== 'https:') articleUrl = null
      } catch {
        articleUrl = null
      }

      if (!id || !title || !articleUrl) continue

      results.push({
        id,
        title,
        url: articleUrl,
        publishedAt,
        availableAt: publishedAt,
        retrievedAt,
        excerpt: sanitizeText(article.summary || article.headline, 600),
        symbols: Array.isArray(article.symbols) ? article.symbols : []
      })

      if (results.length >= maxRows) break
    }

    return results
  } catch (err) {
    console.warn('[newsEvidenceFetcher] request failed:', err?.message ?? err)
    return []
  }
}
