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
 * Reconstructs the complete bot object { name, tickers, direction, config, rules }
 * from the builder draft, preserving existing rule IDs and unedited config fields.
 */
export function buildBotFromDraft(draft, original = {}) {
  const origConfig = original.config && typeof original.config === 'object' ? original.config : {}
  const origRules = Array.isArray(original.rules) ? original.rules : []
  const symbols = parseSymbols(draft.symbolsText)
  const capitalNum = toNumberOrNull(draft.capital)
  const maxOrderNum = toNumberOrNull(draft.maxPerOrder)

  const keep = (type, name, cfg) => {
    const prev = origRules.find((r) => r.type === type)
    return {
      ...(prev?.id ? { id: prev.id } : {}),
      name: prev?.name ?? name,
      type,
      config: { ...(prev?.config ?? {}), ...cfg },
      ...(prev?.enabled !== undefined ? { enabled: prev.enabled } : {}),
    }
  }

  const rules = []

  // 1. Trigger rule (price_threshold)
  if (draft.triggerType === 'price_threshold') {
    const op = draft.trigger?.operator || (draft.direction === 'sell' ? 'below' : 'above')
    const priceVal = toNumberOrNull(draft.trigger?.price) ?? 0
    rules.push(
      keep('price_threshold', op === 'below' ? 'Price Below Threshold' : 'Price Above Threshold', {
        operator: op,
        direction: op,
        price: priceVal,
      })
    )
  }

  // 2. Market hours (market_hours)
  if (draft.marketHours.on) {
    rules.push(
      keep('market_hours', 'Market Hours', {
        allowPremarket: draft.marketHours.extended,
        allowAfterHours: draft.marketHours.extended,
      })
    )
  }

  // 3. Cooldown (cooldown)
  if (draft.cooldown.on) {
    const h = toNumberOrNull(draft.cooldown.hours) ?? 24
    rules.push(
      keep('cooldown', 'Cooldown', {
        windowMs: Math.round(h * HOUR),
        cooldownHours: undefined,
        minutes: undefined,
      })
    )
  }

  // 4. Position limit (position_limit)
  if (draft.positionLimit.on) {
    const shares = toNumberOrNull(draft.positionLimit.maxShares) ?? 100
    rules.push(
      keep('position_limit', 'Position Limit', {
        maxShares: shares,
        maxQuantity: shares,
        ...(draft.positionLimit.maxPositions ? { maxPositions: draft.positionLimit.maxPositions } : {}),
      })
    )
  }

  // 5. Daily loss (daily_loss)
  if (draft.dailyLoss.on) {
    const loss = toNumberOrNull(draft.dailyLoss.maxLoss) ?? 500
    rules.push(
      keep('daily_loss', 'Daily Loss Limit', {
        maxLoss: loss,
        ...(draft.dailyLoss.maxDailyLossPct ? { maxDailyLossPct: draft.dailyLoss.maxDailyLossPct } : {}),
      })
    )
  }

  // 6. Fixed rules (trend_filter, time_window, and any unmanaged rule types)
  for (const f of draft.fixed || []) {
    rules.push(f)
  }

  // Remove undefined config values while keeping null or false values
  for (const r of rules) {
    for (const k of Object.keys(r.config)) {
      if (r.config[k] === undefined) delete r.config[k]
    }
  }

  // Base config preservation — wholesale replacement on backend requires
  // preserving every engine-supported property not explicitly edited.
  const nextConfig = {
    ...origConfig,
    tickers: symbols,
    direction: draft.direction,
    capitalMode: origConfig.capitalMode ?? 'allocated',
    allocatedAmount: capitalNum,
    maxOrderNotional: maxOrderNum,
    riskOnExposure: origConfig.riskOnExposure ?? 1,
  }

  // If quantity was configured on the original bot, preserve it
  if (origConfig.quantity !== undefined) {
    nextConfig.quantity = origConfig.quantity
  }

  // If engine risk limits, position sizing, timezone, regime, etc. were present, preserve them
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
 * Saves an existing bot algorithm (PUT /bots/:id for name/config, diffs /bots/:id/rules).
 * Handles partial save failures explicitly: if bot config is saved but a rule
 * operation fails, returns { ok: false, partial: true, error: ... } so success
 * is never falsely reported.
 */
export async function saveBotAlgorithm({ bot, builtBot, api }) {
  let botConfigSaved = false
  try {
    // 1. Update bot name and config wholesale (preserving all untouched engine properties)
    await api.put(`/bots/${bot.id}`, {
      name: builtBot.name,
      config: builtBot.config,
    })
    botConfigSaved = true

    // 2. Diff and update rules
    const wanted = new Map(
      builtBot.rules
        .filter((r) => r.type !== 'trend_filter' && r.type !== 'time_window')
        .map((r) => [r.type, r])
    )

    for (const prev of bot.rules ?? []) {
      if (prev.type === 'trend_filter' || prev.type === 'time_window') continue
      const next = wanted.get(prev.type)
      if (!next) {
        await api.del(`/bots/${bot.id}/rules/${prev.id}`)
      } else if (JSON.stringify(next.config) !== JSON.stringify(prev.config)) {
        await api.put(`/bots/${bot.id}/rules/${prev.id}`, { config: next.config })
      }
      wanted.delete(prev.type)
    }

    for (const r of wanted.values()) {
      await api.post(`/bots/${bot.id}/rules`, { name: r.name, type: r.type, config: r.config })
    }

    return { ok: true }
  } catch (error) {
    if (botConfigSaved) {
      const detail = error?.serverMessage || error?.message || 'rule update error'
      return {
        ok: false,
        partial: true,
        error: `Your bot settings were saved, but some rule changes couldn’t be applied (${detail}). Reload the page to review current rules.`,
      }
    }
    return {
      ok: false,
      partial: false,
      error: error?.serverMessage || error?.message || 'Couldn’t save changes. Reload to check current settings.',
    }
  }
}
