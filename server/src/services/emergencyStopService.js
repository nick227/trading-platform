/**
 * Per-user emergency stop, persisted in User.riskSettings.emergencyStop.
 *
 * Activate: disables every bot the user owns and requests cancellation of every
 * active execution, atomically. The order worker refuses all submissions while it
 * is active. Clearing it never resumes bots — the user resumes them explicitly.
 */
import { randomUUID } from 'crypto'
import prisma from '../loaders/prisma.js'
import { ACTIVE_EXECUTION_STATUSES } from '../../../worker/src/queues/executionStatus.js'

/** Pure reader shared with the worker. */
export function readEmergencyStop(riskSettings) {
  const es = riskSettings && typeof riskSettings === 'object' ? riskSettings.emergencyStop : null
  if (!es || es.active !== true) return { active: false, ...(es?.clearedAt ? { clearedAt: es.clearedAt } : {}) }
  return { active: true, activatedAt: es.activatedAt ?? null, reason: es.reason ?? null }
}

export async function getEmergencyStop(userId, { prismaClient = prisma } = {}) {
  const user = await prismaClient.user.findUnique({ where: { id: userId }, select: { riskSettings: true } })
  return readEmergencyStop(user?.riskSettings)
}

export async function activateEmergencyStop(userId, reason, { prismaClient = prisma, now = new Date() } = {}) {
  return prismaClient.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { riskSettings: true } })
    const current = readEmergencyStop(user?.riskSettings)
    const settings = user?.riskSettings && typeof user.riskSettings === 'object' ? user.riskSettings : {}
    const activatedAt = current.active ? current.activatedAt : now.toISOString()
    await tx.user.update({
      where: { id: userId },
      data: { riskSettings: { ...settings, emergencyStop: { active: true, activatedAt, reason: reason ?? null } } }
    })

    const bots = await tx.bot.findMany({ where: { userId, enabled: true, deletedAt: null }, select: { id: true, portfolioId: true } })
    if (bots.length > 0) {
      await tx.bot.updateMany({ where: { id: { in: bots.map((b) => b.id) }, userId }, data: { enabled: false } })
      for (const bot of bots) {
        await tx.botEvent.create({
          data: {
            id: `evt_${randomUUID()}`,
            botId: bot.id,
            portfolioId: bot.portfolioId,
            type: 'bot_paused',
            detail: 'Paused by emergency stop',
            metadata: { reason: 'emergency_stop', userId, note: reason ?? null }
          }
        })
      }
    }

    const active = await tx.execution.findMany({
      where: { userId, status: { in: ACTIVE_EXECUTION_STATUSES }, cancelRequestedAt: null },
      select: { id: true }
    })
    for (const exec of active) {
      await tx.execution.updateMany({
        where: { id: exec.id, userId, cancelRequestedAt: null },
        data: { cancelRequestedAt: now, cancelRequestedBy: userId, cancelRequestReason: 'emergency_stop' }
      })
      await tx.executionAudit.create({
        data: {
          id: `aud_${randomUUID()}`,
          executionId: exec.id,
          userId,
          workerId: null,
          eventType: 'cancel_requested',
          detail: 'Cancellation requested by emergency stop',
          metadata: { reason: 'emergency_stop' }
        }
      })
    }

    return { active: true, activatedAt, botsPaused: bots.length, cancellationsRequested: active.length, alreadyActive: current.active }
  })
}

export async function clearEmergencyStop(userId, { prismaClient = prisma, now = new Date() } = {}) {
  const user = await prismaClient.user.findUnique({ where: { id: userId }, select: { riskSettings: true } })
  const settings = user?.riskSettings && typeof user.riskSettings === 'object' ? user.riskSettings : {}
  const wasActive = readEmergencyStop(settings).active
  await prismaClient.user.update({
    where: { id: userId },
    data: { riskSettings: { ...settings, emergencyStop: { active: false, clearedAt: now.toISOString() } } }
  })
  return { active: false, wasActive, botsResumed: 0 }
}

export default { readEmergencyStop, getEmergencyStop, activateEmergencyStop, clearEmergencyStop }
