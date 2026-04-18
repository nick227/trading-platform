import serverPrisma from '../../../server/node_modules/@prisma/client/default.js'

const { PrismaClient } = serverPrisma

// Shared Prisma client for the worker process.
// Uses the same DATABASE_URL env var as the API server.
const prisma = new PrismaClient()

export default prisma
