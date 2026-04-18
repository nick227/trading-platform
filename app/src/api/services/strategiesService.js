import { get } from '../client'

export default {
  async getAll(layer = null) {
    try {
      const strategies = await get('/strategies')
      
      if (layer) {
        return strategies.filter(strategy => strategy.layer === layer)
      }
      return strategies
    } catch {
      return []
    }
  },
  
  async getById(id) {
    try {
      const strategies = await get('/strategies')
      return strategies.find(strategy => strategy.id === id)
    } catch {
      return null
    }
  }
}
