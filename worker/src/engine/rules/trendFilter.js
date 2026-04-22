import prisma from '../../db/prisma.js'

// MarketRegime data changes at most once per trading session — cache per symbol
// to avoid a DB query on every price tick.
const regimeCache = new Map() // symbol → { data, fetchedAt }
const REGIME_CACHE_TTL_MS = 5 * 60_000 // 5 minutes

// config: {
//   symbol?: string,
//   confirmationBars?: number,
//   maxSnapshotAgeHours?: number,
//   requiredRegime?: 'risk_on' | 'risk_off',
//   side?: 'buy' | 'sell'
// }
export async function evaluateTrendFilter(config) {
  const symbol = (config?.symbol ?? 'SPY').toUpperCase()
  const confirmationBars = Math.max(1, Number(config?.confirmationBars ?? 2))
  const maxSnapshotAgeHours = Number(config?.maxSnapshotAgeHours ?? 90)

  const side = typeof config?.side === 'string' ? config.side.toLowerCase() : null
  const requiredRegime = config?.requiredRegime
    ?? (side === 'sell' ? 'risk_off' : 'risk_on')

  const now = Date.now()
  const cached = regimeCache.get(symbol)
  let latest = cached && now - cached.fetchedAt < REGIME_CACHE_TTL_MS
    ? cached.data
    : null

  if (!latest) {
    latest = await prisma.marketRegime.findFirst({
      where: { symbol },
      orderBy: { asOf: 'desc' },
      select: { asOf: true, regime: true, createdAt: true, inputsJson: true }
    })
    regimeCache.set(symbol, { data: latest, fetchedAt: now })
  }

  if (!latest) {
    return { pass: false, reason: 'trend_filter_missing_snapshot', detail: 'no MarketRegime snapshot found' }
  }

  const ageHours = (Date.now() - latest.createdAt.getTime()) / 3_600_000
  if (Number.isFinite(maxSnapshotAgeHours) && ageHours > maxSnapshotAgeHours) {
    return {
      pass: false,
      reason: 'trend_filter_snapshot_stale',
      detail: `latest snapshot is ${ageHours.toFixed(1)}h old (max ${maxSnapshotAgeHours}h)`
    }
  }

  const confirmedBars = Number(latest?.inputsJson?.confirmedBars ?? 0)
  if (!Number.isFinite(confirmedBars) || confirmedBars < confirmationBars) {
    return {
      pass: false,
      reason: 'trend_filter_not_confirmed',
      detail: `confirmedBars=${confirmedBars} (need >= ${confirmationBars})`
    }
  }

  if (latest.regime !== requiredRegime) {
    return {
      pass: false,
      reason: 'trend_filter_regime_mismatch',
      detail: `regime=${latest.regime} required=${requiredRegime}`
    }
  }

  return {
    pass: true,
    detail: `regime=${latest.regime} confirmedBars=${confirmedBars} asOf=${latest.asOf.toISOString().slice(0, 10)}`
  }
}
