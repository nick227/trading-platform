/**
 * Expandable, point-in-time AI research context.
 *
 * Modules are deterministic collectors. Their results are never allowed
 * to inject instructions into the provider's system prompt.
 */
import { createHash } from 'node:crypto'
import { AI_STOCK_TRADER_VERSION } from './strategies/aiStockTraderStrategy.js'

export const STOCK_TRADER_REQUIRED_MODULES = Object.freeze(['market', 'portfolio', 'objectives', 'risk'])

export class ResearchContextError extends Error {
  constructor(moduleId, reason) {
    super(`AI research context ${moduleId}: ${reason}`)
    this.name = 'ResearchContextError'
    this.moduleId = moduleId
    this.reason = reason
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function createStockTraderContextRegistry() {
  const collectors = new Map()

  return {
    register({ id, version, required = false, collect }) {
      if (!/^[a-z][a-z0-9_-]*$/.test(id ?? '') || typeof version !== 'string' || !version ||
          typeof collect !== 'function' || collectors.has(id)) {
        throw new Error('Invalid or duplicate AI research context module')
      }
      collectors.set(id, { id, version, required, collect })
      return this
    },

    list() {
      return [...collectors.keys()]
    },

    async assemble({ session, input, modules = STOCK_TRADER_REQUIRED_MODULES, maxBytes = 48_000,
      evidenceRegistry = null, evidenceSourceIds = [], retrievedCutoff = null }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(session ?? '') || Number.isNaN(Date.parse(session + 'T00:00:00Z'))) {
        throw new Error('Valid session required for AI context')
      }
      if (!Array.isArray(modules) || !modules.length || new Set(modules).size !== modules.length) {
        throw new Error('Context modules must be a unique nonempty list')
      }
      if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error('Invalid context byte budget')

      const sections = {}
      const unavailable = []
      for (const id of modules) {
        const definition = collectors.get(id)
        if (!definition) throw new ResearchContextError(id, 'module not registered')
        let result
        try {
          result = await definition.collect({ session, input })
        } catch (error) {
          if (definition.required) throw new ResearchContextError(id, error.message)
          unavailable.push({ id, version: definition.version, reason: 'collection_failed' })
          continue
        }

        if (!isPlainObject(result) || !['valid', 'partial', 'unavailable'].includes(result.quality) ||
            typeof result.source !== 'string' || !result.source ||
            typeof result.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.asOf) ||
            result.asOf > session || (definition.required && (result.quality !== 'valid' || result.asOf !== session))) {
          if (definition.required) throw new ResearchContextError(id, 'invalid, stale or missing required data')
          unavailable.push({ id, version: definition.version, reason: 'invalid_or_unavailable' })
          continue
        }
        if (result.quality === 'unavailable') {
          if (definition.required) throw new ResearchContextError(id, 'required data unavailable')
          unavailable.push({ id, version: definition.version, reason: 'unavailable' })
          continue
        }
        sections[id] = {
          version: definition.version,
          asOf: result.asOf,
          quality: result.quality,
          source: result.source,
          data: result.data
        }
      }

      // Sort keys so module registration order cannot change the fingerprint.
      const ordered = Object.fromEntries(Object.keys(sections).sort().map(id => [id, sections[id]]))
      if (evidenceSourceIds.length && !evidenceRegistry) {
        throw new Error('Research evidence adapters must be explicitly registered')
      }
      const evidence = evidenceRegistry && evidenceSourceIds.length
        ? await evidenceRegistry.assemble({
          sourceIds: evidenceSourceIds, asOfSession: session, input,
          retrievedCutoff, maxBytes: Math.floor(maxBytes / 2)
        })
        : null
      const snapshot = {
        strategyVersion: AI_STOCK_TRADER_VERSION,
        asOfSession: session,
        context: ordered,
        unavailable: unavailable.sort((a, b) => a.id.localeCompare(b.id)),
        ...(evidence ? { evidence } : {})
      }
      const json = JSON.stringify(snapshot)
      if (Buffer.byteLength(json, 'utf8') > maxBytes) throw new Error('AI research context exceeds byte budget')
      return {
        ...snapshot,
        fingerprint: createHash('sha256').update(json).digest('hex'),
        byteSize: Buffer.byteLength(json, 'utf8')
      }
    }
  }
}

/** Beta context modules consume a point-in-time screening snapshot and paper portfolio. */
export function createDefaultStockTraderContextRegistry() {
  return createStockTraderContextRegistry()
    .register({
      id: 'market', version: '1.0.0', required: true,
      collect: async ({ session, input }) => ({
        asOf: input.screening?.asOfSession ?? '',
        quality: input.screening?.asOfSession === session ? 'valid' : 'unavailable',
        source: 'tradeloom-stock-screener',
        data: {
          shortlist: input.screening?.shortlist ?? [],
          ranking: input.screening?.ranking ?? [],
          excluded: input.screening?.excluded ?? []
        }
      })
    })
    .register({
      id: 'portfolio', version: '1.0.0', required: true,
      collect: async ({ session, input }) => ({
        asOf: input.portfolio?.asOfSession ?? '',
        quality: input.portfolio?.asOfSession === session &&
                 Number.isFinite(input.portfolio?.cash) &&
                 Array.isArray(input.portfolio?.positions) ? 'valid' : 'unavailable',
        source: 'tradeloom-paper-accounting',
        data: input.portfolio
      })
    })
    .register({
      id: 'objectives', version: '1.0.0', required: true,
      collect: async ({ session, input }) => ({
        asOf: session, quality: input.config?.objective ? 'valid' : 'unavailable',
        source: 'bot-configuration',
        data: { objective: input.config?.objective }
      })
    })
    .register({
      id: 'risk', version: '1.0.0', required: true,
      collect: async ({ session, input }) => ({
        asOf: session,
        quality: Number.isFinite(input.config?.execution?.maxPositionPct) ? 'valid' : 'unavailable',
        source: 'bot-configuration',
        data: input.config?.execution
      })
    })
}
