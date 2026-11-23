/**
 * Algorithm Builder Canonical Model
 *
 * Single source of truth for creating and editing bots.
 * Preserves every supported rule and configuration option:
 *  - price thresholds (price_threshold)
 *  - trend filters (trend_filter)
 *  - market hours & extended hours (market_hours)
 *  - time windows (time_window)
 *  - cooldown windows (cooldown)
 *  - position and quantity limits (position_limit)
 *  - daily realized-loss limits (daily_loss)
 *  - order direction (buy/sell)
 *  - symbol selection (tickers)
 *  - Alpha Engine research policy (minConfidence, maxAge, maxDrift, edge requirement)
 */

import { isResearchBot } from '../../../ui/describeBot'
import {
  DEFAULT_CAPITAL,
  MAX_CAPITAL,
  defaultCapital,
  defaultMaxPerOrder,
  parseSymbols,
} from '../new/newBotApi'

const HOUR = 3_600_000

export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/

function findRule(rules, type) {
  return (rules ?? []).find((r) => r?.type === type) ?? null
}

function cooldownHours(c) {
  const ms = Number(c?.windowMs ?? (c?.cooldownHours ? c.cooldownHours * HOUR : c?.minutes ? c.minutes * 60_000 : NaN))
  return Number.isFinite(ms) ? String(Math.round((ms / HOUR) * 100) / 100) : '24'
}

/**
 * Initializes a draft for creating a new bot from a template or defaults.
 */
export function initCreateDraft(template, data = {}, pinnedTicker = null) {
  const t = template || {}
  const config = t.config && typeof t.config === 'object' ? t.config : {}
  const rules = Array.isArray(t.rules) ? t.rules : []
  const symbols = pinnedTicker
    ? [pinnedTicker.toUpperCase()]
    : Array.isArray(config.tickers) && config.tickers.length
      ? config.tickers
      : []

  const symbolsText = symbols.join(', ')
  const cap = defaultCapital(t, data?.buyingPower ?? null)
  const maxPerOrder = defaultMaxPerOrder(t, cap)
  const isResearch = Boolean(t.research) || isResearchBot(config)
  const priceRule = findRule(rules, 'price_threshold')
  const trendRule = findRule(rules, 'trend_filter')

  let triggerType = 'schedule'
  if (isResearch) {
    triggerType = 'alpha_research'
  } else if (priceRule) {
    triggerType = 'price_threshold'
  } else if (trendRule) {
    triggerType = 'trend_filter'
  }

  const hours = findRule(rules, 'market_hours')
  const cd = findRule(rules, 'cooldown')
  const pos = findRule(rules, 'position_limit')
  const loss = findRule(rules, 'daily_loss')
  const r = config.research ?? t.research?.base ?? {}

  return {
    isEdit: false,
    botId: null,
    templateId: t.id ?? null,
    templateName: t.name ?? 'Custom',
    name: t.name ? `${t.name}${symbols[0] ? ` · ${symbols[0]}` : ''}` : '',
    symbolsText,
    direction: config.direction === 'sell' ? 'sell' : 'buy',
    capital: String(cap ?? DEFAULT_CAPITAL),
    maxPerOrder: String(maxPerOrder ?? cap ?? DEFAULT_CAPITAL),
    confirmed: false,

    // When / Trigger
    triggerType,
    trigger: priceRule
      ? {
          operator: priceRule.config?.operator ?? priceRule.config?.direction ?? (config.direction === 'sell' ? 'below' : 'above'),
          price: Number(priceRule.config?.price) > 0 ? String(priceRule.config.price) : '',
        }
      : {
          operator: config.direction === 'sell' ? 'below' : 'above',
          price: '',
        },

    // Research policy
    research: isResearch
      ? {
          minScore: String(Math.round(Number(r.minConfidence ?? 0.6) * 100)),
          maxAgeHours: String(r.maxPredictionAgeHours ?? 96),
          maxDriftPct: String(r.maxEntryDriftPct ?? 5),
          requireEdge: r.requireEdgeOverBaseline !== false,
          base: r,
        }
      : null,

    // More settings / Limits & Schedules
    marketHours: {
      on: Boolean(hours),
      extended: Boolean(hours?.config?.allowPremarket || hours?.config?.allowAfterHours),
    },
    cooldown: {
      on: Boolean(cd),
      hours: cd ? cooldownHours(cd.config) : '24',
    },
    positionLimit: {
      on: Boolean(pos),
      maxShares: String(pos?.config?.maxShares ?? pos?.config?.maxQuantity ?? 100),
      maxPositions: pos?.config?.maxPositions ?? null,
    },
    dailyLoss: {
      on: Boolean(loss),
      maxLoss: String(loss?.config?.maxLoss ?? 500),
      maxDailyLossPct: loss?.config?.maxDailyLossPct ?? null,
    },
    fixed: rules.filter((x) => x.type === 'trend_filter' || x.type === 'time_window'),
  }
}

/**
 * Initializes a draft for editing an existing bot.
 */
export function initEditDraft(bot) {
  const config = bot?.config && typeof bot.config === 'object' ? bot.config : {}
  const rules = Array.isArray(bot?.rules) ? bot.rules : []
  const tickers = Array.isArray(bot?.tickers) && bot.tickers.length
    ? bot.tickers
    : Array.isArray(config.tickers)
      ? config.tickers
      : []

  const priceRule = findRule(rules, 'price_threshold')
  const trendRule = findRule(rules, 'trend_filter')
  const isResearch = isResearchBot(config)

  let triggerType = 'schedule'
  if (isResearch) {
    triggerType = 'alpha_research'
  } else if (priceRule) {
    triggerType = 'price_threshold'
  } else if (trendRule) {
    triggerType = 'trend_filter'
  }

  const hours = findRule(rules, 'market_hours')
  const cd = findRule(rules, 'cooldown')
  const pos = findRule(rules, 'position_limit')
  const loss = findRule(rules, 'daily_loss')
  const r = config.research ?? {}

  const cap = bot.allocation ?? config.allocatedAmount
  const maxOrder = bot.maxPerOrder ?? config.maxOrderNotional

  return {
    isEdit: true,
    botId: bot.id,
    updatedAt: bot.updatedAt ?? null,
    templateId: bot.templateId ?? null,
    templateName: bot.strategyName ?? bot.name,
    name: bot.name || '',
    symbolsText: tickers.join(', '),
    direction: bot.direction || config.direction || 'buy',
    capital: cap !== null && cap !== undefined ? String(cap) : '',
    maxPerOrder: maxOrder !== null && maxOrder !== undefined ? String(maxOrder) : '',
    confirmed: true,

    // When / Trigger
    triggerType,
    trigger: priceRule
      ? {
          operator: priceRule.config?.operator ?? priceRule.config?.direction ?? (config.direction === 'sell' ? 'below' : 'above'),
          price: Number(priceRule.config?.price) > 0 ? String(priceRule.config.price) : '',
        }
      : {
          operator: config.direction === 'sell' ? 'below' : 'above',
          price: '',
        },

    // Research policy
    research: isResearch
      ? {
          minScore: String(Math.round(Number(r.minConfidence ?? 0.6) * 100)),
          maxAgeHours: String(r.maxPredictionAgeHours ?? 96),
          maxDriftPct: String(r.maxEntryDriftPct ?? 5),
          requireEdge: r.requireEdgeOverBaseline !== false,
          base: r,
        }
      : null,

    // More settings / Limits
    marketHours: {
      on: Boolean(hours),
      extended: Boolean(hours?.config?.allowPremarket || hours?.config?.allowAfterHours),
    },
    cooldown: {
      on: Boolean(cd),
      hours: cd ? cooldownHours(cd.config) : '24',
    },
    positionLimit: {
      on: Boolean(pos),
      maxShares: String(pos?.config?.maxShares ?? pos?.config?.maxQuantity ?? 100),
      maxPositions: pos?.config?.maxPositions ?? null,
    },
    dailyLoss: {
      on: Boolean(loss),
      maxLoss: String(loss?.config?.maxLoss ?? 500),
      maxDailyLossPct: loss?.config?.maxDailyLossPct ?? null,
    },
    fixed: rules.filter((x) => x.type === 'trend_filter' || x.type === 'time_window'),
  }
}

/**
 * Validates the full builder draft. Returns an object of field errors (empty = valid).
 */
export function validateBuilderDraft(draft, { buyingPower = null } = {}) {
  const errors = {}

  // Name
  if (!String(draft.name ?? '').trim()) {
    errors.name = 'Give your bot a name.'
  }

  // Symbols
  const symbols = parseSymbols(draft.symbolsText)
  if (symbols.length === 0) {
    errors.symbols = 'Add at least one symbol.'
  } else if (symbols.some((s) => !SYMBOL_RE.test(s))) {
    errors.symbols = 'Use ticker symbols like AAPL or BRK.B.'
  }

  // Capital
  const capitalNum = toNumberOrNull(draft.capital)
  if (capitalNum === null) {
    errors.capital = 'Enter a valid amount.'
  } else if (capitalNum <= 0) {
    errors.capital = 'Amount must be greater than $0.'
  } else if (capitalNum > MAX_CAPITAL) {
    errors.capital = 'Amount is too large.'
  } else if (buyingPower !== null && buyingPower !== undefined && capitalNum > buyingPower) {
    errors.capital = 'That’s more than the cash available in your account.'
  }

  // Max Per Order
  const maxOrderNum = toNumberOrNull(draft.maxPerOrder)
  if (maxOrderNum === null) {
    errors.maxPerOrder = 'Enter a valid amount.'
  } else if (maxOrderNum <= 0) {
    errors.maxPerOrder = 'Must be greater than $0.'
  } else if (capitalNum !== null && maxOrderNum > capitalNum) {
    errors.maxPerOrder = 'Can’t be more than the bot’s simulated capital.'
  }

  // Trigger
  if (draft.triggerType === 'price_threshold') {
    const p = toNumberOrNull(draft.trigger?.price)
    if (p === null || p <= 0) {
      errors.triggerPrice = 'Enter the price that should trigger an order.'
    }
  }

  // Research
  if (draft.triggerType === 'alpha_research' && draft.research) {
    const s = toNumberOrNull(draft.research.minScore)
    if (s === null || s < 0 || s > 100) errors.minScore = 'Use a score from 0 to 100.'

    const a = toNumberOrNull(draft.research.maxAgeHours)
    if (a === null || a < 1 || a > 720) errors.maxAgeHours = 'Use 1 to 720 hours.'

    const d = toNumberOrNull(draft.research.maxDriftPct)
    if (d === null || d < 0 || d > 50) errors.maxDriftPct = 'Use 0 to 50%.'
  }

  // Limits
  if (draft.cooldown.on) {
    const cd = toNumberOrNull(draft.cooldown.hours)
    if (cd === null || cd <= 0) errors.cooldown = 'Enter more than 0 hours.'
  }

  if (draft.positionLimit.on) {
    const pl = toNumberOrNull(draft.positionLimit.maxShares)
    if (pl === null || !Number.isInteger(pl) || pl <= 0) {
      errors.positionLimit = 'Enter a whole number of shares.'
    }
  }

  if (draft.dailyLoss.on) {
    const dl = toNumberOrNull(draft.dailyLoss.maxLoss)
    if (dl === null || dl <= 0) errors.dailyLoss = 'Enter an amount greater than $0.'
  }

  return errors
}

/**
 * Formats the full desired rules array for the transactional bot configuration API.
 * Preserves rule IDs, names, and enabled states from originalRules when editing.
 * Omitting a rule signals deletion on the backend.
 */
export function formatDesiredRules(draft, originalRules = []) {
  const orig = Array.isArray(originalRules) ? originalRules : []
  const rules = []
  const findPrev = (type) => orig.find((r) => r.type === type)

  // 1. Price trigger (price_threshold)
  if (draft.triggerType === 'price_threshold') {
    const op = draft.trigger?.operator || (draft.direction === 'sell' ? 'below' : 'above')
    const priceVal = toNumberOrNull(draft.trigger?.price) ?? 0
    const prev = findPrev('price_threshold')
    rules.push({
      ...(prev?.id ? { id: prev.id } : {}),
      name: prev?.name || (op === 'below' ? 'Price Below Threshold' : 'Price Above Threshold'),
      type: 'price_threshold',
      config: { operator: op, price: priceVal },
      enabled: prev?.enabled ?? true,
    })
  }

  // 2. Trend filter (trend_filter)
  if (draft.triggerType === 'trend_filter') {
    const prev = findPrev('trend_filter')
    rules.push({
      ...(prev?.id ? { id: prev.id } : {}),
      name: prev?.name || 'Trend Filter',
      type: 'trend_filter',
      config: prev?.config && typeof prev.config === 'object' ? prev.config : { symbol: 'SPY' },
      enabled: prev?.enabled ?? true,
    })
  }

  // 3. Market hours (market_hours)
  if (draft.marketHours?.on) {
    const prev = findPrev('market_hours')
    rules.push({
      ...(prev?.id ? { id: prev.id } : {}),
      name: prev?.name || 'Market Hours',
      type: 'market_hours',
      config: {
        allowPremarket: Boolean(draft.marketHours.extended),
        allowAfterHours: Boolean(draft.marketHours.extended),
      },
      enabled: prev?.enabled ?? true,
    })
  }

  // 4. Cooldown (cooldown)
  if (draft.cooldown?.on) {
    const h = toNumberOrNull(draft.cooldown.hours) ?? 24
    const prev = findPrev('cooldown')
    rules.push({
      ...(prev?.id ? { id: prev.id } : {}),
      name: prev?.name || 'Cooldown',
      type: 'cooldown',
      config: {
        windowMs: Math.round(h * HOUR),
      },
      enabled: prev?.enabled ?? true,
    })
  }

  // 5. Position limit (position_limit)
  if (draft.positionLimit?.on) {
    const shares = toNumberOrNull(draft.positionLimit.maxShares) ?? 100
    const prev = findPrev('position_limit')
    rules.push({
      ...(prev?.id ? { id: prev.id } : {}),
      name: prev?.name || 'Position Limit',
      type: 'position_limit',
      config: {
        maxShares: shares,
        maxQuantity: shares,
        ...(draft.positionLimit.maxPositions ? { maxPositions: draft.positionLimit.maxPositions } : {}),
      },
      enabled: prev?.enabled ?? true,
    })
  }

  // 6. Daily loss (daily_loss)
  if (draft.dailyLoss?.on) {
    const loss = toNumberOrNull(draft.dailyLoss.maxLoss) ?? 500
    const prev = findPrev('daily_loss')
    rules.push({
      ...(prev?.id ? { id: prev.id } : {}),
      name: prev?.name || 'Daily Loss Limit',
      type: 'daily_loss',
      config: {
        maxLoss: loss,
        ...(draft.dailyLoss.maxDailyLossPct ? { maxDailyLossPct: draft.dailyLoss.maxDailyLossPct } : {}),
      },
      enabled: prev?.enabled ?? true,
    })
  }

  // 7. Fixed rules (e.g. trend_filter, time_window, or unmanaged rule types)
  for (const f of draft.fixed || []) {
    if (!rules.some((r) => r.type === f.type)) {
      rules.push(f)
    }
  }

  return rules
}

/**
 * Builds the config patch for Bot.config.
 * When editing, sends only changed fields; server deep-merges with stored config.
 * When creating, sends the full configured core fields.
 */
export function buildConfigPatch(draft, baseConfig = {}) {
  const patch = {}
  const symbols = parseSymbols(draft.symbolsText)
  const capitalNum = toNumberOrNull(draft.capital)
  const maxOrderNum = toNumberOrNull(draft.maxPerOrder)
  const isEdit = Boolean(draft.isEdit)

  if (isEdit) {
    const baseTickers = Array.isArray(baseConfig.tickers) ? baseConfig.tickers : []
    const tickersChanged = symbols.length !== baseTickers.length || symbols.some((s, i) => s !== baseTickers[i])
    if (tickersChanged) {
      patch.tickers = symbols
    }

    if (draft.direction && draft.direction !== baseConfig.direction) {
      patch.direction = draft.direction
    }

    if (capitalNum !== null && capitalNum !== baseConfig.allocatedAmount) {
      patch.allocatedAmount = capitalNum
    }

    if (maxOrderNum !== null && maxOrderNum !== baseConfig.maxOrderNotional) {
      patch.maxOrderNotional = maxOrderNum
    }

    const isResearch = draft.triggerType === 'alpha_research'
    const wasResearch = baseConfig.signalSource === 'alpha_research'
    if (isResearch !== wasResearch) {
      patch.signalSource = isResearch ? 'alpha_research' : null
    }

    if (isResearch && draft.research) {
      const baseRes = baseConfig.research || {}
      const rPatch = {}
      const minConf = (toNumberOrNull(draft.research.minScore) ?? 60) / 100
      if (minConf !== baseRes.minConfidence) rPatch.minConfidence = minConf

      const maxAge = toNumberOrNull(draft.research.maxAgeHours) ?? 96
      if (maxAge !== baseRes.maxPredictionAgeHours) rPatch.maxPredictionAgeHours = maxAge

      const maxDrift = toNumberOrNull(draft.research.maxDriftPct) ?? 5
      if (maxDrift !== baseRes.maxEntryDriftPct) rPatch.maxEntryDriftPct = maxDrift

      const reqEdge = draft.research.requireEdge !== false
      if (reqEdge !== (baseRes.requireEdgeOverBaseline ?? true)) rPatch.requireEdgeOverBaseline = reqEdge

      if (Object.keys(rPatch).length > 0) {
        patch.research = rPatch
      }
    }
  } else {
    // Create mode: send complete configured core values
    patch.tickers = symbols
    patch.direction = draft.direction || 'buy'
    if (capitalNum !== null) patch.allocatedAmount = capitalNum
    if (maxOrderNum !== null) patch.maxOrderNotional = maxOrderNum

    if (draft.triggerType === 'alpha_research' && draft.research) {
      patch.signalSource = 'alpha_research'
      patch.research = {
        minConfidence: (toNumberOrNull(draft.research.minScore) ?? 60) / 100,
        maxPredictionAgeHours: toNumberOrNull(draft.research.maxAgeHours) ?? 96,
        maxEntryDriftPct: toNumberOrNull(draft.research.maxDriftPct) ?? 5,
        requireEdgeOverBaseline: draft.research.requireEdge !== false,
      }
    }
  }

  return patch
}

/**
 * Reconstructs the complete bot object { name, tickers, direction, config, rules }
 * from the builder draft for live strategy summary and client-side rendering.
 */
export function buildBotFromDraft(draft, original = {}) {
  const origConfig = original.config && typeof original.config === 'object' ? original.config : {}
  const origRules = Array.isArray(original.rules) ? original.rules : []
  const symbols = parseSymbols(draft.symbolsText)
  const capitalNum = toNumberOrNull(draft.capital)
  const maxOrderNum = toNumberOrNull(draft.maxPerOrder)

  const rules = formatDesiredRules(draft, origRules)

  // Base config preservation for client-side preview
  const nextConfig = {
    ...origConfig,
    tickers: symbols,
    direction: draft.direction,
    capitalMode: origConfig.capitalMode ?? 'allocated',
    allocatedAmount: capitalNum,
    maxOrderNotional: maxOrderNum,
    riskOnExposure: origConfig.riskOnExposure ?? 1,
  }

  if (origConfig.quantity !== undefined) nextConfig.quantity = origConfig.quantity
  if (origConfig.riskLimits !== undefined) nextConfig.riskLimits = origConfig.riskLimits
  if (origConfig.positionSizing !== undefined) nextConfig.positionSizing = origConfig.positionSizing
  if (origConfig.timezone !== undefined) nextConfig.timezone = origConfig.timezone
  if (origConfig.requiredRegime !== undefined) nextConfig.requiredRegime = origConfig.requiredRegime
  if (origConfig.maxSnapshotAgeHours !== undefined) nextConfig.maxSnapshotAgeHours = origConfig.maxSnapshotAgeHours
  if (origConfig.preferences !== undefined) nextConfig.preferences = origConfig.preferences

  if (draft.triggerType === 'alpha_research') {
    nextConfig.signalSource = 'alpha_research'
    if (draft.research) {
      nextConfig.research = {
        ...(origConfig.research ?? draft.research.base ?? {}),
        minConfidence: (toNumberOrNull(draft.research.minScore) ?? 60) / 100,
        maxPredictionAgeHours: toNumberOrNull(draft.research.maxAgeHours) ?? 96,
        maxEntryDriftPct: toNumberOrNull(draft.research.maxDriftPct) ?? 5,
        requireEdgeOverBaseline: draft.research.requireEdge !== false,
      }
    }
  } else {
    if (nextConfig.signalSource === 'alpha_research') {
      delete nextConfig.signalSource
    }
  }

  return {
    name: draft.name.trim(),
    tickers: symbols,
    direction: draft.direction,
    allocation: capitalNum,
    maxPerOrder: maxOrderNum,
    config: nextConfig,
    rules,
  }
}

/**
 * Maps server error responses from POST/PUT /api/bots/.../configuration to:
 *  - field errors (INVALID_CONFIG, INVALID_RULE)
 *  - concurrency conflict indicator (STALE_BOT)
 *  - human-readable message for the banner
 */
export function mapServerValidationError(error, rulesSent = []) {
  const details = error?.details || {}
  const code = error?.code || details.code
  const message = error?.serverMessage || details.message || error?.message || 'Validation failed.'

  if (code === 'STALE_BOT') {
    return {
      stale: true,
      currentUpdatedAt: details.updatedAt || null,
      message: 'This bot was updated in another window. You can overwrite with your current settings or reload the latest bot.',
      fieldErrors: {},
    }
  }

  if (code === 'EMERGENCY_STOP_ACTIVE') {
    return {
      stale: false,
      message: 'Emergency stop is active. Save the bot paused or clear the stop first.',
      fieldErrors: {},
    }
  }

  const fieldErrors = {}

  if (code === 'INVALID_CONFIG') {
    const f = details.field
    if (f === 'tickers') fieldErrors.symbols = message
    else if (f === 'allocatedAmount') fieldErrors.capital = message
    else if (f === 'maxOrderNotional') fieldErrors.maxPerOrder = message
    else if (f === 'name') fieldErrors.name = message
    else if (f === 'direction') fieldErrors.direction = message
    else if (f === 'research') fieldErrors.minScore = message
    return { stale: false, fieldErrors, message }
  }

  if (code === 'INVALID_RULE') {
    const ruleType = details.type || (details.ruleIndex !== undefined && rulesSent[details.ruleIndex]?.type)
    if (ruleType === 'price_threshold') fieldErrors.triggerPrice = message
    else if (ruleType === 'cooldown') fieldErrors.cooldown = message
    else if (ruleType === 'position_limit') fieldErrors.positionLimit = message
    else if (ruleType === 'daily_loss') fieldErrors.dailyLoss = message
    return { stale: false, fieldErrors, message }
  }

  return { stale: false, fieldErrors, message }
}

/**
 * Creates a bot and its rules in one atomic transaction.
 * POST /api/bots/configuration
 */
export async function createBotConfiguration({
  portfolioId,
  templateId,
  draft,
  originalTemplate = {},
  api,
}) {
  const patch = buildConfigPatch(draft, originalTemplate?.config || {})
  const rules = formatDesiredRules(draft, originalTemplate?.rules || [])

  const payload = {
    portfolioId,
    ...(templateId ? { templateId } : {}),
    name: draft.name.trim(),
    enabled: true,
    config: patch,
    rules,
  }

  return await api.post('/bots/configuration', payload)
}

/**
 * Updates an existing bot and its rules in one atomic transaction.
 * PUT /api/bots/:id/configuration
 */
export async function updateBotConfiguration({
  bot,
  draft,
  api,
  expectedUpdatedAt,
  overwrite = false,
}) {
  const patch = buildConfigPatch(draft, bot.config || {})
  const rules = formatDesiredRules(draft, bot.rules || [])

  const effectiveUpdatedAt = overwrite
    ? undefined
    : expectedUpdatedAt !== undefined
      ? expectedUpdatedAt
      : draft.updatedAt || undefined

  const payload = {
    ...(effectiveUpdatedAt ? { expectedUpdatedAt: effectiveUpdatedAt } : {}),
    name: draft.name.trim(),
    config: patch,
    rules,
  }

  return await api.put(`/bots/${bot.id}/configuration`, payload)
}

/**
 * Canonical unified save: wraps updateBotConfiguration for backward compatibility.
 */
export async function saveBotAlgorithm({ bot, builtBot, draft, api, expectedUpdatedAt, overwrite = false }) {
  try {
    const updated = await updateBotConfiguration({
      bot,
      draft: draft || {
        ...builtBot,
        isEdit: true,
        updatedAt: expectedUpdatedAt || bot.updatedAt,
        symbolsText: (builtBot.tickers || []).join(', '),
        capital: String(builtBot.config?.allocatedAmount ?? ''),
        maxPerOrder: String(builtBot.config?.maxOrderNotional ?? ''),
        marketHours: { on: Boolean(builtBot.rules?.find((r) => r.type === 'market_hours')) },
        cooldown: { on: Boolean(builtBot.rules?.find((r) => r.type === 'cooldown')) },
        positionLimit: { on: Boolean(builtBot.rules?.find((r) => r.type === 'position_limit')) },
        dailyLoss: { on: Boolean(builtBot.rules?.find((r) => r.type === 'daily_loss')) },
        triggerType: builtBot.rules?.find((r) => r.type === 'price_threshold') ? 'price_threshold' : 'schedule',
      },
      api,
      expectedUpdatedAt,
      overwrite,
    })
    return { ok: true, bot: updated }
  } catch (error) {
    const mapped = mapServerValidationError(error)
    return {
      ok: false,
      error: mapped.message,
      stale: mapped.stale,
      fieldErrors: mapped.fieldErrors,
      details: error.details,
    }
  }
}
