/**
 * Deterministic research-only tool gateway.
 * Tools are functions, not model-executable code and never acquire write access.
 * Every invocation is schema-checked, bounded and traceable to a bot definition.
 */
import { createHash } from 'node:crypto'

const IDENTIFIER = /^[a-z][a-z0-9_]{1,79}$/
const MAX_TOTAL_CALLS = 12
const MAX_TOOL_BYTES = 16_384
const MAX_TOTAL_BYTES = 64_000

export class AiResearchToolError extends Error {
  constructor(code, detail = code) {
    super(detail)
    this.name = 'AiResearchToolError'
    this.code = code
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
  }
  return value
}

function serialize(value) {
  let json
  try { json = JSON.stringify(stable(value)) }
  catch { throw new AiResearchToolError('invalid_tool_output') }
  if (!json || json.includes('__proto__')) throw new AiResearchToolError('invalid_tool_output')
  return json
}

function validateArgs(args, fields) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new AiResearchToolError('invalid_arguments')
  }
  if (Object.keys(args).some(k => !fields.includes(k))) {
    throw new AiResearchToolError('unknown_arguments')
  }
  return args
}

function dateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
}

export function createAiResearchToolRegistry() {
  const registered = new Map()
  const api = {
    register({ id, version, validate, run }) {
      if (!IDENTIFIER.test(id || '') || typeof version !== 'string' || !version ||
          typeof validate !== 'function' || typeof run !== 'function' || registered.has(id)) {
        throw new AiResearchToolError('invalid_tool_registration')
      }
      registered.set(id, Object.freeze({ id, version, validate, run }))
      return api
    },
    list() { return [...registered.values()].map(({id,version})=>({id,version})).sort((a,b)=>a.id.localeCompare(b.id)) },
    createSession({
      permittedTools, context, maxCalls = 6, maxOutputBytes = MAX_TOTAL_BYTES,
      onTrace = null
    }) {
      if (!Array.isArray(permittedTools) || new Set(permittedTools).size !== permittedTools.length ||
          permittedTools.some(id => !registered.has(id)) || !context?.asOfSession ||
          !dateOnly(context.asOfSession) || !Number.isInteger(maxCalls) ||
          maxCalls < 1 || maxCalls > MAX_TOTAL_CALLS || !Number.isInteger(maxOutputBytes) ||
          maxOutputBytes < 256 || maxOutputBytes > MAX_TOTAL_BYTES) {
        throw new AiResearchToolError('invalid_research_session')
      }
      const permitted = new Set(permittedTools)
      const cache = new Map()
      const trace = []
      let calls = 0
      let byteCount = 0
      return {
        async execute(id, args = {}) {
          if (!permitted.has(id)) throw new AiResearchToolError('tool_not_permitted')
          if (calls >= maxCalls) throw new AiResearchToolError('tool_call_limit')
          const tool = registered.get(id)
          const validated = tool.validate(args, context)
          const key = createHash('sha256').update(id + ':' + serialize(validated)).digest('hex')
          calls += 1
          if (cache.has(key)) {
            const cached = cache.get(key)
            trace.push({ toolId: id, version: tool.version, argumentsHash: key, cached: true, outputHash: cached.outputHash })
            return structuredClone(cached.value)
          }
          // Tool runners are curated local functions. No dynamic code execution,
          // arbitrary network address, database write or broker tool is exposed.
          let value
          try { value = await tool.run(validated, context) }
          catch { throw new AiResearchToolError('research_tool_unavailable') }
          const output = serialize(value)
          const bytes = Buffer.byteLength(output, 'utf8')
          if (bytes > MAX_TOOL_BYTES || byteCount + bytes > maxOutputBytes) {
            throw new AiResearchToolError('tool_output_budget_exceeded')
          }
          byteCount += bytes
          const outputHash = createHash('sha256').update(output).digest('hex')
          const frozen = JSON.parse(output)
          cache.set(key, { value: frozen, outputHash })
          const record = { toolId: id, version: tool.version, argumentsHash: key, cached: false, outputHash, bytes }
          trace.push(record)
          if (onTrace) await onTrace(structuredClone(record))
          return structuredClone(frozen)
        },
        getTrace() { return structuredClone(trace) },
        getUsage() { return { calls, outputBytes: byteCount, maxCalls, maxOutputBytes } }
      }
    }
  }
  return api
}

const symbolFromContext = (symbol, ctx) => {
  if (typeof symbol !== 'string' || !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) {
    throw new AiResearchToolError('invalid_symbol')
  }
  const shortlist = ctx.screening?.shortlist || []
  const held = ctx.portfolio?.positions || []
  if (!shortlist.some(row => row.symbol === symbol) && !held.some(p => p.symbol === symbol)) {
    throw new AiResearchToolError('symbol_not_authorized')
  }
  return symbol
}

export function createDefaultAiResearchTools() {
  return createAiResearchToolRegistry()
    .register({
      id: 'get_stock_metrics', version: '1.0.0',
      validate: (args, ctx) => {
        validateArgs(args, ['symbol'])
        return { symbol: symbolFromContext(args.symbol, ctx) }
      },
      run: ({ symbol }, ctx) => {
        const row = ctx.screening.shortlist.find(p => p.symbol === symbol)
        if (!row) return { symbol, status: 'unavailable', asOfSession: ctx.asOfSession }
        return { symbol, asOfSession: ctx.asOfSession, eligible: row.eligible,
          indicators: row.indicators || {}, reason: row.reason || null }
      }
    })
    .register({
      id: 'compare_candidates', version: '1.0.0',
      validate: (args, ctx) => {
        validateArgs(args, ['symbols'])
        if (!Array.isArray(args.symbols) || args.symbols.length < 2 || args.symbols.length > 5 ||
            new Set(args.symbols).size !== args.symbols.length) {
          throw new AiResearchToolError('invalid_comparison')
        }
        return { symbols: args.symbols.map(s => symbolFromContext(s, ctx)).sort() }
      },
      run: ({ symbols }, ctx) => ({
        asOfSession: ctx.asOfSession,
        candidates: symbols.map(symbol => {
          const p = ctx.screening.shortlist.find(r => r.symbol === symbol)
          return { symbol, eligible: Boolean(p?.eligible), indicators: p?.indicators || null }
        })
      })
    })
    .register({
      id: 'get_portfolio_state', version: '1.0.0',
      validate: args => validateArgs(args, []),
      run: (_, ctx) => ({
        asOfSession: ctx.asOfSession,
        cash: ctx.portfolio.cash,
        totalEquity: ctx.portfolio.totalEquity,
        positions: ctx.portfolio.positions
      })
    })
    .register({
      id: 'get_historical_prices', version: '1.0.0',
      validate: (args, ctx) => {
        validateArgs(args, ['symbol', 'lookbackDays'])
        const symbol = symbolFromContext(args.symbol, ctx)
        const lookbackDays = Number(args.lookbackDays)
        if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 120) {
          throw new AiResearchToolError('invalid_lookback')
        }
        return { symbol, lookbackDays }
      },
      run: async ({ symbol, lookbackDays }, ctx) => {
        if (!ctx.engine?.getDailyBars) throw new AiResearchToolError('market_data_unavailable')
        const end = ctx.asOfSession
        const start = new Date(Date.parse(end + 'T00:00:00Z') - lookbackDays*86400000)
          .toISOString().slice(0,10)
        const result = await ctx.engine.getDailyBars(symbol, start, end)
        if (!Array.isArray(result?.bars) || result.bars.some(b => !Array.isArray(b) || b[0] > end || b[0] < start)) {
          throw new AiResearchToolError('invalid_market_data')
        }
        return { symbol, start, end, bars: result.bars }
      }
    })
    .register({
      id: 'get_research_evidence', version: '1.0.0',
      validate: (args, ctx) => {
        validateArgs(args, ['sourceId'])
        if (!ctx.evidence || !Array.isArray(ctx.evidence.records) ||
            !ctx.evidence.records.some(r => r.sourceId === args.sourceId)) {
          throw new AiResearchToolError('evidence_source_unavailable')
        }
        return { sourceId: args.sourceId }
      },
      run: ({ sourceId }, ctx) => ({
        asOfSession: ctx.asOfSession,
        records: ctx.evidence.records.filter(r => r.sourceId === sourceId).slice(0, 10)
      })
    })
}
