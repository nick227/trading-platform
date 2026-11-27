/**
 * Licensed financial news evidence fetcher (Alpaca / Benzinga News API).
 * Strictly enforces point-in-time session bounds and strips untrusted HTML.
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

function clampRetrievedTimestamp(cutoffIso, candidateIso = null) {
  const nowIso = candidateIso || new Date().toISOString()
  return nowIso <= cutoffIso ? nowIso : cutoffIso
}

/**
 * Fetches news articles for a list of candidate symbols as-of a specific market session.
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

  const cutoffIso = parseDateIso(retrievedCutoff)
  if (!cutoffIso) return []

  const validSymbols = symbols
    .filter(s => typeof s === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(s))
    .slice(0, 100)

  if (!validSymbols.length) return []

  const maxRows = Math.min(MAX_ROWS, Math.max(1, limit))
  const apiKey = env.ALPACA_MARKET_DATA_KEY || env.APCA_API_KEY_ID || env.ALPACA_API_KEY
  const apiSecret = env.ALPACA_MARKET_DATA_SECRET || env.APCA_API_SECRET_KEY || env.ALPACA_API_SECRET

  // Injected test client / mock
  if (client?.getNews) {
    try {
      const rows = await client.getNews({
        symbols: validSymbols,
        asOfSession,
        retrievedCutoff: cutoffIso,
        limit: maxRows
      })
      return (Array.isArray(rows) ? rows : [])
        .map(item => {
          const pub = parseDateIso(item.publishedAt)
          if (!pub || pub > cutoffIso || pub.slice(0, 10) > asOfSession) return null
          const avail = parseDateIso(item.availableAt || pub)
          if (!avail || avail > cutoffIso) return null
          const ret = clampRetrievedTimestamp(cutoffIso, parseDateIso(item.retrievedAt))
          return {
            id: String(item.id || ''),
            title: sanitizeText(item.title || item.headline || '', 256),
            url: item.url,
            publishedAt: pub,
            availableAt: avail,
            retrievedAt: ret < avail ? avail : ret,
            excerpt: sanitizeText(item.excerpt || item.summary || item.body || '', 600),
            symbols: Array.isArray(item.symbols) ? item.symbols : []
          }
        })
        .filter(item => item && item.id && item.title && item.url)
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
    const url = new URL('https://data.alpaca.markets/v1beta1/news')
    url.searchParams.set('symbols', validSymbols.join(','))
    url.searchParams.set('end', cutoffIso)
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
    const baseRetrievedAt = clampRetrievedTimestamp(cutoffIso)
    const results = []

    for (const article of rawNews) {
      const publishedAt = parseDateIso(article.created_at || article.updated_at)
      if (!publishedAt) continue

      // Strict point-in-time check: must be strictly <= cutoffIso and session date
      if (publishedAt > cutoffIso || publishedAt.slice(0, 10) > asOfSession) {
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

      const retrievedAt = baseRetrievedAt < publishedAt ? publishedAt : baseRetrievedAt
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
