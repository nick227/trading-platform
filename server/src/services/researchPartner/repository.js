
import prisma from '../../loaders/prisma.js'
import { defaultMandate, validateMandate, validatePartnerName, ResearchPartnerInputError } from './mandate.js'

export class ResearchPartnerConflictError extends Error {
  constructor(message = 'Research partner was changed by another request') {
    super(message)
    this.name = 'ResearchPartnerConflictError'
    this.statusCode = 409
  }
}
export class ResearchPartnerNotFoundError extends Error {
  constructor() {
    super('Research partner not found')
    this.name = 'ResearchPartnerNotFoundError'
    this.statusCode = 404
  }
}
function owner(userId) {
  if (typeof userId !== 'string' || !userId || userId.length > 191) throw new ResearchPartnerInputError('Invalid authenticated user')
}
function validId(id) {
  if (typeof id !== 'string' || !id || id.length > 191) throw new ResearchPartnerInputError('Invalid partner id')
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new ResearchPartnerInputError('Expected positive mandate version')
}
const present = p => { if (!p || p.status === 'archived') throw new ResearchPartnerNotFoundError(); return p }

export function createResearchPartnerRepository(db = prisma) {
  return {
    async create(userId, input) {
      owner(userId)
      const name = validatePartnerName(input?.name)
      const mandate = input?.mandate ? validateMandate(input.mandate) : defaultMandate(input?.objective)
      return db.$transaction(async tx => {
        const partner = await tx.researchPartner.create({
          data: { userId, name, status: 'draft', currentMandateVersion: 1 }
        })
        const saved = await tx.researchMandateVersion.create({
          data: { partnerId: partner.id, version: 1, content: mandate, createdBy: userId }
        })
        return { ...partner, mandate: saved }
      })
    },
    async list(userId) {
      owner(userId)
      return db.researchPartner.findMany({
        where: { userId, status: { not: 'archived' } },
        orderBy: { createdAt: 'desc' }, take: 100
      })
    },
    async get(userId, id) {
      owner(userId); validId(id)
      const partner = present(await db.researchPartner.findFirst({ where: { id, userId } }))
      const mandate = await db.researchMandateVersion.findUnique({
        where: { partnerId_version: { partnerId: id, version: partner.currentMandateVersion } }
      })
      if (!mandate) throw new ResearchPartnerConflictError('Active mandate version is missing')
      return { ...partner, mandate }
    },
    async reviseMandate(userId, id, expectedVersion, input) {
      owner(userId); validId(id); version(expectedVersion)
      const mandate = validateMandate(input)
      return db.$transaction(async tx => {
        const partner = present(await tx.researchPartner.findFirst({ where: { id, userId } }))
        if (partner.currentMandateVersion !== expectedVersion) throw new ResearchPartnerConflictError()
        // Compare-and-swap protects against concurrent writes without table-wide locks.
        const changed = await tx.researchPartner.updateMany({
          where: { id, userId, status: { not: 'archived' }, currentMandateVersion: expectedVersion },
          data: { currentMandateVersion: expectedVersion + 1 }
        })
        if (changed.count !== 1) throw new ResearchPartnerConflictError()
        const saved = await tx.researchMandateVersion.create({
          data: { partnerId: id, version: expectedVersion + 1, content: mandate, createdBy: userId }
        })
        return { version: saved.version, mandate: saved }
      })
    },
    async listMandates(userId, id) {
      owner(userId); validId(id)
      present(await db.researchPartner.findFirst({ where: { id, userId } }))
      return db.researchMandateVersion.findMany({ where: { partnerId: id }, orderBy: { version: 'desc' }, take: 100 })
    },
    async rename(userId, id, name, expectedUpdatedAt) {
      owner(userId); validId(id)
      const validated = validatePartnerName(name)
      if (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
        throw new ResearchPartnerInputError('expectedUpdatedAt is required')
      }
      const result = await db.researchPartner.updateMany({
        where: { id, userId, status: { not: 'archived' }, updatedAt: new Date(expectedUpdatedAt) },
        data: { name: validated }
      })
      if (result.count !== 1) {
        const exists = await db.researchPartner.findFirst({ where: { id, userId, status: { not: 'archived' } } })
        if (!exists) throw new ResearchPartnerNotFoundError()
        throw new ResearchPartnerConflictError()
      }
      return this.get(userId, id)
    },
    async archive(userId, id) {
      owner(userId); validId(id)
      const result = await db.researchPartner.updateMany({
        where: { id, userId, status: { not: 'archived' } },
        data: { status: 'archived', archivedAt: new Date() }
      })
      if (result.count !== 1) throw new ResearchPartnerNotFoundError()
      return true
    }
  }
}
