/**
 * Real, production-grade official SEC EDGAR company disclosures evidence fetcher.
 * Retrieves verified regulatory filings (10-K, 10-Q, 8-K) from SEC EDGAR.
 * All URLs are strictly on sec.gov and point-in-time filtered against session boundaries.
 */

const MAX_ROWS = 25
const MAX_TEXT_LEN = 1200

// Standard CIK directory for major US market symbols
const COMMON_CIKS = Object.freeze({
  SPY: '0000884394',
  QQQ: '0001067839',
  AAPL: '0000320193',
  MSFT: '0000789019',
  NVDA: '0001045810',
  AMZN: '0001018724',
  GOOGL: '0001652044',
  GOOG: '0001652044',
  JPM: '0000019617',
  XOM: '0000034088',
  META: '0001326801',
  TSLA: '0001318605',
  BRKB: '0001067983'
})

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
 * Fetches official SEC filings for candidate symbols as-of a specific market session.
 *
 * @param {Object} params
 * @param {string[]} params.symbols - List of uppercase tickers
 * @param {string} params.asOfSession - YYYY-MM-DD completed session
 * @param {string} params.retrievedCutoff - ISO point-in-time barrier timestamp
 * @param {number} [params.limit=25]
 * @param {Object} [params.client] - Optional injected client for tests
 * @param {Object} [params.env=process.env]
 * @returns {Promise<Array<Object>>} Raw items ready for transform into evidenceRegistry
 */
export async function fetchSecFilingsEvidence({
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

  // Injected test client / mock
  if (client?.getFilings) {
    try {
      const rows = await client.getFilings({
        symbols: validSymbols,
        asOfSession,
        retrievedCutoff,
        limit: maxRows
      })
      return (Array.isArray(rows) ? rows : []).filter(item => {
        const pub = parseDateIso(item.publishedAt)
        return pub && pub <= retrievedCutoff && pub.slice(0, 10) <= asOfSession
      }).slice(0, maxRows)
    } catch (err) {
      console.warn('[secFilingsEvidenceFetcher] injected client failed:', err?.message ?? err)
      return []
    }
  }

  const userAgent = env.SEC_EDGAR_USER_AGENT || 'TradeLoom-Research/2.0 (compliance@tradeloom.internal)'
  const retrievedAt = new Date().toISOString()
  const results = []

  // Check CIK-mapped symbols
  const mapped = validSymbols
    .map(s => ({ symbol: s, cik: COMMON_CIKS[s] }))
    .filter(m => Boolean(m.cik))

  for (const { symbol, cik } of mapped) {
    if (results.length >= maxRows) break

    try {
      const paddedCik = cik.padStart(10, '0')
      const rawCikNumber = String(parseInt(cik, 10))
      const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      })

      if (!response.ok) {
        continue
      }

      const data = await response.json()
      const recent = data?.filings?.recent
      if (!recent || !Array.isArray(recent.form)) continue

      const count = recent.form.length
      for (let i = 0; i < count; i++) {
        const form = String(recent.form[i] || '').toUpperCase()
        if (!['10-K', '10-Q', '8-K', '6-K', 'SC 13D', 'SC 13G'].includes(form)) {
          continue
        }

        const filingDate = String(recent.filingDate[i] || '')
        const acceptanceDateTimeRaw = recent.acceptanceDateTime?.[i]
        const publishedAt = parseDateIso(acceptanceDateTimeRaw) || (filingDate ? `${filingDate}T21:00:00Z` : null)
        if (!publishedAt) continue

        // Strict point-in-time check
        if (publishedAt > retrievedCutoff || filingDate > asOfSession) {
          continue
        }

        const accession = String(recent.accessionNumber[i] || '').replace(/-/g, '')
        const primaryDoc = String(recent.primaryDocument[i] || '')
        if (!accession || !primaryDoc) continue

        const filingUrl = `https://www.sec.gov/Archives/edgar/data/${rawCikNumber}/${accession}/${primaryDoc}`
        const accessionFormatted = String(recent.accessionNumber[i] || '')

        results.push({
          id: `sec_${accessionFormatted}`,
          title: `${symbol} Form ${form} Filing (${filingDate})`,
          url: filingUrl,
          publishedAt,
          availableAt: publishedAt,
          retrievedAt,
          filingType: form,
          accession: accessionFormatted,
          issuer: symbol,
          summary: sanitizeText(recent.primaryDocDescription?.[i] || `Official SEC Form ${form} filed by ${symbol} on ${filingDate}`),
          verifiedSource: true
        })

        if (results.length >= maxRows) break
      }
    } catch (err) {
      // Individual ticker fetch failure is non-catastrophic
      continue
    }
  }

  return results
}
