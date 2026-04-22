// Execution Slot Service
// Handles atomic execution slot reservations for concurrent trading control

import prisma from '../../db/prisma.js'

export class ExecutionSlotService {
  constructor() {
    this.slotTimeoutMs = 30 * 1000 // 30 seconds timeout
    this.maxSlotsPerPortfolio = 3 // Maximum concurrent executions per portfolio
  }

  // Reserve execution slot atomically using database transaction
  async reserveExecutionSlot(portfolioId) {
    const reservationId = `res_${portfolioId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    try {
      // Check current active reservations for portfolio
      const activeReservations = await prisma.executionReservation.count({
        where: {
          portfolioId,
          status: 'active',
          expiresAt: { gt: new Date() }
        }
      })

      // Check if portfolio has reached its slot limit
      if (activeReservations >= this.maxSlotsPerPortfolio) {
        return {
          success: false,
          reason: 'max_slots_reached',
          currentSlots: activeReservations,
          maxSlots: this.maxSlotsPerPortfolio
        }
      }

      // Create reservation in transaction
      const reservation = await prisma.$transaction(async (tx) => {
        // Double-check slot availability within transaction
        const currentCount = await tx.executionReservation.count({
          where: {
            portfolioId,
            status: 'active',
            expiresAt: { gt: new Date() }
          }
        })

        if (currentCount >= this.maxSlotsPerPortfolio) {
          throw new Error('Slot limit reached')
        }

        // Create the reservation
        return await tx.executionReservation.create({
          data: {
            id: reservationId,
            portfolioId,
            status: 'active',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + this.slotTimeoutMs)
          }
        })
      })

      return {
        success: true,
        reservationId: reservation.id,
        expiresAt: reservation.expiresAt,
        timeoutMs: this.slotTimeoutMs
      }

    } catch (error) {
      console.error('Failed to reserve execution slot:', error)
      
      // Clean up any partially created reservation
      try {
        await prisma.executionReservation.deleteMany({
          where: {
            id: reservationId,
            status: 'active'
          }
        })
      } catch (cleanupError) {
        console.error('Failed to cleanup failed reservation:', cleanupError)
      }

      return {
        success: false,
        reason: error.message === 'Slot limit reached' ? 'max_slots_reached' : 'database_error',
        error: error.message
      }
    }
  }

  // Release execution slot
  async releaseExecutionSlot(portfolioId, reservationId) {
    try {
      const reservation = await prisma.executionReservation.update({
        where: { id: reservationId },
        data: {
          status: 'released',
          releasedAt: new Date()
        }
      })

      // Log slot release
      await prisma.botEvent.create({
        data: {
          portfolioId,
          type: 'slot_released',
          detail: `Execution slot released: ${reservationId}`,
          metadata: {
            reservationId,
            duration: Date.now() - reservation.createdAt.getTime(),
            releasedAt: new Date()
          }
        }
      })

      return {
        success: true,
        reservationId: reservation.id,
        releasedAt: reservation.releasedAt
      }

    } catch (error) {
      console.error('Failed to release execution slot:', error)
      
      // Check if reservation exists
      const exists = await prisma.executionReservation.findUnique({
        where: { id: reservationId }
      })

      if (!exists) {
        return {
          success: false,
          reason: 'reservation_not_found',
          reservationId
        }
      }

      return {
        success: false,
        reason: 'database_error',
        error: error.message
      }
    }
  }

  // Get current slot usage for portfolio
  async getSlotUsage(portfolioId) {
    try {
      const activeReservations = await prisma.executionReservation.findMany({
        where: {
          portfolioId,
          status: 'active',
          expiresAt: { gt: new Date() }
        },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true
        },
        orderBy: { createdAt: 'desc' }
      })

      return {
        portfolioId,
        activeSlots: activeReservations.length,
        maxSlots: this.maxSlotsPerPortfolio,
        availableSlots: Math.max(0, this.maxSlotsPerPortfolio - activeReservations.length),
        reservations: activeReservations.map(res => ({
          id: res.id,
          age: Date.now() - res.createdAt.getTime(),
          timeRemaining: Math.max(0, res.expiresAt.getTime() - Date.now())
        }))
      }

    } catch (error) {
      console.error('Failed to get slot usage:', error)
      return {
        portfolioId,
        error: error.message,
        activeSlots: 0,
        maxSlots: this.maxSlotsPerPortfolio,
        availableSlots: this.maxSlotsPerPortfolio
      }
    }
  }

  // Clean up expired reservations
  async cleanupExpiredReservations() {
    try {
      const result = await prisma.executionReservation.updateMany({
        where: {
          status: 'active',
          expiresAt: { lt: new Date() }
        },
        data: {
          status: 'expired',
          releasedAt: new Date()
        }
      })

      if (result.count > 0) {
        console.log(`Cleaned up ${result.count} expired execution reservations`)
        
        // Log cleanup event
        await prisma.botEvent.create({
          data: {
            type: 'slot_cleanup',
            detail: `Cleaned up ${result.count} expired reservations`,
            metadata: {
              cleanedUpCount: result.count,
              cleanupTime: new Date()
            }
          }
        })
      }

      return {
        success: true,
        cleanedUpCount: result.count
      }

    } catch (error) {
      console.error('Failed to cleanup expired reservations:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // Force release all slots for a portfolio (emergency use)
  async forceReleaseAllSlots(portfolioId, reason = 'emergency') {
    try {
      const result = await prisma.executionReservation.updateMany({
        where: {
          portfolioId,
          status: 'active'
        },
        data: {
          status: 'force_released',
          releasedAt: new Date()
        }
      })

      // Log force release
      await prisma.botEvent.create({
        data: {
          portfolioId,
          type: 'slots_force_released',
          detail: `Force released ${result.count} execution slots: ${reason}`,
          metadata: {
            releasedCount: result.count,
            reason,
            releasedAt: new Date()
          }
        }
      })

      return {
        success: true,
        releasedCount: result.count,
        reason
      }

    } catch (error) {
      console.error('Failed to force release slots:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // Get slot statistics across all portfolios
  async getSlotStatistics() {
    try {
      const stats = await prisma.executionReservation.groupBy({
        by: ['portfolioId', 'status'],
        _count: {
          id: true
        },
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
        }
      })

      const result = {
        totalActive: 0,
        totalReleased: 0,
        totalExpired: 0,
        totalForceReleased: 0,
        portfolioStats: {}
      }

      stats.forEach(stat => {
        const count = stat._count.id
        result[`total${stat.status.charAt(0).toUpperCase() + stat.status.slice(1)}`] = count
        
        if (!result.portfolioStats[stat.portfolioId]) {
          result.portfolioStats[stat.portfolioId] = {}
        }
        result.portfolioStats[stat.portfolioId][stat.status] = count
      })

      return result

    } catch (error) {
      console.error('Failed to get slot statistics:', error)
      return {
        error: error.message
      }
    }
  }

  // Update slot configuration
  updateConfiguration(config = {}) {
    if (config.slotTimeoutMs !== undefined) {
      this.slotTimeoutMs = config.slotTimeoutMs
    }
    if (config.maxSlotsPerPortfolio !== undefined) {
      this.maxSlotsPerPortfolio = config.maxSlotsPerPortfolio
    }
  }
}

export const executionSlotService = new ExecutionSlotService()
