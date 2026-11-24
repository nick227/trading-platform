/**
 * Market-aware conditions over completed daily sessions. Pure: the live engine passes Alpha
 * Engine's session data; the backtest passes the bars known at that session's close.
 */

/** Session volume vs its prior 20-session average: pass when volume >= minRatio × average. */
export function relativeVolumeDecision(config, { volume, avgVolume }) {
  const min = Number(config.minRatio)
  if (!(volume > 0) || !(avgVolume > 0)) return { pass: false, reason: 'relative_volume_unavailable' }
  const ratio = Math.round((volume / avgVolume) * 100) / 100
  return ratio >= min
    ? { pass: true, detail: `volume ${ratio}× average` }
    : { pass: false, reason: 'relative_volume_below', detail: `volume ${ratio}× average (needs ${min}×)` }
}

/**
 * Close vs the close `sessions` sessions earlier. `closes`: completed daily closes, ascending,
 * the last one being the session decided on. above: rose at least pct%; below: fell at least pct%.
 */
export function priceChangeDecision(config, { closes }) {
  const n = Number(config.sessions)
  const pct = Number(config.pct)
  if (!Array.isArray(closes) || closes.length < n + 1) return { pass: false, reason: 'price_change_unavailable' }
  const now = closes[closes.length - 1]
  const then = closes[closes.length - 1 - n]
  if (!(now > 0) || !(then > 0)) return { pass: false, reason: 'price_change_unavailable' }
  const change = Math.round(((now / then) - 1) * 10_000) / 100
  const pass = config.operator === 'below' ? change <= -pct : change >= pct
  return pass
    ? { pass: true, detail: `${change}% over ${n} sessions` }
    : { pass: false, reason: config.operator === 'below' ? 'price_change_fall_not_met' : 'price_change_rise_not_met', detail: `${change}% over ${n} sessions` }
}

/** Exit: the price has fallen at least pct% below the bot's own FIFO average cost. */
export function stopLossDecision(config, { price, avgCost }) {
  const pct = Number(config.pct)
  if (!(avgCost > 0) || !(price > 0)) return { pass: false, reason: 'stop_loss_no_position' }
  const drop = Math.round(((1 - price / avgCost) * 100) * 100) / 100
  return drop >= pct
    ? { pass: true, detail: `${drop}% below average cost ${avgCost}` }
    : { pass: false, reason: 'stop_loss_not_hit', detail: `${drop}% below average cost (exits at ${pct}%)` }
}
