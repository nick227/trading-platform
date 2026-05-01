// Pure transforms for prediction and signal data.
// No React dependency — safe to import anywhere.

export function coerceConfidence(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num > 1 && num <= 100) return num / 100
  if (num < 0) return 0
  if (num > 1) return 1
  return num
}

export function directionFromPrediction(prediction) {
  if (typeof prediction === 'number') {
    if (prediction > 0) return 'bullish'
    if (prediction < 0) return 'bearish'
    return 'neutral'
  }
  const p = String(prediction ?? '').toUpperCase()
  if (!p) return 'neutral'
  if (p.includes('UP') || p.includes('BUY') || p.includes('LONG') || p.includes('BULL')) return 'bullish'
  if (p.includes('DOWN') || p.includes('SELL') || p.includes('SHORT') || p.includes('BEAR')) return 'bearish'
  return 'neutral'
}

export function fmtHorizon(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}h`
  const raw = String(value).trim()
  return raw || null
}

export function pickBackingLines(context) {
  const lines = []
  const rankingContext = context?.rankingContext ?? context?.ranking_context ?? null

  if (Array.isArray(rankingContext)) {
    for (const item of rankingContext) {
      if (typeof item !== 'string') continue
      const txt = item.trim()
      if (txt) lines.push(txt)
      if (lines.length >= 2) break
    }
  } else if (typeof rankingContext === 'string') {
    const txt = rankingContext.trim()
    if (txt) lines.push(txt)
  } else if (rankingContext && typeof rankingContext === 'object') {
    const candidate =
      rankingContext.summary ?? rankingContext.reason ?? rankingContext.thesis ?? rankingContext.notes ??
      (Array.isArray(rankingContext.reasons) ? rankingContext.reasons.join(', ') : null)
    if (typeof candidate === 'string' && candidate.trim()) lines.push(candidate.trim())
  }

  const featureSnapshot = context?.featureSnapshot ?? context?.feature_snapshot ?? null
  if (featureSnapshot && typeof featureSnapshot === 'object' && !Array.isArray(featureSnapshot)) {
    const preferredKeys = ['momentum', 'trend', 'volatility', 'rsi', 'macd', 'volume', 'fragility', 'quality']
    const entries = []
    for (const key of preferredKeys) {
      if (key in featureSnapshot) entries.push([key, featureSnapshot[key]])
    }
    if (entries.length === 0) {
      for (const [k, v] of Object.entries(featureSnapshot)) {
        if (entries.length >= 2) break
        entries.push([k, v])
      }
    }
    const rendered = entries
      .map(([k, v]) => {
        if (typeof v === 'string' && v.trim()) return `${k}: ${v.trim()}`
        if (typeof v === 'number' && Number.isFinite(v)) return `${k}: ${v.toFixed(2)}`
        if (typeof v === 'boolean') return v ? `${k}: yes` : null
        return null
      })
      .filter(Boolean)
      .slice(0, 2)
    if (rendered.length) lines.push(`Features — ${rendered.join(' · ')}`)
  }

  return lines.slice(0, 3)
}

export function buildPredictionHeadline({ direction, confidence, rankScore, horizon }) {
  const tier = confidence == null
    ? 'low'
    : confidence >= 0.85 ? 'high'
    : confidence >= 0.7  ? 'mid'
    : confidence >= 0.55 ? 'low'
    : 'early'

  const horizonSuffix = fmtHorizon(horizon) ? ` — ${fmtHorizon(horizon)}` : ''
  const rankSuffix = typeof rankScore === 'number' && Number.isFinite(rankScore) ? ' (rank-backed)' : ''

  if (direction === 'bullish') {
    if (tier === 'high')  return `High-conviction upside window${rankSuffix}${horizonSuffix}`
    if (tier === 'mid')   return `Bullish edge building${rankSuffix}${horizonSuffix}`
    if (tier === 'early') return `Early upside read${rankSuffix}${horizonSuffix}`
    return `Upside tilt${rankSuffix}${horizonSuffix}`
  }
  if (direction === 'bearish') {
    if (tier === 'high')  return `High-conviction downside risk${rankSuffix}${horizonSuffix}`
    if (tier === 'mid')   return `Bearish pressure rising${rankSuffix}${horizonSuffix}`
    if (tier === 'early') return `Early downside read${rankSuffix}${horizonSuffix}`
    return `Downside tilt${rankSuffix}${horizonSuffix}`
  }
  if (tier === 'high') return `High-confidence range expectation${rankSuffix}${horizonSuffix}`
  if (tier === 'mid')  return `Range-bound setup${rankSuffix}${horizonSuffix}`
  return `Neutral / watch${rankSuffix}${horizonSuffix}`
}

export function buildPredictionCard(ctx) {
  const ticker     = String(ctx?.ticker ?? ctx?.symbol ?? '').toUpperCase().trim()
  const confidence = coerceConfidence(ctx?.confidence)
  const direction  = directionFromPrediction(ctx?.prediction)
  const rankScoreRaw = ctx?.rankScore ?? ctx?.rank_score
  const rankScore    = typeof rankScoreRaw === 'number' ? rankScoreRaw : Number(rankScoreRaw)

  return {
    id:          String(ctx?.predictionId ?? ctx?.prediction_id ?? ctx?.id ?? '').trim() || ticker,
    predictionId: String(ctx?.predictionId ?? ctx?.prediction_id ?? ctx?.id ?? '').trim() || null,
    tenantId:    String(ctx?.tenant_id ?? ctx?.tenantId ?? '').trim() || null,
    ticker,
    timestamp:   ctx?.timestamp ?? ctx?.predictedAt ?? ctx?.predicted_at ?? null,
    prediction:  ctx?.prediction ?? null,
    confidence,
    horizon:     ctx?.horizon ?? null,
    mode:        ctx?.mode ?? null,
    strategyId:  ctx?.strategyId ?? ctx?.strategy_id ?? null,
    rankScore:   Number.isFinite(rankScore) ? rankScore : null,
    rankingContext:  ctx?.rankingContext ?? ctx?.ranking_context ?? null,
    featureSnapshot: ctx?.featureSnapshot ?? ctx?.feature_snapshot ?? null,
    headline: buildPredictionHeadline({
      direction,
      confidence,
      rankScore: Number.isFinite(rankScore) ? rankScore : null,
      horizon: ctx?.horizon ?? null,
    }),
    backingLines: pickBackingLines(ctx),
    direction,
  }
}

export function transformCalendarEventsToPredictions(events) {
  return events.map((event) => {
    const type =
      event.direction === 'BUY'   ? 'BUY'   :
      event.direction === 'SELL'  ? 'SELL'  :
      event.direction === 'WATCH' ? 'WATCH' : 'EVENT'
    return {
      date:       new Date(event.date),
      type,
      symbol:     event.symbol,
      confidence: event.confidence || 0.7,
      id:         event.id || `${event.symbol}_${event.date}_${event.type}`,
    }
  })
}

export function transformSignalsToLiveFormat(signals, priceMap) {
  return signals.map((signal) => {
    const currentPrice = priceMap?.[signal.symbol]?.price || 145.32
    const confidence   = signal.confidence || 0.7
    const riskAmount   = currentPrice * 0.02 * (2 - confidence)
    const rewardAmount = riskAmount * 2.5
    return {
      symbol:     signal.symbol,
      strategy:   signal.source === 'top_ranked' ? 'Alpha Ranking' : 'Momentum Signal',
      confidence: signal.confidence,
      entry:      `$${currentPrice.toFixed(2)}`,
      stop:       `$${(currentPrice - riskAmount).toFixed(2)}`,
      target:     `$${(currentPrice + rewardAmount).toFixed(2)}`,
      type:       signal.type,
    }
  })
}
