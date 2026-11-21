import { engineClient } from '../clients/engine.js'
import prisma from '../loaders/prisma.js'

export default {
  /**
   * Return predictions preserving semantic boundaries.
   * Does NOT synthesize fake 'UP' / 'buy' prediction objects from ranking snapshots.
   */
  async getPredictions(query = {}) {
    try {
      // Query persistent predictions from MariaDB if any exist
      const where = {}
      if (query.ticker) where.ticker = String(query.ticker).toUpperCase().trim()
      if (query.strategyId) where.strategyId = String(query.strategyId).trim()

      const limit = Math.max(1, Math.min(100, Number(query.limit) || 25))

      const rows = await prisma.prediction.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }).catch(() => [])

      if (rows.length > 0) {
        return {
          data: rows,
          pagination: {
            hasMore: false,
            nextCursor: null
          },
          degraded: false
        }
      }

      // If predictions are not materialized in MariaDB, return explicit degraded response
      // rather than fabricating fake predictions from rankings.
      return {
        data: [],
        pagination: {
          hasMore: false,
          nextCursor: null
        },
        degraded: true,
        degradedReason: 'PREDICTIONS_NOT_MATERIALIZED'
      }
    } catch (err) {
      return {
        data: [],
        pagination: {
          hasMore: false,
          nextCursor: null
        },
        degraded: true,
        degradedReason: 'PREDICTIONS_UNAVAILABLE',
        error: err.message
      }
    }
  },

  async getPredictionById(id) {
    const pid = String(id ?? '').trim()
    if (!pid) return null

    try {
      const dbPrediction = await prisma.prediction.findUnique({
        where: { id: pid }
      }).catch(() => null)

      if (dbPrediction) return dbPrediction

      // Best effort lookup from predictions
      const { data } = await this.getPredictions({})
      return data.find((p) => p.id === pid) || null
    } catch {
      return null
    }
  }
}
