/**
 * The one way to save a bot's configuration: create or update a bot and its rules in a
 * single transaction. Either every change is written or none is.
 *
 *   config  — a patch, deep-merged into the stored config: plain objects merge key by key,
 *             arrays and scalars replace, `null` removes a key. Keys you don't send are kept
 *             (including engine-read settings the UI never shows and the research policy).
 *   rules   — when sent, the complete desired rule set. Items with `id` update that rule
 *             (unchanged items are not written); items without `id` are created; existing
 *             rules not listed are deleted. Omit `rules` to leave them untouched.
 *
 * Validation reuses the existing rule (ruleConfigError) and research-policy
 * (resolveResearchPolicy) checks, and runs on the fully merged result before any write.
 */
import { isDeepStrictEqual } from 'node:util'
import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { ruleConfigError } from '../utils/ruleConfig.js'
import { isResearchDriven, resolveResearchPolicy } from '../../../worker/src/engine/researchDecision.js'
import { getEmergencyStop } from './emergencyStopService.js'
import { simulationConfig } from './simulationService.js'

export const RULE_TYPES = ['price_threshold', 'position_limit', 'daily_loss', 'market_hours', 'cooldown', 'trend_filter', 'time_window']
const RULE_NAMES = {
  price_threshold: 'Price trigger', position_limit: 'Position limit', daily_loss: 'Daily loss limit',
  market_hours: 'Market hours', cooldown: 'Cooldown', trend_filter: 'Trend filter', time_window: 'Trading window'
}

export class BotSaveError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    Object.assign(this, { status, code, extra })
  }
}
const invalid = (message, extra) => new BotSaveError(400, 'INVALID_CONFIG', message, extra)

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function mergeConfig(base, patch) {
  if (!isPlain(patch)) return isPlain(base) ? structuredClone(base) : {}
  const out = isPlain(base) ? structuredClone(base) : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (isPlain(v) && isPlain(out[k])) out[k] = mergeConfig(out[k], v)
    else out[k] = structuredClone(v)
  }
  return out
}

const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Checks on the merged bot config. Fields absent from the config are not required here. */
export function assertValidConfig(config) {
  const t = config.tickers
  if (!Array.isArray(t) || t.length === 0 || !t.every((s) => typeof s === 'string' && s.trim())) throw invalid('Add at least one symbol.', { field: 'tickers' })
  const tradable = simulationConfig().tradableSymbols
  if (tradable) {
    const outside = t.map((s) => s.trim().toUpperCase()).filter((s) => !tradable.includes(s))
    if (outside.length) {
      throw invalid(`${outside.join(', ')} ${outside.length === 1 ? 'isn’t' : 'aren’t'} available in paper trading. Choose from ${tradable.join(', ')}.`, { field: 'tickers', allowed: tradable })
    }
  }
  if (config.direction !== undefined && config.direction !== 'buy' && config.direction !== 'sell') throw invalid('Direction must be "buy" or "sell".', { field: 'direction' })
  for (const [field, label] of [['allocatedAmount', 'Capital'], ['maxOrderNotional', 'Per-order limit'], ['quantity', 'Quantity']]) {
    if (config[field] !== undefined && !positive(config[field])) throw invalid(`${label} must be greater than 0.`, { field })
  }
  if (isResearchDriven({ config })) {
    const resolved = resolveResearchPolicy(config)
    if (!resolved.ok) throw invalid(`Invalid research settings (${resolved.reason}).`, { field: 'research' })
  }
}

function normalizeConfig(config) {
  const out = { ...config, tickers: config.tickers.map((s) => s.trim().toUpperCase()) }
  // Evidence requirements are locked on in the beta (see RESEARCH_EVIDENCE_LOCKED): store what applies.
  if (isResearchDriven({ config: out }) && out.research?.requireEdgeOverBaseline === false) {
    out.research = { ...out.research, requireEdgeOverBaseline: true }
  }
  if (out.allocatedAmount !== undefined && out.capitalMode === undefined) out.capitalMode = 'allocated'
  return out
}

/** Validates the desired rule set against the bot's current rules and returns the write plan. */
function planRules(input, existing) {
  if (!Array.isArray(input)) throw new BotSaveError(400, 'INVALID_RULE', 'rules must be an array.')
  const byId = new Map(existing.map((r) => [r.id, r]))
  const seen = new Set()
  const plan = { create: [], update: [], keep: [], remove: [] }
  input.forEach((r, index) => {
    if (!isPlain(r)) throw new BotSaveError(400, 'INVALID_RULE', 'Each rule must be an object.', { ruleIndex: index })
    if (r.name !== undefined && (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 100)) throw new BotSaveError(400, 'INVALID_RULE', 'Rule names must be 1–100 characters.', { ruleIndex: index })
    if (r.config !== undefined && !isPlain(r.config)) throw new BotSaveError(400, 'INVALID_RULE', 'A rule’s config must be an object.', { ruleIndex: index })
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') throw new BotSaveError(400, 'INVALID_RULE', 'enabled must be true or false.', { ruleIndex: index })
    if (r.id !== undefined) {
      const cur = byId.get(r.id)
      if (!cur || seen.has(r.id)) throw new BotSaveError(400, 'INVALID_RULE', 'Unknown or repeated rule id.', { ruleIndex: index, ruleId: r.id })
      seen.add(r.id)
      if (r.type !== undefined && r.type !== cur.type) throw new BotSaveError(400, 'INVALID_RULE', 'A rule’s type can’t be changed; remove it and add a new one.', { ruleIndex: index, ruleId: r.id })
      const next = { name: r.name ?? cur.name, config: r.config ?? cur.config ?? {}, enabled: r.enabled ?? cur.enabled }
      const err = ruleConfigError(cur.type, next.config)
      if (err) throw new BotSaveError(400, 'INVALID_RULE', err, { ruleIndex: index, ruleId: r.id, type: cur.type })
      const same = next.name === cur.name && next.enabled === cur.enabled && isDeepStrictEqual(next.config, cur.config ?? {})
      ;(same ? plan.keep : plan.update).push({ id: r.id, ...next })
    } else {
      if (!RULE_TYPES.includes(r.type)) throw new BotSaveError(400, 'INVALID_RULE', `Unknown rule type: ${r.type}`, { ruleIndex: index })
      const config = r.config ?? {}
      const err = ruleConfigError(r.type, config)
      if (err) throw new BotSaveError(400, 'INVALID_RULE', err, { ruleIndex: index, type: r.type })
      plan.create.push({ type: r.type, name: r.name ?? RULE_NAMES[r.type], config, enabled: r.enabled ?? true })
    }
  })
  plan.remove = existing.filter((r) => !seen.has(r.id)).map((r) => r.id)
  return plan
}

/**
 * @param {string} userId authenticated user
 * @param {object} input { id?, templateId?, portfolioId?, name?, enabled?, config?, rules?, expectedUpdatedAt? }
 * @param {{ ensureBroker?: (userId) => Promise<void> }} hooks called before a bot is created or enabled
 */
export async function saveBot(userId, input = {}, { ensureBroker = async () => {} } = {}) {
  const creating = input.id === undefined
  if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)) throw invalid('Name must be 1–100 characters.', { field: 'name' })
  if (input.config !== undefined && !isPlain(input.config)) throw invalid('config must be an object.', { field: 'config' })
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw invalid('enabled must be true or false.', { field: 'enabled' })
  if (!creating && (input.portfolioId !== undefined || input.templateId !== undefined)) throw invalid('A bot’s portfolio and starting point can’t be changed.', { field: input.portfolioId !== undefined ? 'portfolioId' : 'templateId' })

  if (input.enabled === true && (await getEmergencyStop(userId)).active) {
    throw new BotSaveError(403, 'EMERGENCY_STOP_ACTIVE', 'Emergency stop is active. Save the bot paused or clear the stop first.')
  }

  // Everything that can be checked before the transaction is checked here, so a failed save
  // writes nothing; the transaction re-reads the bot under a row lock before merging.
  let template = null
  if (creating) {
    if (!input.portfolioId) throw invalid('portfolioId is required.', { field: 'portfolioId' })
    const portfolio = await prisma.portfolio.findUnique({ where: { id: input.portfolioId } })
    if (!portfolio || portfolio.userId !== userId) throw new BotSaveError(400, 'INVALID_PORTFOLIO', 'Invalid portfolioId')
    if (input.templateId !== undefined) {
      template = await prisma.botTemplate.findUnique({ where: { id: input.templateId } })
      if (!template) throw new BotSaveError(404, 'TEMPLATE_NOT_FOUND', 'Starting point not found')
    }
    if (!(input.name ?? template?.name)) throw invalid('Name can’t be empty.', { field: 'name' })
    await ensureBroker(userId)
  }

  const result = await prisma.$transaction(async (tx) => {
    let bot = null
    if (!creating) {
      if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM Bot WHERE id = ${input.id} FOR UPDATE`
      bot = await tx.bot.findFirst({ where: { id: input.id, deletedAt: null } })
      if (!bot || bot.userId !== userId) throw new BotSaveError(404, 'NOT_FOUND', 'Bot not found')
      bot.rules = await tx.botRule.findMany({ where: { botId: bot.id }, orderBy: { createdAt: 'asc' } })
      if (input.expectedUpdatedAt !== undefined && new Date(input.expectedUpdatedAt).getTime() !== new Date(bot.updatedAt).getTime()) {
        throw new BotSaveError(409, 'STALE_BOT', 'This bot changed since it was loaded. Reload and try again.', { updatedAt: bot.updatedAt })
      }
      if (input.enabled === true && !bot.enabled) await ensureBroker(userId)
    }

    const base = creating ? (template?.config ?? {}) : bot.config
    const config = normalizeConfig((() => { const c = mergeConfig(base, input.config ?? {}); assertValidConfig(c); return c })())
    const rulesInput = input.rules ?? (creating ? (template?.rules ?? []) : undefined)
    const plan = rulesInput === undefined ? null : planRules(rulesInput, creating ? [] : bot.rules)

    if (creating) {
      bot = await tx.bot.create({
        data: {
          id: generateId(ID_PREFIXES.BOT), userId, portfolioId: input.portfolioId,
          templateId: template?.id ?? null, botType: template?.botType ?? 'rule_based',
          name: (input.name ?? template.name).trim(), enabled: input.enabled ?? false, config
        }
      })
    } else {
      const data = {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(!isDeepStrictEqual(config, bot.config) ? { config } : {})
      }
      if (Object.keys(data).length) await tx.bot.update({ where: { id: bot.id }, data })
      if (input.enabled !== undefined && input.enabled !== bot.enabled) {
        await tx.botEvent.create({
          data: {
            id: generateId(ID_PREFIXES.EVENT), botId: bot.id, portfolioId: bot.portfolioId,
            type: input.enabled ? 'bot_resumed' : 'bot_paused', detail: input.enabled ? 'Bot resumed' : 'Bot paused',
            metadata: { enabled: input.enabled, userId }
          }
        })
      }
    }

    const changes = { rulesCreated: 0, rulesUpdated: 0, rulesDeleted: 0, rulesUnchanged: 0 }
    if (plan) {
      for (const id of plan.remove) await tx.botRule.delete({ where: { id } })
      for (const r of plan.update) await tx.botRule.update({ where: { id: r.id }, data: { name: r.name, config: r.config, enabled: r.enabled } })
      for (const r of plan.create) await tx.botRule.create({ data: { id: generateId(ID_PREFIXES.RULE), botId: bot.id, ...r } })
      Object.assign(changes, { rulesCreated: plan.create.length, rulesUpdated: plan.update.length, rulesDeleted: plan.remove.length, rulesUnchanged: plan.keep.length })
    }

    const saved = await tx.bot.findUnique({ where: { id: bot.id } })
    saved.rules = await tx.botRule.findMany({ where: { botId: bot.id }, orderBy: { createdAt: 'asc' } })
    return { bot: saved, changes }
  })
  return { ...result, created: creating }
}
