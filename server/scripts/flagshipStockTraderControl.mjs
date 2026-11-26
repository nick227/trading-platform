/**
 * Explicit operator control for flagship beta bot.
 *
 * From server/: node scripts/flagshipStockTraderControl.mjs --status|--enable|--disable
 * Enabling requires paid-call flags and both monthly budgets to be configured.
 */
import 'dotenv/config'
import prisma from '../src/loaders/prisma.js'
import { getOrCreatePlatformAiStockTrader } from '../src/services/ai/aiStockTraderBotService.js'

const command = process.argv[2] || '--status'
if (!['--enable', '--disable', '--status'].includes(command)) {
  throw new Error('Expected --enable, --disable or --status')
}

try {
  const { bot } = await getOrCreatePlatformAiStockTrader()
  if (command === '--enable') {
    if (process.env.ENABLE_FLAGSHIP_STOCK_TRADER !== 'true' ||
        process.env.ENABLE_AI_PAID_CALLS !== 'true' ||
        !(Number(process.env.AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS) > 0) ||
        !(Number(process.env.AI_STOCK_TRADER_BOT_BUDGET_CENTS) > 0)) {
      throw new Error('Enable both AI feature flags and positive monthly spending budgets before enabling')
    }
    await prisma.bot.update({ where: { id: bot.id }, data: { enabled: true } })
    console.log('Flagship paper bot enabled (scheduled execution also requires scheduler enabled).')
  } else if (command === '--disable') {
    await prisma.bot.update({ where: { id: bot.id }, data: { enabled: false } })
    console.log('Flagship paper bot disabled.')
  } else {
    console.log(JSON.stringify({ botId: bot.id, enabled: bot.enabled, mode: bot.config?.mode, strategyId: bot.templateId }, null, 2))
  }
} finally {
  await prisma.$disconnect()
}
