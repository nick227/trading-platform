/**
 * Research-driven bot decisions: a pure policy over a *verified* Alpha Engine trace.
 *
 * Alpha Engine publishes research only (trace.trading.actionable === false). The
 * trading decision is TradeLoom's, made here from the stored prediction snapshot that
 * will be persisted with the decision. Every check fails closed:
 *   - suppressed: research exists but the run/age makes it untrustworthy right now
 *   - rejected:   research is current but does not justify this bot trading it
 *   - accepted:   the bot may create an execution (final M6 risk checks still apply)
 *
 * Alpha Engine confidence is strategy-defined and uncalibrated (not a probability);
 * minConfidence compares against that score as published.
 */

export const RESEARCH_SIGNAL_SOURCE = 'alpha_research'

export const RESEARCH_POLICY_DEFAULTS = Object.freeze({
  tenantId: 'default',
  minConfidence: 0.6,
  maxPredictionAgeHours: 96, // daily pipeline + weekend gap
  maxEntryDriftPct: 5,
  allowedHorizons: null, // null = any published horizon
  // Only trade research whose (recomputed, published) holdout beat the always-up baseline.
  requireEdgeOverBaseline: true,
})

const MAX_FUTURE_SKEW_MS = 5 * 60_000

const BUY_DIRECTIONS = new Set(['buy', 'up', 'long'])
const SELL_DIRECTIONS = new Set(['sell', 'down', 'short'])

export function isResearchDriven(bot) {
  return bot?.config?.signalSource === RESEARCH_SIGNAL_SOURCE
}

function finite(v) {
  const n = typeof v === 'number' ? v : Number(v)
  return v !== null && v !== '' && Number.isFinite(n) ? n : null
}

/** Resolve and validate a bot's research policy. Returns { ok, policy } or { ok: false, reason }. */
export function resolveResearchPolicy(config) {
  const raw = config?.research && typeof config.research === 'object' ? config.research : {}
  const policy = { ...RESEARCH_POLICY_DEFAULTS }
  if (raw.tenantId != null) {
    if (typeof raw.tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.tenantId)) return { ok: false, reason: 'invalid_tenant' }
    policy.tenantId = raw.tenantId
  }
  for (const [key, min, max] of [['minConfidence', 0, 1], ['maxPredictionAgeHours', 1, 24 * 30], ['maxEntryDriftPct', 0, 50]]) {
    if (raw[key] == null) continue
    const n = finite(raw[key])
    if (n === null || n < min || n > max) return { ok: false, reason: `invalid_${key}` }
    policy[key] = n
  }
  if (raw.requireEdgeOverBaseline != null) {
    if (typeof raw.requireEdgeOverBaseline !== 'boolean') return { ok: false, reason: 'invalid_requireEdgeOverBaseline' }
    policy.requireEdgeOverBaseline = raw.requireEdgeOverBaseline
  }
  if (raw.allowedHorizons != null) {
    if (!Array.isArray(raw.allowedHorizons) || raw.allowedHorizons.length === 0 ||
        !raw.allowedHorizons.every((h) => typeof h === 'string' && h.length <= 16)) {
      return { ok: false, reason: 'invalid_allowedHorizons' }
    }
    policy.allowedHorizons = raw.allowedHorizons.map((h) => h.toLowerCase())
  }
  return { ok: true, policy }
}

export function researchDirection(value) {
  const d = String(value ?? '').trim().toLowerCase()
  if (BUY_DIRECTIONS.has(d)) return 'buy'
  if (SELL_DIRECTIONS.has(d)) return 'sell'
  return null
}

/**
 * @param {object} args
 * @param {object} args.trace       verified research-trace/v1 payload
 * @param {object} [args.located]   ranking index row ({ run: { intelligenceConfidenceTier, rankedUnderDegradedRun, runStatus } })
 * @param {object} args.policy      resolved policy
 * @param {number} args.price       current reference price for the ticker
 * @param {string|null} args.configDirection optional bot direction filter ('buy' | 'sell')
 * @param {Date} args.now
 */
export function evaluateResearchDecision({ trace, located, policy, price, configDirection = null, now }) {
  const snapshot = trace?.evidence?.snapshot ?? {}
  const context = {
    policy,
    price: finite(price),
    run: located?.run ?? null,
    predictionDirection: snapshot.direction ?? null,
    horizon: snapshot.horizon ?? null,
    researchConfidence: finite(snapshot.confidence),
    confidenceIsProbability: false,
  }
  const out = (decision, reason, extra = {}) => ({ decision, reason, signal: extra.signal ?? null, confidence: context.researchConfidence, context: { ...context, ...extra, reason } })

  // 1. Run quality: research from a degraded or suppressed run is not traded.
  const run = located?.run
  if (run && run.intelligenceConfidenceTier !== 'full') return out('suppressed', 'research_tier_not_full')
  if (run && (run.rankedUnderDegradedRun === true || ['DEGRADED', 'FAILED'].includes(String(run.runStatus ?? '').toUpperCase()))) {
    return out('suppressed', 'degraded_research_run')
  }

  // 2. Direction.
  const signal = researchDirection(snapshot.direction)
  if (!signal) return out('rejected', 'ambiguous_research_direction')

  // 3. Point-in-time validity.
  const observedMs = Date.parse(snapshot.observedAt)
  if (!Number.isFinite(observedMs)) return out('rejected', 'invalid_observed_at', { signal })
  const ageMs = now.getTime() - observedMs
  if (ageMs < -MAX_FUTURE_SKEW_MS) return out('rejected', 'observed_in_future', { signal })
  const ageHours = Math.round((ageMs / 3_600_000) * 100) / 100
  if (ageHours > policy.maxPredictionAgeHours) return out('suppressed', 'stale_prediction', { signal, ageHours })

  // 4. Horizon.
  if (policy.allowedHorizons && !policy.allowedHorizons.includes(String(snapshot.horizon ?? '').toLowerCase())) {
    return out('rejected', 'horizon_not_allowed', { signal, ageHours })
  }

  // 5. Confidence (uncalibrated score, compared as published).
  if (context.researchConfidence === null || context.researchConfidence < policy.minConfidence) {
    return out('rejected', 'below_min_confidence', { signal, ageHours })
  }

  // 5b. Edge over baseline, from the verified evidence (never from the locator).
  const evaluation = snapshot.ranking?.evaluation ?? null
  context.edgeOverBaseline = evaluation ? evaluation.edgeOverBaseline === true : null
  context.genuineOutOfSample = evaluation ? evaluation.genuineOutOfSample === true : null
  if (policy.requireEdgeOverBaseline && context.edgeOverBaseline !== true) {
    return out('rejected', 'no_edge_over_baseline', { signal, ageHours })
  }

  // 6. Bot direction filter.
  if (configDirection && configDirection !== signal) return out('rejected', 'direction_mismatch', { signal, ageHours })

  // 7. The research's entry thesis must still describe today's price.
  const entry = finite(snapshot.entryPrice)
  if (entry === null || entry <= 0) return out('rejected', 'missing_entry_price', { signal, ageHours })
  if (context.price === null || context.price <= 0) return out('rejected', 'missing_price', { signal, ageHours })
  const driftPct = Math.round((Math.abs(context.price - entry) / entry) * 10_000) / 100
  if (driftPct > policy.maxEntryDriftPct) return out('rejected', 'entry_price_drift', { signal, ageHours, driftPct })

  return out('accepted', 'research_accepted', { signal, ageHours, driftPct })
}
