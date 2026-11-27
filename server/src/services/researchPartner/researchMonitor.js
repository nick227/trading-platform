import prisma from '../../loaders/prisma.js'
import { createResearchPartnerEvidenceCollector } from './evidenceBridge.js'
import { ResearchPartnerNotFoundError, ResearchPartnerConflictError } from './repository.js'
import { ResearchPartnerInputError } from './mandate.js'

const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/
const HOUR = 60 * 60 * 1000
const MAX_REMEMBERED = 100
function validSymbols(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) {
    throw new ResearchPartnerInputError('Select 1–20 ticker symbols to monitor')
  }
  const symbols = input.map(x => typeof x === 'string' ? x.trim().toUpperCase() : '')
  if (symbols.some(x => !SYMBOL.test(x)) || new Set(symbols).size !== symbols.length) {
    throw new ResearchPartnerInputError('Invalid or duplicate monitoring symbols')
  }
  return symbols
}
const key = item => item.source + ':' + item.contentHash
/** Monitor only newly available source evidence, not price predictions or automatic order signals. */
export function createResearchMonitorService({
  db = prisma, evidenceCollector = createResearchPartnerEvidenceCollector(),
  clock = () => new Date()
} = {}) {
  async function ownedPartner(userId, partnerId) {
    const partner = await db.researchPartner.findFirst({
      where: { id: partnerId, userId, status: { not: 'archived' } }
    })
    if (!partner) throw new ResearchPartnerNotFoundError()
    return partner
  }
  async function ownedMonitor(userId, partnerId, monitorId) {
    await ownedPartner(userId, partnerId)
    const monitor = await db.researchMonitor.findFirst({ where: { id: monitorId, partnerId } })
    if (!monitor) throw new ResearchPartnerNotFoundError()
    return monitor
  }
  async function runMonitor(monitor, now) {
    const leaseUntil = new Date(now.getTime() + 15 * 60 * 1000)
    const claimed = await db.researchMonitor.updateMany({
      where: { id: monitor.id, status: 'active', nextCheckAt: { lte: now } },
      data: { nextCheckAt: leaseUntil }
    })
    if (claimed.count !== 1) throw new ResearchPartnerConflictError('Monitor is not due or is already running')
    try {
      const partner = await db.researchPartner.findFirst({
        where: { id: monitor.partnerId, status: { not: 'archived' } }
      })
      if (!partner) throw new ResearchPartnerNotFoundError()
      const mandate = await db.researchMandateVersion.findUnique({
        where: { partnerId_version: {
          partnerId: monitor.partnerId, version: partner.currentMandateVersion
        } }
      })
      if (!mandate) throw new Error('Current research mandate missing')
      const snapshot = await evidenceCollector({
        mandate: { ...mandate.content, watchlist: monitor.symbols }
      })
      const records = snapshot.records || []
      // Missing providers do not imply that previously observed evidence disappeared.
      const observed = new Set((monitor.seenHashes || []).filter(x => typeof x === 'string'))
      const currentKeys = []
      const additions = []
      for (const record of records) {
        if (typeof record.contentHash !== 'string' || !record.contentHash) continue
        const identity = key(record)
        if (currentKeys.includes(identity)) continue
        currentKeys.push(identity)
        if (monitor.lastCheckedAt && !observed.has(identity)) {
          additions.push({ id:record.id, source:record.source, title:record.title,
            url:record.url || null, publishedAt:record.publishedAt,
            availableAt:record.availableAt, contentHash:record.contentHash })
        }
      }
      const combined = [...new Set([...currentKeys, ...observed])].slice(0, MAX_REMEMBERED)
      const nextCheckAt = new Date(now.getTime() + (monitor.cadence === 'weekly' ? 7 * 24 : 24) * HOUR)
      await db.$transaction(async tx => {
        await tx.researchMonitor.update({
          where: { id: monitor.id },
          data: { lastCheckedAt: now, nextCheckAt, lastError: null,
            seenHashes: combined,
            lastFingerprint: snapshot.fingerprint || null }
        })
        if (additions.length) {
          await tx.researchMonitorEvent.create({
            data: { monitorId: monitor.id, kind: 'new_evidence',
              payload: { newRecords: additions, asOfSession: snapshot.asOfSession,
                sourceFingerprint: snapshot.fingerprint || null,
                notice: 'New evidence was found; the research thesis has not been re-evaluated.' } }
          })
        }
      })
      return { monitorId: monitor.id, additions: additions.length,
        status: additions.length ? 'new_evidence' : 'no_new_evidence', nextCheckAt }
    } catch (error) {
      await db.researchMonitor.updateMany({
        where: { id: monitor.id, status: 'active' },
        data: { lastError: String(error.message).slice(0, 500),
          nextCheckAt: new Date(now.getTime() + HOUR) }
      })
      throw error
    }
  }
  return {
    async create(userId, partnerId, { name, symbols, cadence = 'daily' }) {
      await ownedPartner(userId, partnerId)
      if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
          !['daily','weekly'].includes(cadence)) throw new ResearchPartnerInputError('Invalid monitor settings')
      return db.researchMonitor.create({
        data: { partnerId, name:name.trim(), symbols:validSymbols(symbols),
          cadence, status:'active', seenHashes:[], nextCheckAt:clock() }
      })
    },
    async list(userId, partnerId) {
      await ownedPartner(userId, partnerId)
      return db.researchMonitor.findMany({
        where: { partnerId }, orderBy: { createdAt: 'desc' }, take: 30,
        include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } }
      })
    },
    async setStatus(userId, partnerId, monitorId, status) {
      const monitor = await ownedMonitor(userId, partnerId, monitorId)
      if (!['active','paused'].includes(status)) throw new ResearchPartnerInputError('Invalid monitor status')
      const changed = await db.researchMonitor.updateMany({
        where: { id: monitor.id, status: monitor.status },
        data: { status, ...(status === 'active' ? { nextCheckAt: clock() } : {}) }
      })
      if (changed.count !== 1) throw new ResearchPartnerConflictError('Monitor was changed')
      return { monitorId, status }
    },
    async check(userId, partnerId, monitorId) {
      const monitor = await ownedMonitor(userId, partnerId, monitorId)
      return runMonitor(monitor, clock())
    },
    async runDue(limit = 10) {
      const now = clock()
      const monitors = await db.researchMonitor.findMany({
        where: { status:'active', nextCheckAt:{ lte:now } },
        orderBy:{ nextCheckAt:'asc' }, take:Math.min(10,Math.max(1,limit))
      })
      const outcomes = []
      for (const monitor of monitors) {
        try { outcomes.push(await runMonitor(monitor,now)) }
        catch (error) { outcomes.push({monitorId:monitor.id,status:'failed',reason:String(error.message).slice(0,150)}) }
      }
      return outcomes
    }
  }
}
