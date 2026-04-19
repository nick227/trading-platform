import { PrismaClient } from '@prisma/client'

// Shared Prisma client for the worker process.
// Uses the same DATABASE_URL env var as the API server.
const prisma = new PrismaClient()

export default prisma
