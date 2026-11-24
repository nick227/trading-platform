import 'dotenv/config'
import { executeAiStrategyCycle, getOrCreateCanonicalAiBot, getAiDecisionsHistory } from '../src/services/ai/aiBotService.js'
import prisma from '../src/loaders/prisma.js'

async function run() {
  console.log('--- Initializing Canonical AI Bot ---')
  const { bot } = await getOrCreateCanonicalAiBot()
  console.log('Bot ID:', bot.id, '| Name:', bot.name, '| BotType:', bot.botType)

  console.log('\n--- Running Autonomous AI Research & Decision Cycle (OpenAI gpt-4o-mini) ---')
  const cycleResult = await executeAiStrategyCycle({
    botId: bot.id,
    session: '2026-11-20',
    providerName: 'openai',
    dryRun: false
  })

  console.log('\n=== Cycle Summary ===')
  console.log('Session:', cycleResult.asOfSession)
  console.log('Model:', cycleResult.model)
  console.log('Market Summary:', cycleResult.marketSummary)
  console.log('Total Symbols Evaluated:', cycleResult.evaluationsCount)
  console.log('HOLD Count:', cycleResult.holdCount)
  console.log('Actionable Decisions Count:', cycleResult.actionableCount)

  console.log('\n=== Symbol Evaluations ===')
  for (const ev of cycleResult.evaluations) {
    console.log(`[${ev.action}] ${ev.symbol} (Confidence: ${ev.confidence})`)
    console.log(`  Thesis: ${ev.thesis}`)
    if (ev.evidence?.length) console.log(`  Evidence: ${ev.evidence.join(' | ')}`)
  }

  if (cycleResult.createdExecutions.length > 0) {
    console.log('\n=== Created Executions (Next Session Execution) ===')
    for (const exec of cycleResult.createdExecutions) {
      console.log(`Execution ID: ${exec.id}`)
      console.log(`  Symbol: ${exec.symbol} | Direction: ${exec.direction} | Qty: ${exec.quantity} | Intent Price: $${exec.intentPrice}`)
      console.log(`  Target Session: ${exec.targetSession} | Status: queued`)
      console.log(`  Thesis: ${exec.thesis}`)
    }
  } else {
    console.log('\nNo actionable orders created (all symbols either HOLD or gated by risk).')
  }

  console.log('\n=== Verifying Audit Trail in BotEvent ===')
  const history = await getAiDecisionsHistory(bot.id, { limit: 5 })
  console.log(`Found ${history.length} recent decision events for bot ${bot.id}`)
  if (history[0]) {
    console.log('Latest event:', history[0].detail)
  }

  await prisma.$disconnect()
}

run().catch(err => {
  console.error('Fatal error running AI cycle:', err)
  process.exit(1)
})
