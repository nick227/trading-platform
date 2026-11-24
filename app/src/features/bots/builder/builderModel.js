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
} from './builderData'

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
  } else if (priceRule && priceRule.enabled !== false) {
    triggerType = 'price_threshold'
  } else if (trendRule && trendRule.enabled !== false) {
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
    // Research bots follow both BUY and SELL research unless a direction is set explicitly.
    direction: isResearch ? (config.direction === 'buy' || config.direction === 'sell' ? config.direction : null) : (config.direction === 'sell' ? 'sell' : 'buy'),
    initialTriggerType: triggerType,
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
      on: Boolean(hours && hours.enabled !== false),
      extended: Boolean(hours?.config?.allowPremarket || hours?.config?.allowAfterHours),
    },
    cooldown: {
      on: Boolean(cd && cd.enabled !== false),
      hours: cd ? cooldownHours(cd.config) : '24',
    },
    ...marketConditionDrafts(rules),
    positionLimit: {
      on: Boolean(pos && pos.enabled !== false),
      maxShares: String(pos?.config?.maxShares ?? pos?.config?.maxQuantity ?? 100),
      maxPositions: pos?.config?.maxPositions ?? null,
    },
    dailyLoss: {
      on: Boolean(loss && loss.enabled !== false),
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
  } else if (priceRule && priceRule.enabled !== false) {
    triggerType = 'price_threshold'
  } else if (trendRule && trendRule.enabled !== false) {
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
    direction: isResearch
      ? (config.direction === 'buy' || config.direction === 'sell' ? config.direction : null)
      : (config.direction || bot.direction || 'buy'),
    initialDirection: isResearch
      ? (config.direction === 'buy' || config.direction === 'sell' ? config.direction : null)
      : (config.direction || bot.direction || 'buy'),
    initialTriggerType: triggerType,
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
      on: Boolean(hours && hours.enabled !== false),
      extended: Boolean(hours?.config?.allowPremarket || hours?.config?.allowAfterHours),
    },
    cooldown: {
      on: Boolean(cd && cd.enabled !== false),
      hours: cd ? cooldownHours(cd.config) : '24',
    },
    ...marketConditionDrafts(rules),
    positionLimit: {
      on: Boolean(pos && pos.enabled !== false),
      maxShares: String(pos?.config?.maxShares ?? pos?.config?.maxQuantity ?? 100),
      maxPositions: pos?.config?.maxPositions ?? null,
    },
    dailyLoss: {
      on: Boolean(loss && loss.enabled !== false),
      maxLoss: String(loss?.config?.maxLoss ?? 500),
      maxDailyLossPct: loss?.config?.maxDailyLossPct ?? null,
    },
    fixed: rules.filter((x) => x.type === 'trend_filter' || x.type === 'time_window'),
  }
}

const EDITABLE_FIELDS = ['name', 'symbolsText', 'direction', 'capital', 'maxPerOrder', 'triggerType', 'trigger', 'research', 'marketHours', 'cooldown', 'positionLimit', 'dailyLoss', 'relVolume', 'priceChange', 'removedRuleIds', 'removedRuleTypes']
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * After a 409 STALE_BOT: rebuild the draft on the latest bot, re-applying only the fields the
 * user changed since loading (three-way: loaded → user draft vs loaded → latest). Changes made
 * elsewhere to fields the user didn't touch are kept; nothing is blindly overwritten.
 */
export function rebaseDraft(loadedDraft, userDraft, latestDraft) {
  const out = { ...latestDraft }
  for (const k of EDITABLE_FIELDS) {
    const strip = (v) => (k === 'research' && v ? { ...v, base: undefined } : v)
    if (!same(strip(userDraft[k]), strip(loadedDraft[k]))) out[k] = userDraft[k]
  }
  return out
}

/**
 * Validates the full builder draft. Returns an object of field errors (empty = valid).
 */
export function validateBuilderDraft(draft, { buyingPower = null, tradableSymbols = null } = {}) {
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
  } else if (tradableSymbols) {
    const outside = symbols.filter((s) => !tradableSymbols.includes(s))
    if (outside.length) errors.symbols = `${outside.join(', ')} ${outside.length === 1 ? 'isn’t' : 'aren’t'} available in paper trading. Choose from ${tradableSymbols.join(', ')}.`
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

  // Market-aware conditions
  if (draft.relVolume?.on) {
    const r = toNumberOrNull(draft.relVolume.minRatio)
    if (r === null || r <= 0 || r > 10) errors.relVolume = 'Use a multiple between 0 and 10.'
  }
  if (draft.priceChange?.on) {
    const n = toNumberOrNull(draft.priceChange.sessions)
    const p = toNumberOrNull(draft.priceChange.pct)
    if (n === null || !Number.isInteger(n) || n < 1 || n > 60) errors.priceChange = 'Look back 1–60 sessions.'
    else if (p === null || p <= 0 || p > 100) errors.priceChange = 'Use a change between 0% and 100%.'
  }

  return errors
}

const MANAGED_RULES = new Set(['price_threshold', 'trend_filter', 'market_hours', 'cooldown', 'position_limit', 'daily_loss', 'relative_volume', 'price_change'])
/** Draft fields for the market-aware conditions (relative volume, price change). */
function marketConditionDrafts(rules) {
  const rv = findRule(rules, 'relative_volume')
  const pc = findRule(rules, 'price_change')
  return {
    relVolume: { on: Boolean(rv && rv.enabled !== false), minRatio: String(rv?.config?.minRatio ?? 1.5) },
    priceChange: {
      on: Boolean(pc && pc.enabled !== false),
      sessions: String(pc?.config?.sessions ?? 5),
      operator: pc?.config?.operator === 'below' ? 'below' : 'above',
      pct: String(pc?.config?.pct ?? 3),
    },
  }
}

const omit = (o, keys) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !keys.includes(k)))

/**
 * Applies the builder's edits to one stored rule without touching anything the user didn't
 * change: same config object when the shown fields are unchanged, else the stored config with
 * only the edited fields replaced. `enabled` changes only when the user toggled it.
 */
export function applyDraftToRule(prev, draft) {
  const c = prev.config && typeof prev.config === 'object' ? prev.config : {}
  const wasOn = prev.enabled !== false
  const toggled = (on, initialOn) => (on === initialOn ? (prev.enabled ?? true) : on)
  const triggerChanged = draft.triggerType !== (draft.initialTriggerType ?? draft.triggerType)

  switch (prev.type) {
    case 'price_threshold': {
      const op0 = c.operator ?? c.direction ?? (draft.direction === 'sell' ? 'below' : 'above')
      const price0 = Number(c.price) > 0 ? String(c.price) : ''
      const op = draft.trigger?.operator || op0
      const price = String(draft.trigger?.price ?? '')
      const edited = op !== op0 || (price !== price0 && toNumberOrNull(price) !== Number(c.price))
      const isTrigger = draft.triggerType === 'price_threshold'
      return {
        config: edited && toNumberOrNull(price) !== null
          ? { ...c, operator: op, price: toNumberOrNull(price), ...('direction' in c ? { direction: op } : {}) }
          : c,
        enabled: triggerChanged ? isTrigger : (prev.enabled ?? true),
      }
    }
    case 'trend_filter':
      return { config: c, enabled: triggerChanged ? draft.triggerType === 'trend_filter' : (prev.enabled ?? true) }
    case 'market_hours': {
      const ext0 = Boolean(c.allowPremarket || c.allowAfterHours)
      const ext = Boolean(draft.marketHours?.extended)
      return {
        config: ext !== ext0 ? { ...c, allowPremarket: ext, allowAfterHours: ext } : c,
        enabled: toggled(Boolean(draft.marketHours?.on), wasOn),
      }
    }
    case 'cooldown': {
      const h = toNumberOrNull(draft.cooldown?.hours)
      const edited = String(draft.cooldown?.hours ?? '') !== cooldownHours(c) && h !== null && h > 0
      return {
        config: edited ? { ...omit(c, ['windowMs', 'cooldownHours', 'minutes']), windowMs: Math.round(h * HOUR) } : c,
        enabled: toggled(Boolean(draft.cooldown?.on), wasOn),
      }
    }
    case 'position_limit': {
      const n = toNumberOrNull(draft.positionLimit?.maxShares)
      const edited = String(draft.positionLimit?.maxShares ?? '') !== String(c.maxShares ?? c.maxQuantity ?? 100) && n !== null && n > 0
      return {
        config: edited ? { ...c, maxShares: n, ...('maxQuantity' in c ? { maxQuantity: n } : {}) } : c,
        enabled: toggled(Boolean(draft.positionLimit?.on), wasOn),
      }
    }
    case 'daily_loss': {
      const n = toNumberOrNull(draft.dailyLoss?.maxLoss)
      const edited = String(draft.dailyLoss?.maxLoss ?? '') !== String(c.maxLoss ?? 500) && n !== null && n > 0
      return {
        config: edited ? { ...c, maxLoss: n } : c,
        enabled: toggled(Boolean(draft.dailyLoss?.on), wasOn),
      }
    }
    case 'relative_volume': {
      const r = toNumberOrNull(draft.relVolume?.minRatio)
      const edited = r !== null && r > 0 && r !== Number(c.minRatio)
      return { config: edited ? { ...c, minRatio: r } : c, enabled: toggled(Boolean(draft.relVolume?.on), wasOn) }
    }
    case 'price_change': {
      const n = toNumberOrNull(draft.priceChange?.sessions)
      const p = toNumberOrNull(draft.priceChange?.pct)
      const op = draft.priceChange?.operator === 'below' ? 'below' : 'above'
      const edited = (n !== null && n !== Number(c.sessions)) || (p !== null && p !== Number(c.pct)) || op !== (c.operator ?? 'above')
      return {
        config: edited && n !== null && p !== null ? { ...c, sessions: Math.round(n), pct: p, operator: op } : c,
        enabled: toggled(Boolean(draft.priceChange?.on), wasOn),
      }
    }
    default:
      return { config: c, enabled: prev.enabled ?? true }
  }
}

/**
 * Formats the full desired rules array for the transactional bot configuration API.
 * Preserves rule IDs, names, configurations, and exact order from originalRules.
 * A disabled rule remains persisted with enabled: false.
 * Only an explicitly removed rule (in draft.removedRuleIds or draft.removedRuleTypes) is omitted and deleted.
 */
export function formatDesiredRules(draft, originalRules = []) {
  const orig = Array.isArray(originalRules) ? originalRules : []
  const rules = []
  const seenTypes = new Set()

  const removedIds = draft.removedRuleIds instanceof Set
    ? draft.removedRuleIds
    : new Set(Array.isArray(draft.removedRuleIds) ? draft.removedRuleIds : [])
  const removedTypes = draft.removedRuleTypes instanceof Set
    ? draft.removedRuleTypes
    : new Set(Array.isArray(draft.removedRuleTypes) ? draft.removedRuleTypes : [])

  // 1. Existing rules, in order. Only the first rule of each managed type is shown in the
  //    builder; its config changes only for fields the user actually edited (merged into the
  //    stored config), and its enabled flag only when toggled. Every other rule — extra rules
  //    of the same type, time windows, unknown types — is passed through untouched.
  const primary = new Set()
  for (const prev of orig) {
    if (!prev || !prev.type) continue
    if (prev.id && removedIds.has(prev.id)) continue
    if (removedTypes.has(prev.type)) continue
    seenTypes.add(prev.type)
    const isPrimary = MANAGED_RULES.has(prev.type) && !primary.has(prev.type)
    if (isPrimary) primary.add(prev.type)
    const next = isPrimary ? applyDraftToRule(prev, draft) : { config: prev.config ?? {}, enabled: prev.enabled ?? true }
    rules.push({
      ...(prev.id ? { id: prev.id } : {}),
      ...(prev.name ? { name: prev.name } : {}),
      type: prev.type,
      config: next.config,
      enabled: next.enabled,
    })
  }

  // 2. Append newly activated rules that were not in originalRules
  if (draft.triggerType === 'price_threshold' && !seenTypes.has('price_threshold')) {
    const op = draft.trigger?.operator || (draft.direction === 'sell' ? 'below' : 'above')
    const priceVal = toNumberOrNull(draft.trigger?.price) ?? 0
    rules.push({
      name: op === 'below' ? 'Price Below Threshold' : 'Price Above Threshold',
      type: 'price_threshold',
      config: { operator: op, price: priceVal },
      enabled: true,
    })
    seenTypes.add('price_threshold')
  }

  if (draft.triggerType === 'trend_filter' && !seenTypes.has('trend_filter')) {
    rules.push({
      name: 'Trend Filter',
      type: 'trend_filter',
      config: { symbol: 'SPY' },
      enabled: true,
    })
    seenTypes.add('trend_filter')
  }

  if (draft.marketHours?.on && !seenTypes.has('market_hours')) {
    rules.push({
      name: 'Market Hours',
      type: 'market_hours',
      config: {
        allowPremarket: Boolean(draft.marketHours?.extended),
        allowAfterHours: Boolean(draft.marketHours?.extended),
      },
      enabled: true,
    })
    seenTypes.add('market_hours')
  }

  if (draft.cooldown?.on && !seenTypes.has('cooldown')) {
    const h = toNumberOrNull(draft.cooldown?.hours) ?? 24
    rules.push({
      name: 'Cooldown',
      type: 'cooldown',
      config: { windowMs: Math.round(h * HOUR) },
      enabled: true,
    })
    seenTypes.add('cooldown')
  }

  if (draft.positionLimit?.on && !seenTypes.has('position_limit')) {
    const shares = toNumberOrNull(draft.positionLimit?.maxShares) ?? 100
    rules.push({
      name: 'Position Limit',
      type: 'position_limit',
      config: {
        maxShares: shares,
        maxQuantity: shares,
        ...(draft.positionLimit?.maxPositions ? { maxPositions: draft.positionLimit.maxPositions } : {}),
      },
      enabled: true,
    })
    seenTypes.add('position_limit')
  }

  if (draft.dailyLoss?.on && !seenTypes.has('daily_loss')) {
    const loss = toNumberOrNull(draft.dailyLoss?.maxLoss) ?? 500
    rules.push({
      name: 'Daily Loss Limit',
      type: 'daily_loss',
      config: {
        maxLoss: loss,
        ...(draft.dailyLoss?.maxDailyLossPct ? { maxDailyLossPct: draft.dailyLoss.maxDailyLossPct } : {}),
      },
      enabled: true,
    })
    seenTypes.add('daily_loss')
  }

  if (draft.relVolume?.on && !seenTypes.has('relative_volume')) {
    rules.push({ name: 'Relative Volume', type: 'relative_volume', config: { minRatio: toNumberOrNull(draft.relVolume?.minRatio) ?? 1.5 }, enabled: true })
    seenTypes.add('relative_volume')
  }

  if (draft.priceChange?.on && !seenTypes.has('price_change')) {
    rules.push({
      name: 'Price Change', type: 'price_change',
      config: { sessions: Math.round(toNumberOrNull(draft.priceChange?.sessions) ?? 5), operator: draft.priceChange?.operator === 'below' ? 'below' : 'above', pct: toNumberOrNull(draft.priceChange?.pct) ?? 3 },
      enabled: true,
    })
    seenTypes.add('price_change')
  }

  // Include any extra fixed rules from draft.fixed not already seen
  for (const f of draft.fixed || []) {
    if (f && f.type && !seenTypes.has(f.type)) {
      if (f.id && removedIds.has(f.id)) continue
      if (removedTypes.has(f.type)) continue
      rules.push(f)
      seenTypes.add(f.type)
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

    // Only when the user changed it: an absent direction is meaningful (research bots follow
    // both BUY and SELL research; rule bots infer the side), so never write a default.
    const wantDirection = draft.triggerType !== 'alpha_research' && !draft.direction ? 'buy' : (draft.direction ?? null)
    if (wantDirection !== (draft.initialDirection ?? null)) {
      patch.direction = wantDirection
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
      // Write a research field only when the user changed what was shown for it; absent fields
      // keep the engine's defaults.
      const baseRes = baseConfig.research || {}
      const shown = {
        minScore: String(Math.round(Number(baseRes.minConfidence ?? 0.6) * 100)),
        maxAgeHours: String(baseRes.maxPredictionAgeHours ?? 96),
        maxDriftPct: String(baseRes.maxEntryDriftPct ?? 5),
        requireEdge: baseRes.requireEdgeOverBaseline !== false,
      }
      const rPatch = {}
      if (String(draft.research.minScore) !== shown.minScore) rPatch.minConfidence = (toNumberOrNull(draft.research.minScore) ?? 60) / 100
      if (String(draft.research.maxAgeHours) !== shown.maxAgeHours) rPatch.maxPredictionAgeHours = toNumberOrNull(draft.research.maxAgeHours) ?? 96
      if (String(draft.research.maxDriftPct) !== shown.maxDriftPct) rPatch.maxEntryDriftPct = toNumberOrNull(draft.research.maxDriftPct) ?? 5
      // requireEdgeOverBaseline is locked on server-side in the beta; never sent.

      if (Object.keys(rPatch).length > 0) {
        patch.research = rPatch
      }
    }
  } else {
    // Create mode: send complete configured core values
    patch.tickers = symbols
    const direction = draft.triggerType === 'alpha_research' ? draft.direction : (draft.direction || 'buy')
    if (direction) patch.direction = direction
    if (capitalNum !== null) patch.allocatedAmount = capitalNum
    if (maxOrderNum !== null) patch.maxOrderNotional = maxOrderNum

    if (draft.triggerType === 'alpha_research' && draft.research) {
      patch.signalSource = 'alpha_research'
      patch.research = {
        minConfidence: (toNumberOrNull(draft.research.minScore) ?? 60) / 100,
        maxPredictionAgeHours: toNumberOrNull(draft.research.maxAgeHours) ?? 96,
        maxEntryDriftPct: toNumberOrNull(draft.research.maxDriftPct) ?? 5,
        requireEdgeOverBaseline: true, // locked on in the beta
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
    capitalMode: origConfig.capitalMode ?? 'allocated',
    allocatedAmount: capitalNum,
    maxOrderNotional: maxOrderNum,
    riskOnExposure: origConfig.riskOnExposure ?? 1,
  }

  if (draft.direction) nextConfig.direction = draft.direction
  else if (draft.triggerType === 'alpha_research') delete nextConfig.direction
  else nextConfig.direction = 'buy'
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
        requireEdgeOverBaseline: true, // locked on in the beta
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
      message: 'This bot changed since you opened it. Load the latest version — your edits are kept — then save again.',
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
}) {
  const patch = buildConfigPatch(draft, bot.config || {})
  const rules = formatDesiredRules(draft, bot.rules || [])

  const effectiveUpdatedAt = expectedUpdatedAt !== undefined
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
export async function saveBotAlgorithm({ bot, builtBot, draft, api, expectedUpdatedAt }) {
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
        marketHours: { on: Boolean(builtBot.rules?.find((r) => r.type === 'market_hours' && r.enabled !== false)) },
        cooldown: { on: Boolean(builtBot.rules?.find((r) => r.type === 'cooldown' && r.enabled !== false)) },
        positionLimit: { on: Boolean(builtBot.rules?.find((r) => r.type === 'position_limit' && r.enabled !== false)) },
        dailyLoss: { on: Boolean(builtBot.rules?.find((r) => r.type === 'daily_loss' && r.enabled !== false)) },
        triggerType: builtBot.rules?.find((r) => r.type === 'price_threshold' && r.enabled !== false) ? 'price_threshold' : 'schedule',
      },
      api,
      expectedUpdatedAt,
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
