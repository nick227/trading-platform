import { get } from '../client'

export default {
  async getOverview() {
    try {
      return await get('/ops/overview')
    } catch {
      return null
    }
  },

  async getAudits(params = {}) {
    try {
      return await get('/ops/audits', params)
    } catch {
      return []
    }
  }
}
