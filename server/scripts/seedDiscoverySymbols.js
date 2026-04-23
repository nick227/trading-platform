import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const prisma = new PrismaClient()
const __dir = dirname(fileURLToPath(import.meta.url))

function toUpper(value) {
  return String(value ?? '').trim().toUpperCase()
}

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS DiscoverySymbol (
      symbol VARCHAR(191) NOT NULL PRIMARY KEY,
      name VARCHAR(191) NULL,
      marketCap DOUBLE NULL,
      avgVolume DOUBLE NULL,
      lastPrice DOUBLE NULL,
      sector VARCHAR(191) NULL,
      industry VARCHAR(191) NULL,
      isTradable BOOLEAN NOT NULL DEFAULT false,
      tradableBroker VARCHAR(191) NULL,
      untradableReason VARCHAR(191) NULL,
      source VARCHAR(191) NOT NULL DEFAULT 'manual',
      lastProfileRefreshAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    )
  `)

  const seedPath = join(__dir, '../prisma/seeds/discovery-symbols.json')
  const rows = JSON.parse(readFileSync(seedPath, 'utf8'))
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('[seed:discovery] no rows to seed')
    return
  }

  for (const row of rows) {
    const symbol = toUpper(row.symbol)
    if (!symbol) continue

    await prisma.$executeRaw`
      INSERT INTO DiscoverySymbol (
        symbol, name, marketCap, avgVolume, lastPrice, sector, industry,
        isTradable, tradableBroker, untradableReason, source, lastProfileRefreshAt, createdAt, updatedAt
      )
      VALUES (
        ${symbol}, ${row.name ?? null}, ${row.marketCap ?? null}, ${row.avgVolume ?? null}, ${row.lastPrice ?? null},
        ${row.sector ?? null}, ${row.industry ?? null}, ${Boolean(row.isTradable)},
        ${row.tradableBroker ?? null}, ${row.untradableReason ?? null}, ${row.source ?? 'manual'},
        NOW(), NOW(), NOW()
      )
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        marketCap = VALUES(marketCap),
        avgVolume = VALUES(avgVolume),
        lastPrice = VALUES(lastPrice),
        sector = VALUES(sector),
        industry = VALUES(industry),
        isTradable = VALUES(isTradable),
        tradableBroker = VALUES(tradableBroker),
        untradableReason = VALUES(untradableReason),
        source = VALUES(source),
        lastProfileRefreshAt = NOW(),
        updatedAt = NOW()
    `

    console.log(`[seed:discovery] upserted ${symbol}`)
  }

  console.log(`[seed:discovery] done (${rows.length} rows)`)
}

main()
  .catch((error) => {
    console.error('[seed:discovery] error:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
