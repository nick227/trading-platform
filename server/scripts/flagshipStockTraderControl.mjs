/**
 * Explicit operator-only flagship beta controls.
 * From server/: node scripts/flagshipStockTraderControl.mjs
 *   --initialize | --migrate-v2 | --status | --preflight | --smoke-provider | --enable | --disable
 *
 * No command enables the bot except --enable after a passing read-only preflight.
 * A real paid provider call occurs ONLY with the explicit --smoke-provider option.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import prisma from '../src/loaders/prisma.js'
import { getProvider } from '../src/services/ai/providers/providerRegistry.js'
import { createAiUsageGovernor } from '../src/services/ai/aiUsageGovernor.js'
import { getOrCreatePlatformAiStockTrader, upgradeDisabledPlatformStockTraderToAgent } from '../src/services/ai/aiStockTraderBotService.js'
import { readFlagshipAiBetaReadiness } from '../src/services/ai/flagshipBetaReadiness.js'
import {
  AI_STOCK_TRADER_PLATFORM_BOT_ID,
  AI_STOCK_TRADER_AGENT_VERSION
} from '../src/services/ai/strategies/aiStockTraderStrategy.js'

const command = process.argv[2] || '--status'
const allowed = ['--initialize', '--migrate-v2', '--enable', '--disable', '--status', '--preflight', '--smoke-provider']
if (!allowed.includes(command) || process.argv.length > 3) {
  throw new Error(`Expected exactly one control option: ${allowed.join(', ')}`)
}

async function getBot() {
  return prisma.bot.findUnique({ where: { id: AI_STOCK_TRADER_PLATFORM_BOT_ID } })
}

async function providerSmoke(bot) {
  if (!bot || bot.config?.strategyVersion !== AI_STOCK_TRADER_AGENT_VERSION) {
    throw new Error('Initialize or explicitly migrate a disabled v2 paper bot before provider smoke')
  }
  const governor = createAiUsageGovernor({ prismaClient: prisma })
  const reservation = await governor.reserve({
    botId: bot.id,
    jobKey: 'flagship_beta_provider_smoke:' + randomUUID(),
    model: bot.config.model
  })
  let settled = false
  try {
    const response = await getProvider(bot.config.provider).completeStructured({
      systemPrompt: 'This is a connectivity test, not financial advice. Return exactly a JSON object with ok=true.',
      userPrompt: 'Return {"ok":true} only.',
      model: bot.config.model, temperature: 0, maxTokens: 50
    })
    const settlement = await governor.settle(reservation, { usage: response.usage })
    if (settlement?.settled !== true) throw new Error('Provider smoke usage settlement failed')
    settled = true
    if (response.structured?.ok !== true) throw new Error('Provider connectivity smoke returned unexpected JSON')
    const verifiedAt = new Date().toISOString()
    await prisma.botEvent.create({
      data: {
        id: 'ev_ai_smoke_' + randomUUID().replace(/-/g, ''),
        botId: bot.id, portfolioId: bot.portfolioId,
        type: 'signal_hold',
        detail: 'Flagship controlled real-provider connectivity smoke passed (no trading).',
        metadata: {
          status: 'provider_smoke_verified',
          verifiedAt, model: response.model || bot.config.model,
          source: 'explicit_operator_smoke', usage: response.usage || null
        }
      }
    })
    return { ok: true, verifiedAt, paidModelCalls: 1 }
  } catch (error) {
    if (!settled) await governor.settle(reservation, { uncertain: true }).catch(() => {})
    throw error
  }
}

try {
  if (command === '--initialize') {
    const { bot } = await getOrCreatePlatformAiStockTrader()
    console.log(JSON.stringify({
      initialized: true, botId: bot.id,
      enabled: bot.enabled, strategyVersion: bot.config?.strategyVersion
    }, null, 2))
  } else if (command === '--migrate-v2') {
    const result = await upgradeDisabledPlatformStockTraderToAgent()
    console.log(JSON.stringify(result, null, 2))
  } else if (command === '--status') {
    const bot = await getBot()
    console.log(JSON.stringify(bot ? {
      botId: bot.id, enabled: bot.enabled, mode: bot.config?.mode,
      strategyId: bot.templateId, strategyVersion: bot.config?.strategyVersion
    } : { status: 'not_initialized' }, null, 2))
  } else if (command === '--disable') {
    const bot = await getBot()
    if (bot) await prisma.bot.update({ where: { id: bot.id }, data: { enabled: false } })
    console.log('Flagship paper bot disabled. Inspect any already queued or uncertain paper orders.')
  } else if (command === '--preflight') {
    const readiness = await readFlagshipAiBetaReadiness()
    console.log(JSON.stringify(readiness, null, 2))
    if (!readiness.readyToEnable) process.exitCode = 1
  } else if (command === '--smoke-provider') {
    const result = await providerSmoke(await getBot())
    console.log(JSON.stringify(result, null, 2))
  } else if (command === '--enable') {
    const readiness = await readFlagshipAiBetaReadiness()
    if (!readiness.readyToEnable) {
      throw new Error('Beta preflight blocked: ' + readiness.blockers.join(', '))
    }
    const bot = await getBot()
    await prisma.bot.update({ where: { id: bot.id }, data: { enabled: true } })
    console.log('Flagship v2 paper bot enabled after passing preflight. No live brokerage trades.')
  }
} finally {
  await prisma.$disconnect()
}
