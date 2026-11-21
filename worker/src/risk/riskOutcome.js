/**
 * What the bot engine does with a portfolio risk verdict.
 *
 *   approve  → order at the requested quantity.
 *   restrict → by default NOT traded (RISK_RESTRICT_MODE=block). With
 *              RISK_RESTRICT_MODE=reduce it is traded only at the risk engine's reduced
 *              quantity, and only when no hard check failed and that quantity is >= 1.
 *   reject   → never traded.
 *
 * Simulator test scenario (SIM_TEST_SCENARIO, honoured only when the internal simulator
 * is enabled): the verdict is still computed and recorded, but the order proceeds so the
 * simulated lifecycle can be demonstrated. It is labelled as a test scenario and never
 * applies to broker-connected processing. The M6 final eligibility boundary still runs.
 */
export const RESTRICT_MODES = ['block', 'reduce']

export function riskPolicyConfig(env = process.env, { simulationEnabled = false } = {}) {
  const mode = RESTRICT_MODES.includes(env.RISK_RESTRICT_MODE) ? env.RISK_RESTRICT_MODE : 'block'
  const scenario = String(env.SIM_TEST_SCENARIO ?? '').trim()
  return { restrictMode: mode, testScenario: simulationEnabled && /^[\w.-]{1,64}$/.test(scenario) ? scenario : null }
}

export function resolveRiskOutcome(evaluation, { quantity, restrictMode = 'block', testScenario = null }) {
  const verdict = {
    decision: evaluation?.decision ?? (evaluation?.approved ? 'approve' : 'reject'),
    reason: evaluation?.reason ?? null,
    approved: evaluation?.approved === true,
    failedChecks: (evaluation?.failedChecks ?? []).map((c) => c.type ?? c),
    adjustedQuantity: Number.isFinite(evaluation?.adjustedQuantity) ? evaluation.adjustedQuantity : null,
    scores: evaluation?.scores ? Object.fromEntries(Object.entries(evaluation.scores).map(([k, v]) => [k, v?.score ?? v])) : null,
  }
  if (verdict.approved && verdict.decision === 'approve') {
    return { proceed: true, quantity, basis: 'approved', verdict }
  }
  if (verdict.decision === 'restrict' && restrictMode === 'reduce' && verdict.failedChecks.length === 0 &&
      verdict.adjustedQuantity !== null && verdict.adjustedQuantity >= 1 && verdict.adjustedQuantity < quantity) {
    return { proceed: true, quantity: verdict.adjustedQuantity, basis: 'restricted_reduced', verdict }
  }
  if (testScenario) {
    return { proceed: true, quantity, basis: 'simulator_test_scenario', testScenario, verdict }
  }
  return { proceed: false, quantity: 0, basis: verdict.decision === 'restrict' ? 'restricted_blocked' : 'rejected', verdict }
}
