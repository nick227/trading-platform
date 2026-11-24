/**
 * Backtests: create (validated, immutable snapshot), process (worker), read.
 *
 * A run is a hypothetical historical simulation of one bot configuration. It never writes
 * Execution rows, never touches a broker, and is reproducible from its snapshot: config +
 * enabled rules + owner risk settings + restrict mode, date range, execution model, risk-policy
 * version and the fingerprint of the exact (normalized) prices it used.
 */
import { createHash, randomUUID } from 'node:crypto'
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { assertValidConfig, RULE_TYPES } from './botConfigService.js'
import { ruleConfigError } from '../utils/ruleConfig.js'
import { DEFAULT_TRADABLE_SYMBOLS, simulationConfig } from './simulationService.js'
import { isResearchDriven } from '../../../worker/src/engine/researchDecision.js'
import { RISK_POLICY_VERSION } from '../../../worker/src/risk/riskCore.js'
import { EXECUTION_MODELS, runBacktest } from '../../../worker/src/backtest/historicalRunner.js'
import { canonical, dataFingerprint, normalizeDataset } from '../../../worker/src/backtest/priceData.js'

export const BACKTEST_LIMITS = Object.freeze({ maxDays: 366 * 5 + 1, maxSymbols: 5, warmupDays: 45, calendarTicker: 'SPY', staleRunMs: 30 * 60_000 })
const RANGES = { '1Y': 1, '3Y': 3, '5Y': 5 }

export class BacktestError extends Error {
  constructor(status, code, message, details = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}
const bad = (code, message, details) => new BacktestError(422, code, message, details)

const isoDate = (d) => d.toISOString().slice(0, 10)
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

/** The latest completed weekday session (UTC) on/before `now` — an upper bound; data decides the rest. */
function defaultEnd(now) {
  const d = new Date(now)
  if (d.getUTCHours() < 21) d.setUTCDate(d.getUTCDate() - 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return isoDate(d)
}

export function resolveRange({ range, start, end }, now = Date.now()) {
  const e = end ?? defaultEnd(now)
  if (!validDate(e)) throw bad('invalid_end', 'End must be a date (YYYY-MM-DD).')
  let s = start
  if (!s) {
    const years = RANGES[range ?? '1Y']
    if (!years) throw bad('invalid_range', 'Range must be 1Y, 3Y or 5Y.')
    const d = new Date(`${e}T00:00:00Z`)
    d.setUTCFullYear(d.getUTCFullYear() - years)
    s = isoDate(d)
  }
  if (!validDate(s)) throw bad('invalid_start', 'Start must be a date (YYYY-MM-DD).')
  const days = (Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86_400_000
  if (days <= 0) throw bad('invalid_range', 'Start must be before end.')
  if (days > BACKTEST_LIMITS.maxDays) throw bad('range_too_long', 'A backtest can cover at most 5 years.', { maxDays: BACKTEST_LIMITS.maxDays })
  if (Date.parse(`${e}T00:00:00Z`) > now) throw bad('future_end', 'End can’t be in the future.')
  return { start: s, end: e }
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) throw bad('invalid_rules', 'Rules must be a list.')
  return rules.filter((r) => r && r.enabled !== false).map((r) => {
    if (!RULE_TYPES.includes(r.type)) throw bad('invalid_rules', `Unknown rule type: ${r.type}`)
    const err = ruleConfigError(r.type, r.config ?? {})
    if (err) throw bad('invalid_rules', err, { type: r.type })
    return { type: r.type, config: r.config ?? {} }
  })
}

/** Validates a request and stores a queued run with its immutable snapshot. */
export async function createBacktest(userId, input = {}, { prismaClient = prisma, config: sim = simulationConfig(), now = Date.now() } = {}) {
  let botId = null
  let name = typeof input.name === 'string' ? input.name.slice(0, 120) : null
  let botConfig
  let rules
  if (input.botId) {
    const bot = await prismaClient.bot.findUnique({ where: { id: String(input.botId) } })
    if (!bot || bot.userId !== userId || bot.deletedAt) throw new BacktestError(404, 'not_found', 'Bot not found')
    botId = bot.id
    name = name ?? bot.name
    botConfig = bot.config ?? {}
    rules = normalizeRules(await prismaClient.botRule.findMany({ where: { botId: bot.id, enabled: true }, orderBy: { createdAt: 'asc' } }))
  } else {
    botConfig = input.config ?? {}
    rules = normalizeRules(input.rules ?? [])
  }
  try { assertValidConfig({ ...botConfig, tickers: botConfig.tickers ?? input.symbols }) } catch (err) {
    throw bad(err.code ?? 'invalid_config', err.message, err.details ?? {})
  }
  if (isResearchDriven({ config: botConfig })) {
    throw bad('research_not_backtestable', 'Research bots can’t be backtested yet: Alpha Engine has no point-in-time research history to replay.')
  }
  if (botConfig.direction !== 'buy' && botConfig.direction !== 'sell') throw bad('missing_direction', 'Choose whether the bot buys or sells.')

  const supported = sim.tradableSymbols ?? DEFAULT_TRADABLE_SYMBOLS
  const symbols = [...new Set((input.symbols ?? botConfig.tickers ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean))]
  if (!symbols.length) throw bad('no_symbols', 'Add at least one symbol.')
  if (symbols.length > BACKTEST_LIMITS.maxSymbols) throw bad('too_many_symbols', `A backtest can include at most ${BACKTEST_LIMITS.maxSymbols} symbols.`)
  const outside = symbols.filter((s) => !supported.includes(s))
  if (outside.length) throw bad('unsupported_symbols', `${outside.join(', ')} ${outside.length === 1 ? 'isn’t' : 'aren’t'} supported. Choose from ${supported.join(', ')}.`, { allowed: supported })

  const executionModel = input.executionModel ?? 'next_open'
  if (!EXECUTION_MODELS[executionModel]) throw bad('invalid_execution_model', 'Execution model must be next_open or same_close.')
  const { start, end } = resolveRange(input, now)

  const owner = await prismaClient.user.findUnique({ where: { id: userId }, select: { riskSettings: true } })
  const rs = owner?.riskSettings && typeof owner.riskSettings === 'object' ? owner.riskSettings : {}
  const { emergencyStop: _es, ...riskSettings } = rs
  const snapshot = {
    bot: { config: { ...botConfig, tickers: symbols }, rules },
    riskSettings,
    restrictMode: ['block', 'reduce'].includes(process.env.RISK_RESTRICT_MODE) ? process.env.RISK_RESTRICT_MODE : 'block',
    startingCash: sim.startingCash ?? 100_000,
  }
  const configHash = createHash('sha256').update(canonical(snapshot)).digest('hex')
  try {
    return await prismaClient.backtestRun.create({ data: {
      id: `bt_${Date.now()}_${randomUUID().slice(0, 8)}`, userId, botId, status: 'queued', activeKey: userId, name,
      symbols, startDate: start, endDate: end, executionModel, riskPolicyVersion: RISK_POLICY_VERSION,
      configSnapshot: snapshot, configHash,
    } })
  } catch (err) {
    if (err?.code === 'P2002') throw new BacktestError(409, 'backtest_already_running', 'You already have a backtest running. It usually finishes within a minute.')
    throw err
  }
}

export function publicRun(run) {
  if (!run) return null
  const { activeKey: _a, userId: _u, ...rest } = run
  return rest
}

export async function getBacktest(id, userId, { prismaClient = prisma } = {}) {
  const run = await prismaClient.backtestRun.findUnique({ where: { id } })
  return run && run.userId === userId ? run : null
}

export async function listBacktests(userId, { botId = null, limit = 10, prismaClient = prisma } = {}) {
  const runs = await prismaClient.backtestRun.findMany({ where: { userId, ...(botId ? { botId } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(50, limit) })
  // Lists carry metrics only; the curve and trades come with the single run.
  return runs.map((r) => ({ ...publicRun(r), results: r.results ? { metrics: r.results.metrics, buyAndHold: { returnPct: r.results.buyAndHold?.returnPct, maxDrawdown: r.results.buyAndHold?.maxDrawdown }, capital: r.results.capital } : null }))
}

// ── Worker side ───────────────────────────────────────────────────────────────

/** Fetches, validates and fingerprints everything a run needs. */
export async function loadRunData(run, { engine = engineClient } = {}) {
  const warm = new Date(`${run.startDate}T00:00:00Z`)
  warm.setUTCDate(warm.getUTCDate() - BACKTEST_LIMITS.warmupDays)
  const fetchStart = isoDate(warm)
  const tickers = [...new Set([BACKTEST_LIMITS.calendarTicker, ...run.symbols])]
  const raw = {}
  const sources = {}
  for (const t of tickers) {
    const r = await engine.getDailyBars(t, fetchStart, run.endDate)
    raw[t] = Array.isArray(r?.bars) ? r.bars : []
    sources[t] = r?.sha256 ?? null
  }
  const ds = normalizeDataset(raw, { calendarTicker: BACKTEST_LIMITS.calendarTicker })
  const regimeSymbols = [...new Set((run.configSnapshot.bot.rules ?? []).filter((r) => r.type === 'trend_filter').map((r) => String(r.config?.symbol ?? 'SPY').toUpperCase()))]
  const regimes = {}
  for (const s of regimeSymbols) {
    const r = await engine.getRegimeHistory(s, fetchStart, run.endDate)
    regimes[s] = Array.isArray(r?.points) ? r.points : []
  }
  const coverage = Object.fromEntries(run.symbols.map((t) => [t, ds.availability[t] ?? null]))
  const late = run.symbols.filter((t) => coverage[t] && coverage[t].first > run.startDate)
  const issues = [...ds.issues, ...late.map((t) => ({ ticker: t, type: 'available_from', date: coverage[t].first }))]
  const fingerprint = dataFingerprint({ bars: ds.bars, regimes, issues, calendar: ds.calendar, sources })
  return { data: { bars: ds.bars, calendar: ds.calendar, regimes, unusable: ds.unusable }, issues, coverage, fingerprint }
}

/** Claims and runs the oldest queued backtest. Returns the finished run, or null if none. */
export async function processNextBacktest({ prismaClient = prisma, engine = engineClient, now = () => new Date() } = {}) {
  const next = await prismaClient.backtestRun.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } })
  if (!next) return null
  const claimed = await prismaClient.backtestRun.updateMany({ where: { id: next.id, status: 'queued' }, data: { status: 'running', startedAt: now() } })
  if (claimed.count !== 1) return null
  try {
    const { data, issues, coverage, fingerprint } = await loadRunData(next, { engine })
    const usable = next.symbols.filter((t) => !data.unusable.includes(t) && coverage[t])
    if (!usable.length) throw new BacktestError(422, 'no_usable_data', 'No usable price history for these symbols in this range.')
    const snap = next.configSnapshot
    const results = await runBacktest({
      bot: { id: next.botId ?? 'draft', config: snap.bot.config, rules: snap.bot.rules },
      symbols: next.symbols, start: next.startDate, end: next.endDate, executionModel: next.executionModel,
      startingCash: snap.startingCash, riskSettings: snap.riskSettings, restrictMode: snap.restrictMode, data,
    })
    if (results.riskPolicyVersion !== next.riskPolicyVersion) {
      throw new BacktestError(409, 'risk_policy_changed', 'The risk policy changed since this backtest was requested. Run it again.')
    }
    results.coverage = coverage
    return await prismaClient.backtestRun.update({ where: { id: next.id }, data: {
      status: 'succeeded', activeKey: null, finishedAt: now(), dataFingerprint: fingerprint, dataIssues: issues, results,
    } })
  } catch (err) {
    return prismaClient.backtestRun.update({ where: { id: next.id }, data: {
      status: 'failed', activeKey: null, finishedAt: now(), error: String(err?.message ?? err).slice(0, 490),
    } })
  }
}

/** Fails runs left 'running' by a worker that stopped mid-run, freeing the user's slot. */
export async function failStaleBacktests({ prismaClient = prisma, now = () => new Date() } = {}) {
  const cutoff = new Date(now().getTime() - BACKTEST_LIMITS.staleRunMs)
  return prismaClient.backtestRun.updateMany({ where: { status: 'running', startedAt: { lt: cutoff } }, data: { status: 'failed', activeKey: null, finishedAt: now(), error: 'Interrupted: the worker stopped during this run. Run it again.' } })
}
