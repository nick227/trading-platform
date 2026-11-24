/**
 * AI Catalyst & Momentum Trader Strategy
 * 
 * Combines technical momentum (price strength, moving average support, volume confirmation)
 * with fundamental catalyst analysis across 10 liquid US equities.
 */

export const STRATEGY_ID = 'tmpl_ai_catalyst_momentum'
export const STRATEGY_NAME = 'AI Catalyst & Momentum'
export const STRATEGY_FAMILY = 'ai'

export function buildSystemPrompt() {
  return `You are the AI Catalyst & Momentum Trader on TradeLoom, an autonomous quantitative and fundamental research strategist.

MANDATE & PHILOSOPHY:
- Identify high-conviction opportunities in liquid US equities where technical momentum (relative price strength, trend above 20-day and 50-day moving averages, volume confirmation) aligns with strong fundamental catalysts (earnings acceleration, AI infrastructure spend, enterprise cloud demand, operational resilience).
- Capital preservation is paramount. Overtrading destroys edge. If no symbol presents an asymmetric risk/reward setup, your mandate is to HOLD. HOLD is a high-value, disciplined decision.
- Position sizing: Maximum 20% of portfolio ($2,000 on a $10,000 portfolio) per new position.
- You operate after market close. Any approved trades will execute at the next session's eligible price (next_open). You cannot look ahead or execute retroactively.
- You can only SELL positions that the portfolio currently owns.
- For every symbol in the universe, provide an explicit assessment: "BUY", "SELL", or "HOLD".
- Return ONLY valid JSON matching the required schema.`
}

export function buildUserPrompt(context) {
  const { asOfSession, symbols, portfolio } = context

  const symbolSummaries = symbols.map(s => {
    if (!s.available) return `- ${s.symbol}: Data unavailable`
    const smaText = s.sma20 ? `SMA20: $${s.sma20} (${s.priceVsSma20Pct > 0 ? '+' : ''}${s.priceVsSma20Pct}%), SMA50: $${s.sma50 ?? 'N/A'}` : 'SMA: N/A'
    return `- ${s.symbol}: Price $${s.currentPrice} | 5d: ${s.return5dPct > 0 ? '+' : ''}${s.return5dPct}% | 20d: ${s.return20dPct > 0 ? '+' : ''}${s.return20dPct}% | Volume Ratio: ${s.volumeRatio}x | ${smaText} | Regime: ${s.regime}\n  Catalyst context: ${s.catalyst}`
  }).join('\n')

  const positionsSummary = portfolio.positions.length > 0
    ? portfolio.positions.map(p => `  - ${p.symbol}: ${p.quantity} shares @ avg $${p.averageCost} (Value: $${p.marketValue}, Unrealized: ${p.unrealizedPnl >= 0 ? '+' : ''}$${p.unrealizedPnl} / ${p.unrealizedPnlPct}%)`).join('\n')
    : '  None (100% Cash)'

  return `SESSION RESEARCH AS-OF: ${asOfSession}

PORTFOLIO STATE:
- Total Capital Allocated: $${portfolio.allocatedCapital}
- Available Cash: $${portfolio.cash}
- Open Positions:
${positionsSummary}

MARKET & CATALYST CONTEXT ACROSS THE 10 SYMBOLS:
${symbolSummaries}

TASK:
1. Conduct an end-of-session evaluation for all 10 symbols.
2. For each symbol, decide: "BUY", "SELL", or "HOLD".
3. For "BUY":
   - Require strong catalyst alignment, positive momentum (e.g. above SMA20 or accelerating volume), and available cash.
   - Confidence must be between 0.0 and 1.0 (>= 0.65 required for action).
   - Target allocation pct between 0.10 and 0.20 (max 20%).
   - Define exit rules: takeProfitPct (typically 6-12%) and stopLossPct (typically 3-6%).
4. For "SELL":
   - Only propose SELL if the portfolio currently holds shares of that symbol and momentum or catalyst thesis has broken down.
5. Select 0 to 2 top actionable orders in "selectedDecisions". If market conditions are uncertain, "selectedDecisions" should be empty.

Output strictly valid JSON conforming to this schema:
{
  "asOfSession": "${asOfSession}",
  "marketSummary": "Concise 1-2 sentence overview of market conditions and regime",
  "symbolEvaluations": [
    {
      "symbol": "SPY",
      "action": "HOLD",
      "confidence": 0.70,
      "targetAllocationPct": 0,
      "entryType": "next_open",
      "exitRule": { "takeProfitPct": 6, "stopLossPct": 4 },
      "thesis": "Concise reasoning for decision",
      "evidence": ["Data point 1", "Data point 2"]
    }
  ],
  "selectedDecisions": [
    {
      "symbol": "NVDA",
      "action": "BUY",
      "confidence": 0.82,
      "targetAllocationPct": 0.15,
      "entryType": "next_open",
      "exitRule": { "takeProfitPct": 8, "stopLossPct": 4 },
      "thesis": "Strong technical breakout above 20-day SMA confirmed by datacenter AI catalyst.",
      "evidence": ["Trading 3.4% above 20d SMA", "Volume 1.25x 20d average", "Sustained hyperscaler demand"]
    }
  ]
}`
}

export function validateAiDecisionOutput(output, context) {
  if (!output || typeof output !== 'object') {
    throw new Error('AI output must be a JSON object')
  }

  const { symbolEvaluations, selectedDecisions } = output
  if (!Array.isArray(symbolEvaluations) || symbolEvaluations.length === 0) {
    throw new Error('AI output missing symbolEvaluations array')
  }

  const heldSymbols = new Set((context.portfolio?.positions ?? []).map(p => p.symbol))
  const validSymbols = new Set(context.symbols.map(s => s.symbol))

  // Sanitize and validate evaluations
  const sanitizedEvaluations = symbolEvaluations.map(ev => {
    const sym = String(ev.symbol ?? '').toUpperCase()
    if (!validSymbols.has(sym)) {
      throw new Error(`AI evaluated symbol ${sym} which is outside the supported 10-symbol universe`)
    }
    const action = String(ev.action ?? 'HOLD').toUpperCase()
    if (!['BUY', 'SELL', 'HOLD'].includes(action)) {
      throw new Error(`Invalid action ${action} for symbol ${sym}`)
    }

    const confidence = Number(ev.confidence) >= 0 && Number(ev.confidence) <= 1 ? Number(ev.confidence) : 0.5
    const targetAllocationPct = Math.max(0, Math.min(0.25, Number(ev.targetAllocationPct) || 0))
    const exitRule = {
      takeProfitPct: Math.max(1, Math.min(50, Number(ev.exitRule?.takeProfitPct) || 8)),
      stopLossPct: Math.max(1, Math.min(25, Number(ev.exitRule?.stopLossPct) || 4))
    }

    return {
      symbol: sym,
      action,
      confidence,
      targetAllocationPct,
      entryType: ev.entryType || 'next_open',
      exitRule,
      thesis: String(ev.thesis || '').trim(),
      evidence: Array.isArray(ev.evidence) ? ev.evidence.map(String) : []
    }
  })

  // Validate selected decisions against rules
  const sanitizedDecisions = (Array.isArray(selectedDecisions) ? selectedDecisions : [])
    .filter(d => d && (d.action === 'BUY' || d.action === 'SELL'))
    .map(d => {
      const sym = String(d.symbol ?? '').toUpperCase()
      const action = String(d.action).toUpperCase()
      
      // Gate: Must be in universe
      if (!validSymbols.has(sym)) return null

      // Gate: Cannot SELL if not held
      if (action === 'SELL' && !heldSymbols.has(sym)) return null

      // Gate: BUY requires confidence >= 0.60
      const confidence = Number(d.confidence) || 0.5
      if (action === 'BUY' && confidence < 0.60) return null

      const targetAllocationPct = Math.max(0.05, Math.min(0.20, Number(d.targetAllocationPct) || 0.15))
      const exitRule = {
        takeProfitPct: Math.max(1, Math.min(50, Number(d.exitRule?.takeProfitPct) || 8)),
        stopLossPct: Math.max(1, Math.min(25, Number(d.exitRule?.stopLossPct) || 4))
      }

      return {
        symbol: sym,
        action,
        confidence,
        targetAllocationPct,
        entryType: 'next_open',
        exitRule,
        thesis: String(d.thesis || '').trim(),
        evidence: Array.isArray(d.evidence) ? d.evidence.map(String) : []
      }
    })
    .filter(Boolean)

  return {
    asOfSession: output.asOfSession || context.asOfSession,
    marketSummary: String(output.marketSummary || '').trim(),
    symbolEvaluations: sanitizedEvaluations,
    selectedDecisions: sanitizedDecisions
  }
}
