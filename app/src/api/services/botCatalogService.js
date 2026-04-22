import { get, post, put, del } from '../client'

export async function getBotCatalog() {
  try {
    const response = await get('/bots/catalog')
    return response
  } catch (error) {
    console.error('Failed to fetch bot catalog:', error)
    return { ruleBased: [], strategyBased: [] }
  }
}

export async function getBots() {
  try {
    const response = await get('/bots')
    return response
  } catch (error) {
    console.error('Failed to fetch bots:', error)
    throw error
  }
}

export async function getBotById(botId) {
  try {
    const response = await get(`/bots/${botId}`)
    return response
  } catch (error) {
    console.error('Failed to fetch bot:', error)
    throw error
  }
}

export async function updateBot(botId, data) {
  try {
    const response = await put(`/bots/${botId}`, data)
    return response
  } catch (error) {
    console.error('Failed to update bot:', error)
    throw error
  }
}

export async function deleteBot(botId) {
  try {
    const response = await del(`/bots/${botId}`)
    return response
  } catch (error) {
    console.error('Failed to delete bot:', error)
    throw error
  }
}

export async function getBotEvents(botId) {
  try {
    const response = await get(`/bots/${botId}/events`)
    return response
  } catch (error) {
    console.error('Failed to fetch bot events:', error)
    return []
  }
}

export async function getBotRules(botId) {
  try {
    const response = await get(`/bots/${botId}/rules`)
    return response
  } catch (error) {
    console.error('Failed to fetch bot rules:', error)
    return []
  }
}

export async function createBotFromTemplate(templateId, config) {
  if (!config.portfolioId) {
    throw new Error('Portfolio ID is required. Please select a valid portfolio.')
  }
  
  try {
    const response = await post('/bots/catalog/from-template', {
      templateId,
      portfolioId: config.portfolioId,
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
  if (!config.portfolioId) {
    throw new Error('Portfolio ID is required. Please select a valid portfolio.')
  }
  
  try {
    const response = await post('/bots/strategy-based', {
      strategyId,
      portfolioId: config.portfolioId,
      name: config.name,
      config: config.botConfig
    })
    return response
  } catch (error) {
    console.error('Failed to create strategy bot:', error)
    throw error
  }
}
