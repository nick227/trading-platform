/**
 * Historical backtest of one bot over past daily sessions. Pure over its inputs: no database,
 * no broker, no network. Hypothetical orders and fills live only in the returned result —
 * never in Execution.
 *
 * Same decisions as ongoing trading: rules (decisionCore.ruleDecision), direction and sizing
 * (decisionCore), the normal risk policy (riskCore: matrix, four scores, legacy checks,
 * resolveRiskOutcome with the same restrict mode), the bot-level and user-wide limits
 * (botEligibility, riskCapsDecision) and buying power — each fed what was known at that
 * session's close. FIFO accounting (calculateFifoAccounting) for P&L, win rate and holdings.
 *
 * Execution models:
 *   next_open   realistic: decide at session t's close, fill at the next session's open.
 *   same_close  simulator parity: fill at the close the bot observed (what paper_daily does);
 *               optimistic — the decision and the fill share one price.
 *
 * Differences from live that are inherent to history, recorded in result.assumptions:
 *   - operational risk (broker/quote/queue health) has no history: scored at its healthy 100;
 *   - the run is an isolated portfolio holding only this bot (no other bots' positions);
 *   - stress uses the run's own peak equity and FIFO realized P&L of its closed trades —
 *     the same inputs live trading builds from the portfolio (riskCore.stressInputs);
 *   - the clock at each decision is the session close (21:00 UTC).
 */
import { calculateFifoAccounting, realizedPnlSince } from '../../../server/src/services/botAccountingService.js'
import { maxDrawdown } from '../../../server/src/services/portfolioValuationService.js'
import { computeBuyQuantity, deriveDirection, ruleDecision, runRulePipeline, sellableFrom } from '../engine/decisionCore.js'
import {
  DEFAULT_RISK_SETTINGS, RISK_POLICY_VERSION, closedTradeWinRate, drawdownStress, executionConfidence,
  gateVerdict, legacyRiskChecks, portfolioExposure, scoreWinRate, stressInputs,
} from '../risk/riskCore.js'
import { resolveRiskOutcome } from '../risk/riskOutcome.js'
import { botEligibility } from '../risk/orderEligibility.js'
import { riskCapsDecision } from '../risk/riskCaps.js'
import { avgVolume20 } from './priceData.js'

export const EXECUTION_MODELS = Object.freeze({
  next_open: { realistic: true, label: 'Decides at each close; fills at the next session’s open' },
  same_close: { realistic: false, label: 'Simulator parity: fills at the same close it observed (optimistic)' },
})
export const OPERATIONAL_SCORE_HISTORICAL = 100
const PENDING_MAX_SESSIONS = 5

const round2 = (n) => Math.round(n * 100) / 100
const sessionClock = (d) => new Date(`${d}T21:00:00Z`)
const openClock = (d) => new Date(`${d}T14:30:00Z`)
const dayStart = (d) => new Date(`${d}T00:00:00Z`)

function regimeAt(points, date) {
  // points ascending by asOf; latest with asOf <= date
  let lo = 0, hi = (points?.length ?? 0) - 1, best = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].asOf <= date) { best = points[mid]; lo = mid + 1 } else hi = mid - 1
  }
  if (!best) return null
  return { regime: best.regime, asOf: new Date(`${best.asOf}T00:00:00Z`), createdAt: sessionClock(best.asOf), inputsJson: { confirmedBars: best.confirmedBars } }
}

/**
 * @param {object} p
 * @param {object} p.bot        { id, config, rules: [{ type, config }] } — enabled rules in order
 * @param {string[]} p.symbols
 * @param {string} p.start, p.end   YYYY-MM-DD (inclusive)
 * @param {'next_open'|'same_close'} p.executionModel
 * @param {number} p.startingCash
 * @param {object} p.riskSettings   the owner's risk settings (merged over defaults)
 * @param {string} p.restrictMode   'block' | 'reduce' (as live RISK_RESTRICT_MODE)
 * @param {object} p.data           normalized: { bars: { T: [[d,o,h,l,c,v]] }, calendar: [d], regimes: { SYM: [points] }, unusable: [T] }
 */
export async function runBacktest({ bot, symbols, start, end, executionModel = 'next_open', startingCash = 100_000, riskSettings = {}, restrictMode = 'block', data }) {
  if (!EXECUTION_MODELS[executionModel]) throw new Error(`unknown execution model: ${executionModel}`)
  const settings = { ...DEFAULT_RISK_SETTINGS, ...riskSettings }
  const sessions = data.calendar.filter((d) => d >= start && d <= end)
  const index = {} // T -> Map(date -> bar index)
  for (const t of symbols) index[t] = new Map((data.bars[t] ?? []).map((b, i) => [b[0], i]))
  const barOn = (t, d) => { const i = index[t].get(d); return i === undefined ? null : data.bars[t][i] }
  const lastClose = {} // T -> last known close as of the current session
  const rules = (bot.rules ?? []).filter((r) => r.enabled !== false)
  const dailyLossRules = rules.filter((r) => r.type === 'daily_loss')

  let cash = startingCash
  const fills = []      // FIFO input rows (hypothetical)
  const attempts = []   // order attempts that passed risk: { ticker, at, session, notional, status }
  let pending = []      // next_open orders awaiting a fill
  const events = []     // meaningful decisions (orders, refusals, risk blocks)
  const skips = {}      // routine skip reasons -> count
  const equity = []     // { date, equity, cash, marketValue }
  let seq = 0

  const holdings = () => calculateFifoAccounting(fills).openPositions
  const valueAt = () => {
    let mv = 0
    for (const [t, p] of Object.entries(holdings())) mv += p.quantity * (lastClose[t] ?? p.avgPrice)
    return { marketValue: mv, equity: cash + mv }
  }
  const skip = (reason) => { skips[reason] = (skips[reason] ?? 0) + 1 }
  const fill = (order, price, at, session) => {
    const cost = order.quantity * price
    if (order.direction === 'buy' && cost > cash + 1e-6) {
      events.push({ session, ticker: order.ticker, type: 'unfilled', reason: 'insufficient_cash_at_fill', quantity: order.quantity, price })
      order.status = 'unfilled'
      return
    }
    cash += order.direction === 'buy' ? -cost : cost
    const id = `bt_${++seq}`
    fills.push({ id, ticker: order.ticker, direction: order.direction, quantity: order.quantity, price: order.refPrice, filledQuantity: order.quantity,
      filledPrice: price, fees: 0, commission: 0, status: 'filled', createdAt: order.decidedAt, filledAt: at, session, decidedSession: order.decidedSession })
    order.status = 'filled'
  }

  for (const d of sessions) {
    const now = sessionClock(d)
    for (const t of symbols) { const b = barOn(t, d); if (b) lastClose[t] = b[4] }

    // 1. Realistic model: pending orders fill at this session's open.
    if (pending.length) {
      const still = []
      for (const o of pending) {
        const b = barOn(o.ticker, d)
        if (b) fill(o, b[1], openClock(d), d)
        else if (++o.waited >= PENDING_MAX_SESSIONS) { o.status = 'expired'; events.push({ session: d, ticker: o.ticker, type: 'unfilled', reason: 'no_bar_to_fill' }) }
        else still.push(o)
      }
      pending = still
    }

    // 2. Decisions at this session's close.
    for (const t of symbols) {
      const bar = barOn(t, d)
      if (!bar || data.unusable?.includes(t)) { skip('no_session_bar'); continue }
      if (pending.some((o) => o.ticker === t)) { skip('inflight_exists'); continue }
      const side = deriveDirection(bot)
      if (!side) { skip('missing_direction'); continue }
      if (rules.length === 0) { skip('no_rules_configured'); continue }

      const accountQty = holdings()[t]?.quantity ?? 0
      const lastAttemptAt = attempts.filter((a) => a.ticker === t).reduce((m, a) => Math.max(m, a.at), 0)
      const realizedToday = realizedPnlSince(fills, dayStart(d))
      const inputs = {
        ticker: t, side, price: bar[4], now, market: { isOpen: true, marketOpen: null, marketClose: null },
        positions: accountQty ? [{ symbol: t, qty: accountQty }] : [], lastAttemptAt,
        realizedLossToday: Math.abs(Math.min(0, realizedToday)), regime: null,
        volume: bar[5], avgVolume: avgVolume20(data.bars[t], index[t].get(d)),
        closes: data.bars[t].slice(Math.max(0, index[t].get(d) - 60), index[t].get(d) + 1).map((b) => b[4]),
      }
      // Rule pipeline (same order and short-circuit as live).
      const outcome = await runRulePipeline(rules, (rule) => {
        if (rule.type === 'trend_filter') inputs.regime = regimeAt(data.regimes?.[String(rule.config?.symbol ?? 'SPY').toUpperCase()], d)
        return ruleDecision(rule, inputs)
      })
      if (!outcome.pass) { skip(outcome.result.reason ?? `${outcome.rule.type}_blocked`); continue }

      const quantity = side === 'buy' ? computeBuyQuantity({ bot, price: bar[4] }) : sellableFrom(accountQty, accountQty)
      if (!(quantity > 0)) { skip(side === 'sell' ? 'no_position' : 'invalid_quantity'); continue }

      // Normal risk policy on point-in-time inputs.
      const { marketValue, equity: eq } = valueAt()
      const prior = equity.length ? equity[equity.length - 1].equity : startingCash
      const peak = Math.max(startingCash, eq, ...equity.map((p) => p.equity))
      const fifo = calculateFifoAccounting(fills)
      const marketData = { ticker: t, price: bar[4], session: d }
      if (bar[5] > 0) marketData.volume = bar[5]
      const avg = avgVolume20(data.bars[t], index[t].get(d))
      if (avg > 0) marketData.avgVolume = avg
      const exec = executionConfidence({
        signal: { ticker: t, direction: side, botId: bot.id }, marketData,
        winRateScore: scoreWinRate(closedTradeWinRate(fills, fifo.perExecutionPnl, now.getTime())), unknownAsNotApplicable: true,
      })
      const heldValues = Object.entries(fifo.openPositions).map(([ticker, p]) => ({ ticker, value: p.quantity * (lastClose[ticker] ?? p.avgPrice) }))
      // Stress: the run's own peak equity and FIFO realized P&L of its closed trades (as live).
      const stressIn = stressInputs({ fills, perExecutionPnl: fifo.perExecutionPnl, peakEquity: peak, equity: eq, now: now.getTime(), dayStart: dayStart(d).getTime() })
      const scores = {
        operational: OPERATIONAL_SCORE_HISTORICAL,
        exposure: portfolioExposure({ holdings: heldValues, marketValue, equity: eq }).score,
        stress: drawdownStress(stressIn).score,
        execution: exec.score,
      }
      const checks = legacyRiskChecks({
        positionValue: quantity * bar[4],
        portfolioState: { cashBalance: cash, totalValue: eq, totalExposure: marketValue, dailyLoss: Math.max(0, prior - eq), drawdown: peak > 0 ? Math.max(0, (peak - eq) / peak) : 0 },
        settings, activeReservations: 0,
      })
      const verdict = gateVerdict({ scores, quantity, checks })
      const risk = resolveRiskOutcome(verdict, { quantity, restrictMode, testScenario: null })
      if (!risk.proceed) {
        events.push({ session: d, ticker: t, type: 'risk_blocked', side, quantity, basis: risk.basis, reason: verdict.reason,
          failedChecks: verdict.failedChecks.map((c) => c.type), scores })
        continue
      }
      const qty = risk.quantity
      const notional = qty * bar[4]

      // Final boundary: bot-level limits, user-wide caps, buying power.
      const active = pending.map((o) => ({ direction: o.direction, ticker: o.ticker, quantity: o.quantity, price: o.refPrice, filledQuantity: 0 }))
      let refusal = botEligibility({ direction: side, ticker: t, quantity: qty, notional, config: bot.config ?? {}, fills, others: active, dailyLossRules, now })
      if (refusal.allowed) {
        const today = attempts.filter((a) => a.session === d)
        refusal = riskCapsDecision({ pendingNotional: notional, ticker: t, dailyRows: today.map((a) => ({ quantity: a.quantity, price: a.price })), activeCount: pending.length,
          dailyFilledExecutions: fills.filter((f) => f.session === d) })
      }
      if (refusal.allowed && side === 'buy' && notional > Math.max(0, cash) + 1e-6) refusal = { allowed: false, reason: 'insufficient_buying_power' }
      attempts.push({ ticker: t, at: now.getTime(), session: d, quantity: qty, price: bar[4] })
      if (!refusal.allowed) {
        events.push({ session: d, ticker: t, type: 'refused', side, quantity: qty, reason: refusal.reason })
        continue
      }

      const order = { ticker: t, direction: side, quantity: qty, refPrice: bar[4], decidedAt: now, decidedSession: d, waited: 0, scores }
      events.push({ session: d, ticker: t, type: 'order', side, quantity: qty, price: bar[4], basis: risk.basis, scores })
      if (executionModel === 'same_close') fill(order, bar[4], now, d)
      else pending.push(order)
    }

    const v = valueAt()
    equity.push({ date: d, equity: round2(v.equity), cash: round2(cash), marketValue: round2(v.marketValue) })
  }
  for (const o of pending) events.push({ session: sessions[sessions.length - 1], ticker: o.ticker, type: 'unfilled', reason: 'range_ended_before_fill' })

  return summarize({ bot, symbols, start, end, executionModel, startingCash, sessions, data, fills, events, skips, equity })
}

function buyAndHold({ symbols, sessions, data, capital, executionModel }) {
  // Equal capital per symbol, whole shares, bought at the first fill price the same execution
  // model would get (next open, or the first close), held to the end.
  const per = capital / symbols.length
  const pos = {}
  let cash = capital
  const points = []
  const lastClose = {}
  const byDate = Object.fromEntries(symbols.map((t) => [t, new Map((data.bars[t] ?? []).map((b) => [b[0], b]))]))
  for (let i = 0; i < sessions.length; i++) {
    const d = sessions[i]
    for (const t of symbols) {
      const b = byDate[t].get(d)
      if (!b) continue
      lastClose[t] = b[4]
      if (pos[t] === undefined && !data.unusable?.includes(t)) {
        const price = executionModel === 'same_close' ? b[4] : (i > 0 ? b[1] : null)
        if (price) { const q = Math.floor(per / price); pos[t] = q; cash -= q * price }
      }
    }
    let v = cash
    for (const [t, q] of Object.entries(pos)) v += q * (lastClose[t] ?? 0)
    points.push({ date: d, equity: round2(v) })
  }
  const last = points[points.length - 1]?.equity ?? capital
  return { capital, returnPct: round2(((last - capital) / capital) * 100), points, maxDrawdown: maxDrawdown(points), shares: pos }
}

function summarize({ bot, symbols, start, end, executionModel, startingCash, sessions, data, fills, events, skips, equity }) {
  const fifo = calculateFifoAccounting(fills, { currentPrices: Object.fromEntries(symbols.map((t) => {
    const bars = data.bars[t] ?? []
    const lastIn = [...bars].reverse().find((b) => b[0] <= end)
    return [t, lastIn ? lastIn[4] : null]
  }).filter(([, p]) => p !== null)) })
  const allocation = Number(bot.config?.allocatedAmount) > 0 ? Number(bot.config.allocatedAmount) : null
  const capital = allocation ?? startingCash
  // Bot equity = capital + P&L (cash flows + holdings at each close), as on the bot page.
  const curve = equity.map((p) => ({ date: p.date, pnl: round2(p.equity - startingCash), equity: round2(capital + p.equity - startingCash) }))
  const finalPnl = curve.length ? curve[curve.length - 1].pnl : 0
  const trades = fills.map((f) => ({
    session: f.session, decidedSession: f.decidedSession, ticker: f.ticker, side: f.direction, quantity: f.filledQuantity,
    price: f.filledPrice, decisionPrice: f.price, realizedPnl: f.direction === 'sell' ? (fifo.perExecutionPnl.get(f.id) ?? 0) : null,
  }))
  const exposureDays = equity.filter((p) => p.marketValue > 0).length
  return {
    hypothetical: true,
    executionModel, executionModelLabel: EXECUTION_MODELS[executionModel].label,
    riskPolicyVersion: RISK_POLICY_VERSION,
    range: { start, end, sessions: sessions.length, firstSession: sessions[0] ?? null, lastSession: sessions[sessions.length - 1] ?? null },
    symbols,
    capital,
    metrics: {
      pnl: finalPnl,
      returnPct: round2((finalPnl / capital) * 100),
      maxDrawdown: maxDrawdown(curve),
      trades: fills.length,
      closedTrades: fifo.performance?.closedTrades ?? 0,
      winRate: fifo.performance?.winRate ?? null,
      realizedPnl: fifo.performance?.realizedPnl ?? 0,
      unrealizedPnl: fifo.performance?.unrealizedPnl ?? null,
      timeInMarketPct: sessions.length ? round2((exposureDays / sessions.length) * 100) : 0,
    },
    buyAndHold: buyAndHold({ symbols, sessions, data, capital, executionModel }),
    curve,
    trades,
    events: events.slice(-500),
    eventCount: events.length,
    skips,
    openPositions: Object.fromEntries(Object.entries(fifo.openPositions).map(([t, p]) => [t, { quantity: p.quantity, avgPrice: p.avgPrice }])),
    assumptions: [
      'Hypothetical: historical daily bars, not paper or broker fills.',
      EXECUTION_MODELS[executionModel].label + '.',
      'Isolated portfolio holding only this bot.',
      'Operational health has no history: scored as healthy (100).',
      'Decisions are made at each session’s close (21:00 UTC) with only data known then.',
      'No commissions or slippage beyond the execution model.',
    ],
  }
}
