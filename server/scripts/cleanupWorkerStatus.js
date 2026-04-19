import 'dotenv/config'
import prisma from '../src/loaders/prisma.js'

const RETENTION_MS = Number(process.env.WORKER_STATUS_RETENTION_MS ?? 24 * 60 * 60 * 1000)
const staleBefore = new Date(Date.now() - RETENTION_MS)

async function main() {
  const result = await prisma.workerStatus.deleteMany({
    where: {
      lastSeen: { lt: staleBefore }
    }
  })

  console.log(JSON.stringify({
    deleted: result.count,
    retentionMs: RETENTION_MS,
    staleBefore: staleBefore.toISOString()
  }, null, 2))
}

main()
  .catch((err) => {
    console.error('[cleanupWorkerStatus] error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
