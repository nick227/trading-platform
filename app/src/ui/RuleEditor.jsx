/**
 * Rule editor shared by bot creation and bot detail. A bot is a direction (or a research
 * signal) plus an AND-list of rules the engine checks on every evaluation. Starting points
 * preload these values; users can change every one of them and add or remove limits.
 *
 *   draftFromBot({ config, rules })  → draft
 *   validateDraft(draft)             → { field: message }
 *   draftToBot(draft, { config, rules }) → { config, rules }  (rules keep their ids)
 */
import { isResearchBot } from './describeBot'

const HOUR = 3_600_000
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v))
const find = (rules, type) => (rules ?? []).find((r) => r.type === type) ?? null

function cooldownHours(c) {
  const ms = Number(c?.windowMs ?? (c?.cooldownHours ? c.cooldownHours * HOUR : c?.minutes ? c.minutes * 60_000 : NaN))
  return Number.isFinite(ms) ? String(Math.round((ms / HOUR) * 100) / 100) : '24'
}

export function draftFromBot({ config = {}, rules = [] } = {}) {
  const price = find(rules, 'price_threshold')
  const hours = find(rules, 'market_hours')
  const cd = find(rules, 'cooldown')
  const pos = find(rules, 'position_limit')
  const loss = find(rules, 'daily_loss')
  const r = config.research ?? {}
  return {
    trigger: price ? { operator: price.config?.operator ?? price.config?.direction ?? (config.direction === 'sell' ? 'below' : 'above'), price: Number(price.config?.price) > 0 ? String(price.config.price) : '' } : null,
    research: isResearchBot(config) ? {
      minScore: String(Math.round(Number(r.minConfidence ?? 0.6) * 100)),
      maxAgeHours: String(r.maxPredictionAgeHours ?? 96),
      maxDriftPct: String(r.maxEntryDriftPct ?? 5),
      requireEdge: r.requireEdgeOverBaseline !== false,
    } : null,
    marketHours: { on: Boolean(hours), extended: Boolean(hours?.config?.allowPremarket || hours?.config?.allowAfterHours) },
    cooldown: { on: Boolean(cd), hours: cooldownHours(cd?.config) },
    positionLimit: { on: Boolean(pos), maxShares: String(pos?.config?.maxShares ?? pos?.config?.maxQuantity ?? 100), maxPositions: pos?.config?.maxPositions ?? null },
    dailyLoss: { on: Boolean(loss), maxLoss: String(loss?.config?.maxLoss ?? 500), maxDailyLossPct: loss?.config?.maxDailyLossPct ?? null },
    fixed: (rules ?? []).filter((x) => x.type === 'trend_filter' || x.type === 'time_window'),
  }
}

export function validateDraft(d) {
  const e = {}
  if (d.trigger && !(num(d.trigger.price) > 0)) e.triggerPrice = 'Enter the price that should trigger an order.'
  if (d.research) {
    const s = num(d.research.minScore); if (!(s >= 0 && s <= 100)) e.minScore = 'Use a score from 0 to 100.'
    const a = num(d.research.maxAgeHours); if (!(a >= 1 && a <= 720)) e.maxAgeHours = 'Use 1 to 720 hours.'
    const p = num(d.research.maxDriftPct); if (!(p >= 0 && p <= 50)) e.maxDriftPct = 'Use 0 to 50%.'
  }
  if (d.cooldown.on && !(num(d.cooldown.hours) > 0)) e.cooldown = 'Enter more than 0 hours.'
  if (d.positionLimit.on && !(Number.isInteger(num(d.positionLimit.maxShares)) && num(d.positionLimit.maxShares) > 0)) e.positionLimit = 'Enter a whole number of shares.'
  if (d.dailyLoss.on && !(num(d.dailyLoss.maxLoss) > 0)) e.dailyLoss = 'Enter an amount greater than $0.'
  return e
}

/** Desired rules (each carrying the id of the rule it replaces, when there is one). */
export function draftToBot(d, { config = {}, rules = [] } = {}) {
  const keep = (type, name, cfg) => {
    const prev = find(rules, type)
    return { ...(prev?.id ? { id: prev.id } : {}), name: prev?.name ?? name, type, config: { ...(prev?.config ?? {}), ...cfg } }
  }
  const out = []
  if (d.trigger) out.push(keep('price_threshold', d.trigger.operator === 'below' ? 'Price Below Threshold' : 'Price Above Threshold', { operator: d.trigger.operator, direction: d.trigger.operator, price: num(d.trigger.price) }))
  if (d.marketHours.on) out.push(keep('market_hours', 'Market Hours', { allowPremarket: d.marketHours.extended, allowAfterHours: d.marketHours.extended }))
  if (d.cooldown.on) out.push(keep('cooldown', 'Cooldown', { windowMs: Math.round(num(d.cooldown.hours) * HOUR), cooldownHours: undefined, minutes: undefined }))
  if (d.positionLimit.on) out.push(keep('position_limit', 'Position Limit', { maxShares: num(d.positionLimit.maxShares), maxQuantity: num(d.positionLimit.maxShares) }))
  if (d.dailyLoss.on) out.push(keep('daily_loss', 'Daily Loss Limit', { maxLoss: num(d.dailyLoss.maxLoss) }))
  for (const f of d.fixed) out.push(f)
  // Remove undefined keys so stored configs stay clean.
  for (const r of out) for (const k of Object.keys(r.config)) if (r.config[k] === undefined) delete r.config[k]
  const nextConfig = d.research
    ? { ...config, research: { ...(config.research ?? {}), minConfidence: num(d.research.minScore) / 100, maxPredictionAgeHours: num(d.research.maxAgeHours), maxEntryDriftPct: num(d.research.maxDriftPct), requireEdgeOverBaseline: d.research.requireEdge } }
    : config
  return { config: nextConfig, rules: out }
}

function Toggle({ id, checked, onChange, children }) {
  return (
    <label className="tl-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

function NumberInput({ id, value, onChange, prefix, suffix, label, invalid, width = 96 }) {
  return (
    <span className="tl-inline-input">
      {prefix && <span aria-hidden="true">{prefix}</span>}
      <input id={id} className="tl-input tl-input--inline" style={{ width }} inputMode="decimal" aria-label={label} aria-invalid={invalid || undefined}
        value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} />
      {suffix && <span aria-hidden="true">{suffix}</span>}
    </span>
  )
}

export default function RuleEditor({ value: d, onChange, errors = {}, direction = 'buy', idPrefix = 'rule' }) {
  const set = (patch) => onChange({ ...d, ...patch })
  const verb = direction === 'sell' ? 'Sell' : 'Buy'
  return (
    <div className="tl-rules" data-testid="rule-editor">
      {(d.trigger || d.research) && <h4 className="tl-rules-head">When</h4>}
      {d.trigger && (
        <div className="tl-rule-row">
          <span>{verb} when the price</span>
          <select className="tl-input tl-input--inline" aria-label="Trigger direction" value={d.trigger.operator} onChange={(e) => set({ trigger: { ...d.trigger, operator: e.target.value } })}>
            <option value="above">rises above</option>
            <option value="below">falls below</option>
          </select>
          <NumberInput id={`${idPrefix}-trigger`} label="Trigger price" prefix="$" value={d.trigger.price} invalid={Boolean(errors.triggerPrice)} onChange={(v) => set({ trigger: { ...d.trigger, price: v } })} />
          {errors.triggerPrice && <p className="tl-field-error" role="alert">{errors.triggerPrice}</p>}
        </div>
      )}
      {d.research && (
        <>
          <div className="tl-rule-row">
            <span>Act on Alpha Engine research with a research score of at least</span>
            <NumberInput id={`${idPrefix}-score`} label="Minimum research score" value={d.research.minScore} invalid={Boolean(errors.minScore)} width={72} onChange={(v) => set({ research: { ...d.research, minScore: v } })} />
            <span className="tl-muted tl-small">(0–100; a score, not a probability)</span>
            {errors.minScore && <p className="tl-field-error" role="alert">{errors.minScore}</p>}
          </div>
          <div className="tl-rule-row">
            <span>Ignore research older than</span>
            <NumberInput id={`${idPrefix}-age`} label="Maximum research age in hours" suffix="hours" value={d.research.maxAgeHours} invalid={Boolean(errors.maxAgeHours)} width={72} onChange={(v) => set({ research: { ...d.research, maxAgeHours: v } })} />
            <span>or whose price has moved more than</span>
            <NumberInput id={`${idPrefix}-drift`} label="Maximum price drift percent" suffix="%" value={d.research.maxDriftPct} invalid={Boolean(errors.maxDriftPct)} width={64} onChange={(v) => set({ research: { ...d.research, maxDriftPct: v } })} />
            {(errors.maxAgeHours || errors.maxDriftPct) && <p className="tl-field-error" role="alert">{errors.maxAgeHours ?? errors.maxDriftPct}</p>}
          </div>
          <div className="tl-rule-row">
            <Toggle id={`${idPrefix}-edge`} checked={d.research.requireEdge} onChange={(v) => set({ research: { ...d.research, requireEdge: v } })}>
              Only research whose holdout beat the always-up baseline <span className="tl-muted tl-small">(turn off to experiment with research that hasn’t shown an edge)</span>
            </Toggle>
          </div>
        </>
      )}

      <h4 className="tl-rules-head">Limits</h4>
      <div className="tl-rule-row">
        <Toggle id={`${idPrefix}-hours`} checked={d.marketHours.on} onChange={(v) => set({ marketHours: { ...d.marketHours, on: v } })}>Trade only during market hours</Toggle>
        {d.marketHours.on && (
          <Toggle id={`${idPrefix}-ext`} checked={d.marketHours.extended} onChange={(v) => set({ marketHours: { ...d.marketHours, extended: v } })}>include extended hours</Toggle>
        )}
      </div>
      <div className="tl-rule-row">
        <Toggle id={`${idPrefix}-cd`} checked={d.cooldown.on} onChange={(v) => set({ cooldown: { ...d.cooldown, on: v } })}>At most one trade per symbol every</Toggle>
        <NumberInput id={`${idPrefix}-cd-h`} label="Cooldown hours" suffix="hours" value={d.cooldown.hours} invalid={Boolean(errors.cooldown)} width={72} onChange={(v) => set({ cooldown: { ...d.cooldown, hours: v, on: true } })} />
        {errors.cooldown && <p className="tl-field-error" role="alert">{errors.cooldown}</p>}
      </div>
      <div className="tl-rule-row">
        <Toggle id={`${idPrefix}-pl`} checked={d.positionLimit.on} onChange={(v) => set({ positionLimit: { ...d.positionLimit, on: v } })}>Hold at most</Toggle>
        <NumberInput id={`${idPrefix}-pl-n`} label="Maximum shares per symbol" suffix="shares per symbol" value={d.positionLimit.maxShares} invalid={Boolean(errors.positionLimit)} width={80} onChange={(v) => set({ positionLimit: { ...d.positionLimit, maxShares: v, on: true } })} />
        {errors.positionLimit && <p className="tl-field-error" role="alert">{errors.positionLimit}</p>}
      </div>
      <div className="tl-rule-row">
        <Toggle id={`${idPrefix}-dl`} checked={d.dailyLoss.on} onChange={(v) => set({ dailyLoss: { ...d.dailyLoss, on: v } })}>Stop for the day after losing</Toggle>
        <NumberInput id={`${idPrefix}-dl-n`} label="Daily loss limit in dollars" prefix="$" value={d.dailyLoss.maxLoss} invalid={Boolean(errors.dailyLoss)} width={88} onChange={(v) => set({ dailyLoss: { ...d.dailyLoss, maxLoss: v, on: true } })} />
        {errors.dailyLoss && <p className="tl-field-error" role="alert">{errors.dailyLoss}</p>}
      </div>
      {d.fixed.map((f) => (
        <p key={f.id ?? f.type} className="tl-small tl-muted tl-rule-fixed">
          {f.type === 'trend_filter' ? `Only when the ${f.config?.symbol ?? 'SPY'} trend is confirmed (set by the starting point)` : `Only between ${f.config?.start} and ${f.config?.end} ET (set by the starting point)`}
        </p>
      ))}
    </div>
  )
}

/**
 * Applies an edited draft to an existing bot through the rules API. Research settings go
 * through the bot itself. Returns { ok, error }.
 */
export async function saveBotRules({ bot, draft, api }) {
  const { config, rules } = draftToBot(draft, { config: bot.config, rules: bot.rules })
  try {
    if (draft.research) await api.put(`/bots/${bot.id}`, { config })
    const wanted = new Map(rules.filter((r) => r.type !== 'trend_filter' && r.type !== 'time_window').map((r) => [r.type, r]))
    for (const prev of bot.rules ?? []) {
      if (prev.type === 'trend_filter' || prev.type === 'time_window') continue
      const next = wanted.get(prev.type)
      if (!next) await api.del(`/bots/${bot.id}/rules/${prev.id}`)
      else if (JSON.stringify(next.config) !== JSON.stringify(prev.config)) await api.put(`/bots/${bot.id}/rules/${prev.id}`, { config: next.config })
      wanted.delete(prev.type)
    }
    for (const r of wanted.values()) await api.post(`/bots/${bot.id}/rules`, { name: r.name, type: r.type, config: r.config })
    return { ok: true, config, rules }
  } catch (error) {
    return { ok: false, error: error?.serverMessage || 'Couldn’t save the rules. Some changes may not have applied — reload to see the current rules.' }
  }
}
