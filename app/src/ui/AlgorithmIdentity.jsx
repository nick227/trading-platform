import { isResearchBot } from './describeBot'

/** Identity comes from enabled behavior, never from runtime state or performance. */
export function algorithmIdentity(bot = {}) {
  const rules = (bot.rules ?? []).filter((r) => r.enabled !== false)
  if (isResearchBot(bot.config)) return { kind: 'research', label: 'Research Follower' }
  if (bot.rulesAvailable === false) return { kind: 'custom', label: 'Algorithm' }
  if (rules.some((r) => r.type === 'trend_filter')) return { kind: 'trend', label: 'Trend Watcher' }
  if (rules.some((r) => r.type === 'price_threshold')) return { kind: 'price', label: 'Price Scout' }
  if (bot.botType === 'rule_based') return { kind: 'schedule', label: 'Scheduled Trader' }
  return { kind: 'custom', label: 'Custom algorithm' }
}

export default function AlgorithmIdentity({ bot, compact = false }) {
  const { kind } = algorithmIdentity(bot)
  const marks = {
    price: <><path d="M5 17h22M7 24l7-5 5-10 6-3" /><circle cx="19" cy="9" r="2" /></>,
    research: <><circle cx="9" cy="10" r="4" /><circle cx="23" cy="22" r="4" /><path d="m12 13 8 6M19 7h6M22 4v6M5 25h6" /></>,
    trend: <><path d="M5 25h22M6 20h6v-5h7V8h7" /><path d="m22 5 4 3-4 3" /></>,
    schedule: <><circle cx="16" cy="16" r="10" /><path d="M16 9v7l5 3M4 7V3h4M28 25v4h-4" /></>,
    custom: <><path d="m16 4 12 12-12 12L4 16Z" /><circle cx="16" cy="16" r="3" /></>,
  }
  return <span className={`tl-identity tl-identity--${kind}${compact ? ' tl-identity--compact' : ''}`} aria-hidden="true">
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{marks[kind]}</svg>
  </span>
}
