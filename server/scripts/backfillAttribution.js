#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('[backfill] Starting attribution backfill for existing executions...')
  
  try {
    // Get all existing executions that don't have sourceType set
    const executions = await prisma.execution.findMany({
      where: {
        sourceType: {
          notIn: ['MANUAL', 'TEMPLATE', 'CUSTOM_RULE', 'ML_SIGNAL', 'REBALANCE']
        }
      },
      select: {
        id: true,
        origin: true,
        botId: true,
        templateId: true
      }
    })

    console.log(`[backfill] Found ${executions.length} executions to backfill`)

    let updated = 0
    let manual = 0
    let template = 0
    let unknown = 0

    for (const exec of executions) {
      let sourceType = 'UNKNOWN'
      let sourceId = null

      // Determine source based on existing data
      if (exec.origin === 'manual') {
        sourceType = 'MANUAL'
        manual++
      } else if (exec.origin === 'bot' && exec.templateId) {
        sourceType = 'TEMPLATE'
        sourceId = exec.templateId
        template++
      } else if (exec.origin === 'bot' && exec.botId) {
        sourceType = 'CUSTOM_RULE'
        sourceId = exec.botId
      } else {
        unknown++
      }

      // Update the execution
      await prisma.execution.update({
        where: { id: exec.id },
        data: {
          sourceType,
          sourceId,
          isManual: exec.origin === 'manual'
        }
      })

      updated++
    }

    console.log(`[backfill] ✅ Updated ${updated} executions:`)
    console.log(`[backfill]   - MANUAL: ${manual}`)
    console.log(`[backfill]   - TEMPLATE: ${template}`)
    console.log(`[backfill]   - UNKNOWN: ${unknown}`)

    // Verify the backfill
    const remaining = await prisma.execution.count({
      where: {
        sourceType: 'UNKNOWN'
      }
    })

    console.log(`[backfill] Remaining UNKNOWN executions: ${remaining}`)

  } catch (error) {
    console.error('[backfill] ❌ Error during backfill:', error)
    throw error
  }
}

main()
  .catch((err) => {
    console.error('[backfill] Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log('[backfill] Database connection closed')
  })
