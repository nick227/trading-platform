// Canonical signal utilities — import from here, never inline the color/bg maps.

export const SIGNAL_COLORS = {
  STRONG_BUY:  '#0a7a47',
  BUY:         '#2d7a2d',
  HOLD:        '#666',
  SELL:        '#c0392b',
  STRONG_SELL: '#c0392b',
}

export const SIGNAL_BG = {
  STRONG_BUY:  'linear-gradient(135deg, #e8f5e8, #f0f9f4)',
  BUY:         '#f0f9f4',
  HOLD:        '#f8f9fa',
  SELL:        '#fff5f5',
  STRONG_SELL: '#fff5f5',
}

export function getSignalColor(signal) {
  return SIGNAL_COLORS[signal] ?? SIGNAL_COLORS.HOLD
}

export function getSignalBg(signal) {
  return SIGNAL_BG[signal] ?? SIGNAL_BG.HOLD
}

// Maps a 0-100 confidence value to a signal string.
export function confidenceToSignal(confidence) {
  if (confidence >= 80) return 'STRONG_BUY'
  if (confidence >= 60) return 'BUY'
  if (confidence >= 40) return 'HOLD'
  return 'SELL'
}

/**
 * Normalizes any known engine response shape to the canonical alpha panel object:
 * { signal, confidence, target, timeframe, reasoning }
 * Returns null when the data can't be mapped.
 */
export function normalizeAlpha(data) {
  if (!data || typeof data !== 'object') return null
  const raw = data.data ?? data
  const rawConf   = raw.confidence ?? raw.confidence_score ?? null
  const confidence = rawConf != null ? Math.round(rawConf * 100) : null
  const direction  = raw.direction ?? raw.signal_type ?? null
  const reasons    = Array.isArray(raw.reasons) ? raw.reasons : []
  const reasoning  = reasons.slice(0, 3).join('. ') || raw.reasoning || raw.explanation || null

  if (confidence == null && !reasoning) return null

  const signal =
    direction === 'buy'  ? (confidence >= 80 ? 'STRONG_BUY' : 'BUY') :
    direction === 'sell' ? (confidence <= 40 ? 'STRONG_SELL' : 'SELL') :
    raw.signal ?? confidenceToSignal(confidence ?? 0)

  return {
    signal,
    confidence:  confidence ?? 0,
    target:      raw.target ?? raw.price_target ?? null,
    timeframe:   raw.timeframe ?? '30d',
    reasoning:   reasoning ?? 'No reasoning available',
  }
}
