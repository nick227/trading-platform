/**
 * Public Strategy Evidence: TradeLoom's own standardized backtests of every platform strategy.
 *
 * Each platform strategy (BotTemplate) is tested as a *version*: its rules and config plus the
 * standardized test parameters below, content-addressed (sv_<hash>). Results are immutable
 * snapshots per version × symbol × window × end session, published whether good, bad or
 * untradeable. A user's customised copy is a different configuration and never inherits them.
 *
 * Standard test (identical for every strategy, so results are comparable):
 *   - every supported paper-trading symbol, one at a time, $10,000 of capital each;
 *   - realistic fills: decide at a session's close, fill at the next session's open; no fees;
 *   - the normal risk policy of paper trading (current RISK_POLICY_VERSION), default settings;
 *   - windows: the last 5 years, the last year, and 'forward' — only sessions completed after
 *     the version was first published (results the version could not have been tuned on).
 * A template trigger left unset (price 0) is standardized to the symbol's close on the last
 * session before the window starts — a level known at the time, stated with the results.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { DEFAULT_TRADABLE_SYMBOLS, simulationConfig } from './simulationService.js'
import { downsample, loadDataset, regimeSymbolsOf } from './backtestService.js'
import { isResearchDriven } from '../../../worker/src/engine/researchDecision.js'
import { RISK_POLICY_VERSION } from '../../../worker/src/risk/riskCore.js'
import { EXECUTION_MODELS, runBacktest } from '../../../worker/src/backtest/historicalRunner.js'
import { canonical } from '../../../worker/src/backtest/priceData.js'

export const STANDARD = Object.freeze({
  capital: 10_000,
  startingCash: 100_000,
  executionModel: 'next_open',
  fees: 0,
  windows: Object.freeze([{ id: '5Y', years: 5 }, { id: '1Y', years: 1 }]),
})

export const ASSUMPTIONS = Object.freeze([
  'Historical simulation on Alpha Engine daily bars — not a prediction of future results.',
  `Each symbol tested separately with ${STANDARD.capital.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} of capital.`,
  'Decides at each session’s close and fills at the next session’s open. No commissions.',
  'Same rules and normal risk policy as TradeLoom paper trading.',
  'Parameters are the strategy’s published defaults; TradeLoom does not tune them on this data.',
  'Stop-loss rules evaluate on daily closing prices and fill at the next session’s open; they cannot guarantee the exact stop price against overnight gaps.',
  '“Forward” covers only sessions completed after this version was first published.',
])

/** Evaluation design (development/holdout split, objective, benchmark) for redesigned strategies. */
const DESIGN = (() => {
  try {
    const all = JSON.parse(readFileSync(new URL('../../prisma/seeds/strategy-design.json', import.meta.url), 'utf8'))
    delete all._comment
    return all
  } catch { return {} }
})()
export const designFor = (templateId) => DESIGN[templateId] ?? null

const isoDate = (d) => d.toISOString().slice(0, 10)
const sha = (v) => createHash('sha256').update(canonical(v)).digest('hex')

/** The tested definition of a template: what a version id is computed from. */
export function canonicalStrategy(template) {
  const cfg = { ...(template.config ?? {}) }
  delete cfg.tickers
  const config = {
    ...cfg,
    capitalMode: 'allocated',
    allocatedAmount: STANDARD.capital,
    maxOrderNotional: Math.min(Number(cfg.maxOrderNotional) > 0 ? Number(cfg.maxOrderNotional) : STANDARD.capital, STANDARD.capital),
  }
  const rules = (Array.isArray(template.rules) ? template.rules : []).filter((r) => r?.enabled !== false).map((r) => ({ type: r.type, config: r.config ?? {} }))
  const unsetTrigger = rules.some((r) => r.type === 'price_threshold' && !(Number(r.config.price) > 0))
  const parameters = unsetTrigger ? { triggerPrice: 'close_before_window' } : {}
  let backtestable = true
  let reason = null
  if (config.signalSource === 'ai_catalyst_momentum' || template.id === 'tmpl_ai_catalyst_momentum' || template.botType === 'strategy_based') {
    backtestable = false
    reason = 'Autonomous AI strategies are evaluated on verified forward paper trading from publication date, avoiding historical prompt look-ahead.'
  } else if (isResearchDriven({ config })) {
    backtestable = false
    reason = 'Research strategies can’t be backtested yet: Alpha Engine has no point-in-time research history to replay.'
  } else if (config.direction !== 'buy' && config.direction !== 'sell') {
    backtestable = false
    reason = 'The strategy has no buy or sell direction.'
  }
  const standard = { capital: STANDARD.capital, startingCash: STANDARD.startingCash, executionModel: STANDARD.executionModel, fees: STANDARD.fees }
  // Design (dev/holdout split, objective) is part of a redesigned version's identity; versions
  // without one keep the definition — and the id — they were first published with.
  const design = designFor(template.id)
  const definition = { templateId: template.id, config, rules, parameters, standard, ...(design ? { design } : {}) }
  return { id: `sv_${sha(definition).slice(0, 16)}`, definition, backtestable, reason }
}

/** Rules with standardized parameters resolved for one symbol and window (no look-ahead). */
export function resolveRules(definition, bars, windowStart) {
  const before = [...bars].reverse().find((b) => b[0] < windowStart) ?? null
  const resolved = {}
  const rules = definition.rules.map((r) => {
    if (r.type === 'price_threshold' && definition.parameters.triggerPrice === 'close_before_window') {
      if (!before) return null
      resolved.triggerPrice = before[4]
      resolved.triggerFrom = before[0]
      return { ...r, config: { ...r.config, price: before[4] } }
    }
    return r
  })
  return rules.includes(null) ? { rules: null, parameters: resolved } : { rules, parameters: resolved }
}

function nextDay(d) {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return isoDate(x)
}

function windowStart(end, years) {
  const d = new Date(`${end}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return isoDate(d)
}

/** The latest completed session Alpha Engine has (from the calendar ticker). */
async function latestSession(engine, now) {
  const end = isoDate(new Date(now))
  const start = isoDate(new Date(now - 14 * 86_400_000))
  const r = await engine.getDailyBars('SPY', start, end)
  const bars = Array.isArray(r?.bars) ? r.bars : []
  return bars.length ? bars[bars.length - 1][0] : null
}

/**
 * Generates any missing evidence for the latest completed session. Idempotent: existing
 * (version, symbol, window, endDate) snapshots are kept as published. Returns a summary.
 */
export async function generateStrategyEvidence({ prismaClient = prisma, engine = engineClient, config: sim = simulationConfig(), now = Date.now(), yieldEvery = async () => {}, force = false } = {}) {
  const end = await latestSession(engine, now)
  if (!end) return { end: null, created: 0, reason: 'no_market_data' }
  const symbols = sim.tradableSymbols ?? DEFAULT_TRADABLE_SYMBOLS
  const templates = await prismaClient.botTemplate.findMany({ orderBy: { id: 'asc' } })
  let created = 0
  for (const template of templates) {
    const v = canonicalStrategy(template)
    let version = await prismaClient.strategyVersion.findUnique({ where: { id: v.id } })
    if (!version) {
      version = await prismaClient.strategyVersion.create({ data: { id: v.id, templateId: template.id, definition: v.definition, backtestable: v.backtestable, reason: v.reason, firstSession: end } })
    }
    const existing = new Set((await prismaClient.strategyEvidence.findMany({ where: { strategyVersionId: v.id, endDate: end }, select: { symbol: true, window: true } })).map((e) => `${e.symbol}|${e.window}`))
    const windows = [...STANDARD.windows.map((w) => ({ id: w.id, start: windowStart(end, w.years) })), { id: 'forward', start: null }]
    const devEnd = v.definition.design?.developmentEnd
    if (devEnd) {
      // Development: the 4 years the design could see. Holdout: everything after — out of sample.
      windows.push({ id: 'development', start: windowStart(devEnd, 4), end: devEnd })
      windows.push({ id: 'holdout', start: nextDay(devEnd) })
    }
    const todo = symbols.flatMap((s) => windows.filter((w) => force ? true : !existing.has(`${s}|${w.id}`)).map((w) => ({ symbol: s, window: w })))
    if (!todo.length) continue
    const base = { strategyVersionId: v.id, templateId: template.id, endDate: end, executionModel: STANDARD.executionModel, riskPolicyVersion: RISK_POLICY_VERSION }
    const batch = []
    const queueSave = (symbol, window, data) => {
      batch.push({ symbol, window, data })
    }
    const commitBatch = async () => {
      if (!batch.length) return
      if (typeof prismaClient?.$transaction === 'function') {
        const ops = batch.map(({ symbol, window, data }) => {
          const id = `se_${sha([v.id, symbol, window.id, end]).slice(0, 24)}`
          return prismaClient.strategyEvidence.upsert({
            where: { id },
            create: { id, ...base, symbol, window: window.id, ...data },
            update: { ...data }
          })
        })
        await prismaClient.$transaction(ops)
      } else {
        for (const { symbol, window, data } of batch) {
          const id = `se_${sha([v.id, symbol, window.id, end]).slice(0, 24)}`
          const row = await prismaClient.strategyEvidence.findUnique({ where: { id } }).catch(() => null)
          if (row) {
            await prismaClient.strategyEvidence.update({ where: { id }, data })
          } else {
            await prismaClient.strategyEvidence.create({ data: { id, ...base, symbol, window: window.id, ...data } })
          }
        }
      }
      created += batch.length
    }
    if (!version.backtestable) {
      if (template.id === 'tmpl_ai_catalyst_momentum' || template.botType === 'strategy_based') {
        const bot = await prismaClient.bot.findFirst({
          where: { templateId: template.id, userId: 'usr_platform_canonical', deletedAt: null }
        }) || await prismaClient.bot.findFirst({ where: { templateId: template.id, deletedAt: null } })
        let forwardStats = null
        if (bot) {
          try {
            const { computeAiBotForwardEquity } = await import('./ai/aiBotService.js')
            forwardStats = await computeAiBotForwardEquity(bot.id, { asOfSession: end, includeReplay: false, prismaClient, engine })
          } catch {
            // fallback if computing equity encounters an error
          }
        }
        const primarySymbol = symbols[0] || 'AAPL'
        for (const t of todo) {
          if (t.window.id === 'forward' && forwardStats && forwardStats.status === 'ok' && forwardStats.curve.length > 0) {
            const isPrimary = t.symbol === primarySymbol
            queueSave(t.symbol, t.window, {
              startDate: forwardStats.curve[0]?.date || version.firstSession,
              status: 'ok',
              reason: null,
              results: {
                capital: forwardStats.startingCapital,
                metrics: {
                  returnPct: forwardStats.returnPct,
                  maxDrawdown: { pct: forwardStats.maxDrawdownPct },
                  winRate: forwardStats.winRate,
                  trades: forwardStats.trades,
                  timeInMarketPct: 0
                },
                curve: isPrimary ? downsample(forwardStats.curve.map(p => ({ date: p.date, equity: p.equity })), 260) : null,
                curveSharedWith: isPrimary ? null : primarySymbol,
                buyAndHold: {
                  returnPct: forwardStats.buyAndHold.returnPct,
                  maxDrawdown: { pct: 0 },
                  curve: isPrimary ? downsample(forwardStats.buyAndHold.curve.map(p => ({ date: p.date, equity: p.equity })), 260) : null,
                  curveSharedWith: isPrimary ? null : primarySymbol
                },
                skips: {},
                trades: []
              }
            })
          } else if (t.window.id === 'forward' && bot && (!forwardStats || forwardStats.status === 'awaiting_sessions' || forwardStats.curve?.length === 0)) {
            queueSave(t.symbol, t.window, {
              startDate: null,
              status: 'awaiting_sessions',
              reason: 'This strategy has not recorded any qualifying forward paper trades. Performance results will become available when sufficient verified trading activity exists.'
            })
          } else if (t.window.id === 'forward' && !bot) {
            queueSave(t.symbol, t.window, {
              startDate: null,
              status: 'not_backtestable',
              reason: 'Forward performance evaluation is not configured for this strategy: no active paper trading bot is running.'
            })
          } else {
            queueSave(t.symbol, t.window, { startDate: t.window.start, status: 'not_backtestable', reason: version.reason })
          }
        }
      } else {
        for (const t of todo) {
          if (t.window.id === 'forward') {
            queueSave(t.symbol, t.window, {
              startDate: null,
              status: 'not_backtestable',
              reason: 'Forward performance evaluation is not configured for this strategy: this strategy has neither a point-in-time research replay method nor an active canonical forward paper trading bot.'
            })
          } else {
            queueSave(t.symbol, t.window, { startDate: t.window.start, status: 'not_backtestable', reason: version.reason })
          }
        }
      }
      await commitBatch()
      continue
    }
    const bySymbol = new Map()
    for (const t of todo) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t.window])
    for (const [symbol, wins] of bySymbol) {
      const earliest = [windowStart(end, Math.max(...STANDARD.windows.map((w) => w.years))), ...wins.map((w) => w.start).filter(Boolean)].sort()[0]
      let ds
      try {
        ds = await loadDataset({ symbols: [symbol], start: earliest, end, regimeSymbols: regimeSymbolsOf(v.definition.rules) }, { engine })
      } catch (err) {
        for (const w of wins) queueSave(symbol, w, { startDate: w.start, status: 'no_data', reason: `Price data unavailable: ${String(err.message).slice(0, 200)}` })
        continue
      }
      for (const w of wins) {
        // Forward: strictly after the version's first published session.
        const start = w.id === 'forward' ? ds.data.calendar.find((d) => d > version.firstSession) ?? null : w.start
        if (!start || start > end) {
          queueSave(symbol, w, { startDate: null, status: 'awaiting_sessions', reason: `Starts with the first session after ${version.firstSession}.` })
          continue
        }
        if (!ds.coverage[symbol] || ds.data.unusable.includes(symbol)) {
          queueSave(symbol, w, { startDate: start, status: 'no_data', reason: 'No usable price history for this symbol and window.' })
          continue
        }
        const { rules, parameters } = resolveRules(v.definition, ds.data.bars[symbol] ?? [], start)
        if (!rules) {
          queueSave(symbol, w, { startDate: start, status: 'no_data', reason: 'No price before the window to standardize the trigger.' })
          continue
        }
        const r = await runBacktest({
          bot: { id: `platform:${v.id}`, config: { ...v.definition.config, tickers: [symbol] }, rules },
          symbols: [symbol], start, end: w.end ?? end, executionModel: STANDARD.executionModel, startingCash: STANDARD.startingCash, riskSettings: {}, restrictMode: 'block', data: ds.data,
        })
        queueSave(symbol, w, {
          startDate: start, status: 'ok', dataFingerprint: ds.fingerprint, parameters,
          results: {
            range: r.range, capital: r.capital, metrics: r.metrics,
            buyAndHold: { returnPct: r.buyAndHold.returnPct, maxDrawdown: r.buyAndHold.maxDrawdown, curve: downsample(r.buyAndHold.points.map((p) => ({ date: p.date, equity: p.equity })), 260) },
            curve: downsample(r.curve, 260), skips: r.skips, issues: ds.issues.filter((i) => i.ticker === symbol),
            riskBlocks: r.events.filter((e) => e.type === 'risk_blocked').length, refusals: r.events.filter((e) => e.type === 'refused').length,
            exits: r.trades.filter((tr) => tr.exit).length, trades: r.trades.slice(-60),
          },
        })
        await yieldEvery()
      }
    }
    await commitBatch()
  }
  return { end, created }
}

// ── Public read models (no login) ─────────────────────────────────────────────

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 100) / 100
}

/** Cross-symbol summary of one window's results. */
export function summarize(rows) {
  const ok = rows.filter((r) => r.status === 'ok')
  const traded = ok.filter((r) => r.results.metrics.trades > 0)
  return {
    symbolsTested: ok.length,
    symbolsTraded: traded.length,
    medianReturnPct: median(ok.map((r) => r.results.metrics.returnPct)),
    medianBuyAndHoldPct: median(ok.map((r) => r.results.buyAndHold.returnPct)),
    beatBuyAndHold: ok.filter((r) => r.results.metrics.returnPct > r.results.buyAndHold.returnPct).length,
    worstDrawdownPct: ok.reduce((w, r) => Math.max(w, r.results.metrics.maxDrawdown?.pct ?? 0), 0) || null,
    medianDrawdownPct: median(ok.map((r) => r.results.metrics.maxDrawdown?.pct ?? 0)),
    medianBuyAndHoldDrawdownPct: median(ok.map((r) => r.results.buyAndHold.maxDrawdown?.pct ?? 0)),
    lowerDrawdownThanBuyAndHold: ok.filter((r) => (r.results.metrics.maxDrawdown?.pct ?? 0) < (r.results.buyAndHold.maxDrawdown?.pct ?? 0)).length,
    medianTimeInMarketPct: median(ok.map((r) => r.results.metrics.timeInMarketPct)),
    exits: ok.reduce((s, r) => s + (r.results.exits ?? 0), 0),
    trades: ok.reduce((s, r) => s + r.results.metrics.trades, 0),
    status: ok.length ? 'ok' : rows[0]?.status ?? 'pending',
    reason: ok.length ? null : rows[0]?.reason ?? null,
  }
}

async function currentVersion(prismaClient, template) {
  const id = canonicalStrategy(template).id
  return prismaClient.strategyVersion.findUnique({ where: { id } })
}

async function latestRows(prismaClient, versionId) {
  const latest = await prismaClient.strategyEvidence.findFirst({
    where: { strategyVersionId: versionId },
    orderBy: { endDate: 'desc' },
    select: { endDate: true }
  })
  if (!latest) return { endDate: null, rows: [] }
  const rows = await prismaClient.strategyEvidence.findMany({
    where: { strategyVersionId: versionId, endDate: latest.endDate },
    orderBy: { symbol: 'asc' }
  })
  return { endDate: latest.endDate, rows }
}

export async function listPublicStrategies({ prismaClient = prisma } = {}) {
  const templates = await prismaClient.botTemplate.findMany({ orderBy: { id: 'asc' } })
  return Promise.all(templates.map(async (t) => {
    const version = await currentVersion(prismaClient, t)
    const { endDate, rows } = version ? await latestRows(prismaClient, version.id) : { endDate: null, rows: [] }
    const byWindow = (w) => summarize(rows.filter((r) => r.window === w))
    return {
      templateId: t.id, name: t.name, description: t.description, tags: t.tags ?? [], workshopAvailable: t.botType === 'rule_based',
      version: version ? { id: version.id, firstSession: version.firstSession, backtestable: version.backtestable, reason: version.reason } : null,
      asOf: endDate,
      windows: Object.fromEntries(['5Y', '1Y', 'forward', 'development', 'holdout'].map((w) => [w, byWindow(w)]).filter(([w, x]) => x.status !== 'pending' || ['5Y', '1Y', 'forward'].includes(w))),
      design: designFor(t.id) && version?.id === canonicalStrategy(t).id ? designFor(t.id) : null,
    }
  }))
}

export async function getPublicStrategy(templateId, { prismaClient = prisma, versionId = null } = {}) {
  const t = await prismaClient.botTemplate.findUnique({ where: { id: templateId } })
  if (!t) return null
  const current = canonicalStrategy(t)
  // Any published version of this strategy can be inspected; results stay with their version.
  const stored = versionId ? await prismaClient.strategyVersion.findUnique({ where: { id: versionId } }) : null
  if (versionId && (!stored || stored.templateId !== templateId)) return null
  const v = stored ? { id: stored.id, definition: stored.definition, backtestable: stored.backtestable, reason: stored.reason } : current
  const version = stored ?? await prismaClient.strategyVersion.findUnique({ where: { id: v.id } })
  const { endDate, rows } = version ? await latestRows(prismaClient, version.id) : { endDate: null, rows: [] }
  const all = await prismaClient.strategyVersion.findMany({ where: { templateId }, orderBy: { createdAt: 'desc' } })
  const strip = (r) => {
    let res = r.results
    if (res && res.curveSharedWith) {
      const partner = rows.find((x) => x.symbol === res.curveSharedWith && x.window === r.window)
      if (partner?.results?.curve) {
        res = {
          ...res,
          curve: partner.results.curve,
          buyAndHold: partner.results.buyAndHold ? {
            ...res.buyAndHold,
            curve: partner.results.buyAndHold.curve
          } : res.buyAndHold
        }
      }
    } else if (res?.buyAndHold?.curveSharedWith) {
      const partner = rows.find((x) => x.symbol === res.buyAndHold.curveSharedWith && x.window === r.window)
      if (partner?.results?.buyAndHold?.curve) {
        res = {
          ...res,
          buyAndHold: {
            ...res.buyAndHold,
            curve: partner.results.buyAndHold.curve
          }
        }
      }
    }
    return {
      symbol: r.symbol, window: r.window, startDate: r.startDate, endDate: r.endDate, status: r.status, reason: r.reason,
      parameters: r.parameters, dataFingerprint: r.dataFingerprint, riskPolicyVersion: r.riskPolicyVersion, results: res
    }
  }
  const windows = ['5Y', '1Y', 'forward', ...(v.definition.design ? ['development', 'holdout'] : [])]
  return {
    templateId: t.id, name: t.name, description: t.description, tags: t.tags ?? [], workshopAvailable: t.botType === 'rule_based',
    version: { id: v.id, current: v.id === current.id, published: Boolean(version), firstSession: version?.firstSession ?? null, backtestable: v.backtestable, reason: v.reason },
    definition: v.definition,
    design: v.definition.design ?? null,
    standard: { ...STANDARD, windows, executionModelLabel: EXECUTION_MODELS[STANDARD.executionModel].label },
    assumptions: ASSUMPTIONS,
    asOf: endDate,
    summary: Object.fromEntries(windows.map((w) => [w, summarize(rows.filter((r) => r.window === w))])),
    results: rows.map(strip),
    versions: all.map((p) => ({ id: p.id, firstSession: p.firstSession, current: p.id === current.id, selected: p.id === v.id })),
  }
}

/**
 * Compaction of historical evidence snapshots.
 * Preserves all immutable scalar audit metrics (returns, drawdowns, trades, win rates, fingerprints)
 * while pruning redundant time-series visualization curves and verbose trade lists from older superseded sessions.
 */
export async function compactHistoricalEvidence({ prismaClient = prisma } = {}) {
  const versions = await prismaClient.strategyVersion.findMany({ select: { id: true } })
  let compactedRows = 0

  for (const { id: versionId } of versions) {
    const allRows = await prismaClient.strategyEvidence.findMany({
      where: { strategyVersionId: versionId }
    })
    if (!allRows.length) continue

    const endDates = [...new Set(allRows.map((r) => r.endDate))].sort().reverse()
    if (endDates.length <= 1) continue

    const supersededDates = new Set(endDates.slice(1))
    const toUpdate = []

    for (const r of allRows) {
      if (!supersededDates.has(r.endDate)) continue
      if (!r.results || r.results.compacted) continue
      const res = r.results
      const compactedResults = {
        compacted: true,
        capital: res.capital,
        range: res.range,
        metrics: res.metrics,
        buyAndHold: res.buyAndHold ? {
          returnPct: res.buyAndHold.returnPct,
          maxDrawdown: res.buyAndHold.maxDrawdown
        } : null,
        exits: res.exits,
        tradesCount: Array.isArray(res.trades) ? res.trades.length : (res.metrics?.trades ?? 0),
        skips: res.skips,
        riskBlocks: res.riskBlocks,
        refusals: res.refusals
      }
      toUpdate.push({ id: r.id, data: { results: compactedResults } })
    }

    if (toUpdate.length > 0) {
      if (typeof prismaClient.$transaction === 'function') {
        const ops = toUpdate.map(({ id, data }) => prismaClient.strategyEvidence.update({ where: { id }, data }))
        await prismaClient.$transaction(ops)
      } else {
        for (const { id, data } of toUpdate) {
          await prismaClient.strategyEvidence.update({ where: { id }, data })
        }
      }
      compactedRows += toUpdate.length
    }
  }
  return { compactedRows }
}
