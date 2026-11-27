/**
 * Conservative, deterministic intent hints for the research composer.
 * This is not an LLM classification. Unrecognized language stays research-only.
 * No route confers authority to change mandates or run a model.
 */
export function resolveResearchIntent(input, hasInvestigation = false) {
  const text = String(input ?? '').trim()
  if (!text) return { type: 'empty', text: '' }

  if (/^(?:change|update|revise|refine) (?:my |the )?research (?:direction|mandate|focus)\b/i.test(text)) {
    return { type: 'mandate_proposal', text }
  }

  if (hasInvestigation && /^(?:follow[ -]?up|investigate further|dig deeper)(?:\s*[:—-]|\s+on\b)/i.test(text)) {
    return { type: 'follow_up', text }
  }

  return { type: 'investigation', text }
}
