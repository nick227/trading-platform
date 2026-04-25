import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  log: process.env.DEBUG_PRISMA === 'true' ? ['query', 'error', 'warn'] : ['error', 'warn']
})

export default prisma
