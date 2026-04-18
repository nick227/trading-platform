import { get, post } from '../client'

export async function getBotCatalog() {
  try {
    const response = await get('/bots/catalog')
    return response
  } catch (error) {
    console.error('Failed to fetch bot catalog:', error)
    return { ruleBased: [], strategyBased: [] }
  }
}

export async function createBotFromTemplate(templateId, config) {
  try {
    const response = await post('/bots/from-template', {
      templateId,
      portfolioId: config.portfolioId || 'prt_stub_demo',
      name: config.name,
      config: config.botConfig
    })
    return response
  } catch (error) {
    console.error('Failed to create bot from template:', error)
    throw error
  }
}

export async function createStrategyBot(strategyId, config) {
  try {
    const response = await post('/bots/strategy-based', {
      strategyId,
      portfolioId: config.portfolioId || 'prt_stub_demo',
      name: config.name,
      config: config.botConfig
    })
    return response
  } catch (error) {
    console.error('Failed to create strategy bot:', error)
    throw error
  }
}
