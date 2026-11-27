/**
 * Real, production-grade official SEC EDGAR company disclosures evidence fetcher.
 * Retrieves verified regulatory filings (10-K, 10-Q, 8-K) from SEC EDGAR.
 * All URLs are strictly on sec.gov and point-in-time filtered against session boundaries.
 */

const MAX_ROWS = 25
const MAX_TEXT_LEN = 1200

// Standard SEC EDGAR CIK directory across sectors in the TradeLoom universe
export const COMMON_CIKS = Object.freeze({
  SPY: '0000884394',
  QQQ: '0001067839',
  // Technology & Semiconductors
  AAPL: '0000320193',
  MSFT: '0000789019',
  NVDA: '0001045810',
  AMD: '0000002488',
  ORCL: '0001341439',
  CRM: '0001108524',
  ADBE: '0000796343',
  QCOM: '0000804328',
  TXN: '0000097476',
  AMAT: '0000006951',
  INTC: '0000050863',
  IBM: '0000051143',
  CSCO: '0000858877',
  NOW: '0001373715',
  INTU: '0000896878',
  DELL: '0001571996',
  SMCI: '0001375365',
  ACN: '0001467373',
  // Communication Services & Consumer Internet
  GOOGL: '0001652044',
  GOOG: '0001652044',
  META: '0001326801',
  AMZN: '0001018724',
  NFLX: '0001065280',
  DIS: '0001744489',
  CHTR: '0001091667',
  // Consumer Discretionary & Staples
  TSLA: '0001318605',
  HD: '0000354950',
  BKNG: '0001075531',
  MCD: '0000063908',
  NKE: '0000320187',
  TJX: '0000109198',
  COST: '0000909832',
  WMT: '0000104169',
  PG: '0000080424',
  KO: '0000021344',
  PEP: '0000077476',
  PM: '0001413329',
  CL: '0000021665',
  // Financials & Payments
  JPM: '0000019617',
  BAC: '0000070858',
  WFC: '0000072971',
  GS: '0000886982',
  MS: '0000895421',
  C: '0000831001',
  BLK: '0001364742',
  SCHW: '0000316709',
  SPGI: '0000064040',
  ICE: '0001571949',
  CME: '0001156375',
  V: '0001403161',
  MA: '0001141391',
  PGR: '0000080661',
  BRKB: '0001067983',
  'BRK-B': '0001067983',
  // Healthcare & Biotech
  LLY: '0000059478',
  UNH: '0000731766',
  JNJ: '0000200406',
  ABBV: '0001551152',
  MRK: '0000310158',
  ABT: '0000001800',
  TMO: '0000097745',
  DHR: '0000313616',
  AMGN: '0000318154',
  ISRG: '0001035267',
  VRTX: '0000875320',
  REGN: '0000872589',
  SYK: '0000310764',
  BMY: '0000014272',
  ZTS: '0001555280',
  // Industrials, Energy, Materials, Utilities & Real Estate
  CAT: '0000018230',
  DE: '0000315189',
  GE: '0000040545',
  ETN: '0001551182',
  HON: '0000773840',
  RTX: '0000101829',
  LMT: '0000936468',
  BA: '0000012927',
  WM: '0000823768',
  XOM: '0000034088',
  CVX: '0000093410',
  EOG: '0000821189',
  SLB: '0000087347',
  LIN: '0001707925',
  APD: '0000002969',
  SHW: '0000089800',
  NEE: '0000753308',
  DUK: '0001326160',
  SO: '0000092122',
  AMT: '0001053507',
  PLD: '0001045609',
  EQIX: '0001101239'
})

const FORM_8K_ITEM_LABELS = Object.freeze({
  '1.01': 'Entry into Material Definitive Agreement',
  '1.02': 'Termination of Material Definitive Agreement',
  '2.01': 'Completion of Acquisition or Disposition of Assets',
  '2.02': 'Results of Operations and Financial Condition',
  '2.03': 'Creation of Direct Financial Obligation',
  '2.05': 'Exit or Disposal Activities',
  '2.06': 'Material Impairments',
  '3.02': 'Unregistered Sales of Equity Securities',
  '4.01': 'Changes in Certifying Accountant',
  '4.02': 'Non-Reliance on Previously Issued Financial Statements',
  '5.02': 'Departure or Election of Directors or Principal Officers',
  '5.03': 'Amendments to Articles or Bylaws',
  '5.07': 'Submission of Matters to Security Holders Vote',
  '7.01': 'Regulation FD Disclosure',
  '8.01': 'Other Material Corporate Events',
  '9.01': 'Financial Statements and Exhibits'
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

function clampRetrievedTimestamp(cutoffIso, candidateIso = null) {
  const nowIso = candidateIso || new Date().toISOString()
  return nowIso <= cutoffIso ? nowIso : cutoffIso
}

function describeSecFiling({ symbol, issuerName, form, filingDate, reportDate, itemsRaw, docDesc }) {
  const parts = [`${issuerName || symbol} (${symbol}) SEC Form ${form} filed ${filingDate}`]
  if (reportDate && /^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    parts.push(`period ended ${reportDate}`)
  }
  const codes = String(itemsRaw || '')
    .split(',')
    .map(c => c.trim())
    .filter(Boolean)
  if (codes.length) {
    const labeled = codes.map(code => FORM_8K_ITEM_LABELS[code] ? `Item ${code} (${FORM_8K_ITEM_LABELS[code]})` : `Item ${code}`)
    parts.push(`covering ${labeled.join('; ')}`)
  } else if (form === '10-Q') {
    parts.push('Quarterly financial report and MD&A')
  } else if (form === '10-K') {
    parts.push('Annual audited financial report and risk factors')
  }
  const cleanDesc = sanitizeText(docDesc || '', 160)
  if (cleanDesc && cleanDesc.toUpperCase() !== form && cleanDesc.toUpperCase() !== `FORM ${form}`) {
    parts.push(cleanDesc)
  }
  return sanitizeText(parts.join(' — '))
}

/**
 * Fetches official SEC filings for candidate symbols as-of a specific market session.
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

  const cutoffIso = parseDateIso(retrievedCutoff)
  if (!cutoffIso) return []

  const validSymbols = symbols
    .filter(s => typeof s === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(s))
    .slice(0, 100)

  if (!validSymbols.length) return []

  const maxRows = Math.min(MAX_ROWS, Math.max(1, limit))

  // Injected test client / mock
  if (client?.getFilings) {
    try {
      const rows = await client.getFilings({
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
            ...item,
            publishedAt: pub,
            availableAt: avail,
            retrievedAt: ret < avail ? avail : ret
          }
        })
        .filter(Boolean)
        .slice(0, maxRows)
    } catch (err) {
      console.warn('[secFilingsEvidenceFetcher] injected client failed:', err?.message ?? err)
      return []
    }
  }

  const userAgent = env.SEC_EDGAR_USER_AGENT || 'TradeLoom-Research/2.0 (compliance@tradeloom.internal)'
  const baseRetrievedAt = clampRetrievedTimestamp(cutoffIso)

  const mapped = validSymbols
    .map(s => ({ symbol: s, cik: COMMON_CIKS[s] }))
    .filter(m => Boolean(m.cik))

  if (!mapped.length) return []

  // Ensure multi-symbol coverage rather than letting the first symbol starve others
  const perSymbolCap = Math.max(2, Math.ceil(maxRows / mapped.length))
  const collected = []

  // Bounded concurrency (4 at a time) respects SEC fair-access rate limits (<10 req/sec)
  const concurrency = Math.min(4, mapped.length)
  let cursor = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < mapped.length) {
      const { symbol, cik } = mapped[cursor++]
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

        if (!response.ok) continue

        const data = await response.json()
        const recent = data?.filings?.recent
        if (!recent || !Array.isArray(recent.form)) continue

        const issuerName = sanitizeText(data?.name || symbol, 120)
        const count = recent.form.length
        let addedForSymbol = 0

        for (let i = 0; i < count && addedForSymbol < perSymbolCap; i++) {
          const form = String(recent.form[i] || '').toUpperCase()
          if (!['10-K', '10-Q', '8-K', '6-K', 'SC 13D', 'SC 13G'].includes(form)) {
            continue
          }

          const filingDate = String(recent.filingDate[i] || '')
          const acceptanceDateTimeRaw = recent.acceptanceDateTime?.[i]
          const publishedAt = parseDateIso(acceptanceDateTimeRaw) || (filingDate ? `${filingDate}T21:00:00.000Z` : null)
          if (!publishedAt) continue

          // Strict point-in-time check
          if (publishedAt > cutoffIso || filingDate > asOfSession) {
            continue
          }

          const accession = String(recent.accessionNumber[i] || '').replace(/-/g, '')
          const primaryDoc = String(recent.primaryDocument[i] || '')
          if (!accession || !primaryDoc) continue

          const filingUrl = `https://www.sec.gov/Archives/edgar/data/${rawCikNumber}/${accession}/${primaryDoc}`
          const accessionFormatted = String(recent.accessionNumber[i] || '')
          const retrievedAt = baseRetrievedAt < publishedAt ? publishedAt : baseRetrievedAt

          collected.push({
            id: `sec_${accessionFormatted}`,
            title: `${symbol} Form ${form} Filing (${filingDate})`,
            url: filingUrl,
            publishedAt,
            availableAt: publishedAt,
            retrievedAt,
            filingType: form,
            accession: accessionFormatted,
            issuer: symbol,
            summary: describeSecFiling({
              symbol,
              issuerName,
              form,
              filingDate,
              reportDate: recent.reportDate?.[i],
              itemsRaw: recent.items?.[i],
              docDesc: recent.primaryDocDescription?.[i]
            }),
            verifiedSource: true
          })
          addedForSymbol++
        }
      } catch {
        // Individual ticker fetch failure is non-catastrophic
      }
    }
  })

  await Promise.all(workers)

  return collected
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, maxRows)
}
