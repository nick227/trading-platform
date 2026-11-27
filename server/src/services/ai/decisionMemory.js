/**
 * Read-only, point-in-time AI decision memory.
 * Historical BotEvents remain immutable. Market movements are computed using
 * dated quotes and must never be confused with realized trading P&L.
 */
import { createHash } from 'node:crypto'

const SESSION = /^\d{4}-\d{2}-\d{2}$/
const round = n => Math.round((n + Number.EPSILON) * 100) / 100
const DEFAULT_CYCLES = 5
const DEFAULT_MAX_BYTES = 16_384

export class DecisionMemoryError extends Error {
  constructor(message) { super(message); this.name = 'DecisionMemoryError' }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  }
  return value
}

function compactDecision(row) {
  const symbol = typeof row?.symbol === 'string' ? row.symbol.toUpperCase() : ''
  const action = typeof row?.action === 'string' ? row.action.toUpperCase() : ''
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) || !['BUY','SELL','HOLD'].includes(action)) return null
  return {
    symbol, action,
    thesis: String(row.thesis || '').slice(0, 320),
    evidence: Array.isArray(row.evidence) ? row.evidence.map(x => String(x).slice(0, 160)).slice(0, 4) : [],
    risks: Array.isArray(row.risks) ? row.risks.map(x => String(x).slice(0, 160)).slice(0, 4) : []
  }
}

export async function loadAiDecisionMemory({
  bot, asOfSession, prismaClient, engine = null,
  maxCycles = DEFAULT_CYCLES, maxBytes = DEFAULT_MAX_BYTES
}) {
  if (!bot?.id || !prismaClient?.botEvent?.findMany ||
      !SESSION.test(asOfSession || '') || Number.isNaN(Date.parse(asOfSession + 'T00:00:00Z')) ||
      !Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 20 ||
      !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 64_000) {
    throw new DecisionMemoryError('Invalid decision-memory request or data access')
  }
  const events = await prismaClient.botEvent.findMany({
    where: { botId: bot.id, type: 'decision_made' },
    orderBy: { createdAt: 'desc' },
    take: 100
  })
  if (!Array.isArray(events)) throw new DecisionMemoryError('Decision history unavailable')

  const eligible = events.filter(event => {
    const date = event.metadata?.decision?.asOfSession
    return event.botId === bot.id && event.metadata?.status === 'completed' &&
      SESSION.test(date || '') && date < asOfSession &&
      Array.isArray(event.metadata?.decision?.decisions)
  }).sort((a, b) => b.metadata.decision.asOfSession.localeCompare(a.metadata.decision.asOfSession) ||
    String(b.id).localeCompare(String(a.id))).slice(0, maxCycles)

  const priceCache = new Map()
  async function quote(symbol, session) {
    const key = symbol + '|' + session
    if (priceCache.has(key)) return priceCache.get(key)
    let result = null
    if (engine?.getSessionClose) {
      try {
        const response = await engine.getSessionClose(symbol, session)
        const px = Number(response?.close)
        if (response?.session === session && Number.isFinite(px) && px > 0) result = px
      } catch {
        // Missing point-in-time prices never become fabricated observations.
      }
    }
    priceCache.set(key, result)
    return result
  }

  const history = []
  for (const event of eligible) {
    const original = event.metadata.decision
    const selected = original.decisions.map(compactDecision).filter(Boolean)
      .filter(d => d.action !== 'HOLD').slice(0, 4)
    const decisions = []
    for (const entry of selected) {
      const oldPrice = await quote(entry.symbol, original.asOfSession)
      const currentPrice = await quote(entry.symbol, asOfSession)
      const priceChangePct = oldPrice != null && currentPrice != null
        ? round((currentPrice / oldPrice - 1) * 100) : null
      let thesisAlignment = 'unobserved'
      if (priceChangePct !== null) {
        if (entry.action === 'BUY') {
          thesisAlignment = priceChangePct > 0 ? 'favorable_price_movement' : (priceChangePct < 0 ? 'adverse_price_movement' : 'neutral')
        } else if (entry.action === 'SELL') {
          thesisAlignment = priceChangePct < 0 ? 'favorable_price_movement' : (priceChangePct > 0 ? 'adverse_price_movement' : 'neutral')
        }
      }
      decisions.push({
        ...entry,
        observedPriceChangePct: priceChangePct,
        thesisAlignment,
        observationType: 'subsequent_market_price_change_not_trading_pnl',
        observationStatus: oldPrice != null && currentPrice != null ? 'observed' : 'unavailable'
      })
    }
    history.push({
      researchEventId: event.id,
      decisionSession: original.asOfSession,
      marketSummary: String(original.marketSummary || '').slice(0, 500),
      decisions
    })
  }

  const fills = prismaClient.execution?.findMany
    ? await prismaClient.execution.findMany({
      where: {
        botId: bot.id, status: 'filled',
        simSession: { lte: asOfSession },
        filledQuantity: { gt: 0 }, filledPrice: { gt: 0 }
      },
      orderBy: { filledAt: 'desc' },
      take: 20
    })
    : []
  if (!Array.isArray(fills)) throw new DecisionMemoryError('Simulated fills unavailable')
  const observedPaperFills = fills
    .filter(f => f.botId === bot.id && SESSION.test(f.simSession || '') &&
      f.simSession <= asOfSession && ['buy','sell'].includes(f.direction) &&
      Number.isFinite(Number(f.filledPrice)) && Number.isFinite(Number(f.filledQuantity)))
    .map(f => ({
      id: f.id,
      session: f.simSession,
      symbol: f.ticker,
      action: f.direction.toUpperCase(),
      quantity: Number(f.filledQuantity),
      fillPrice: Number(f.filledPrice)
    }))
  const snapshot = {
    memoryVersion: '1.0.0',
    asOfSession,
    history,
    observedPaperFills,
    disclaimer: 'Historical decisions and observed prices are not evidence of predictive skill. Market price changes are not realized portfolio profit.'
  }
  const canonicalJson = JSON.stringify(canonical(snapshot))
  if (Buffer.byteLength(canonicalJson, 'utf8') > maxBytes) {
    throw new DecisionMemoryError('Decision-memory context exceeds byte budget')
  }
  return {
    ...snapshot,
    fingerprint: createHash('sha256').update(canonicalJson).digest('hex')
  }
}
