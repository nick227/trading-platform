import prisma from '../db/prisma.js'
import { randomUUID } from 'crypto'

function buildAuditId() {
  return `aud_${randomUUID()}`
}

export async function recordExecutionAudit({
  executionId,
  userId,
  workerId = null,
  eventType,
  detail,
  metadata = null
}) {
  try {
    await prisma.executionAudit.create({
      data: {
        id: buildAuditId(),
        executionId,
        userId,
        workerId,
        eventType,
        detail,
        metadata
      }
    })
  } catch (err) {
    console.error('[executionAudit] failed to record audit event:', err.message)
  }
}
