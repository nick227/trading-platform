function validateEventMetadata(type, metadata) {
  switch (type) {
    case 'rule_triggered':
      if (!metadata.ticker || !metadata.actualPrice || !metadata.ruleId) {
        throw new Error('rule_triggered event requires ticker, actualPrice, and ruleId')
      }
      break
    case 'decision_made':
      if (!metadata.confidence || !metadata.modelVersion || !metadata.regime || !metadata.strategyId) {
        throw new Error('decision_made event requires confidence, modelVersion, regime, and strategyId')
      }
      break
    case 'execution_created':
      if (!metadata.executionId || metadata.quantity == null || metadata.price == null || !metadata.direction) {
        throw new Error('execution_created event requires executionId, quantity, price, and direction')
      }
      break
    case 'execution_skipped':
      if (!metadata.reason) {
        throw new Error('execution_skipped event requires reason')
      }
      break
    case 'error_occurred':
      if (!metadata.code || !metadata.message) {
        throw new Error('error_occurred event requires code and message')
      }
      break
    default:
      throw new Error(`Unknown event type: ${type}`)
  }
}

export { validateEventMetadata }
