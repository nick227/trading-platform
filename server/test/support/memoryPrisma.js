// Minimal in-memory Prisma stand-in for deterministic runtime tests.
// Supports the query shapes used by the order worker, eligibility checks, accounting,
// and the emergency stop: equality/null, in, not, gt/gte/lt/lte, OR, increment,
// orderBy, single-column @unique constraints (P2002), and $transaction (callback form rolls back on throw; array form sequential).
// updateMany matches and writes synchronously, so a conditional updateMany is atomic
// with respect to other in-flight async callers — like a row-level conditional UPDATE.

function clone(v) {
  return v === undefined ? undefined : structuredClone(v)
}

function cmp(a, b) {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() - new Date(b).getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function matchValue(actual, cond) {
  if (cond === null) return actual === null || actual === undefined
  if (cond instanceof Date) return actual != null && cmp(actual, cond) === 0
  if (typeof cond === 'object' && !Array.isArray(cond)) {
    for (const [op, v] of Object.entries(cond)) {
      if (op === 'in') { if (!v.includes(actual)) return false }
      else if (op === 'notIn') { if (v.includes(actual)) return false }
      else if (op === 'not') { if (v !== null && typeof v === 'object' && !(v instanceof Date) ? matchValue(actual, v) : (v === null ? actual == null : actual === v)) return false }
      else if (op === 'gt') { if (actual == null || cmp(actual, v) <= 0) return false }
      else if (op === 'gte') { if (actual == null || cmp(actual, v) < 0) return false }
      else if (op === 'lt') { if (actual == null || cmp(actual, v) >= 0) return false }
      else if (op === 'lte') { if (actual == null || cmp(actual, v) > 0) return false }
      else if (op === 'equals') { if (actual !== v) return false }
      else throw new Error(`memoryPrisma: unsupported operator ${op}`)
    }
    return true
  }
  return actual === cond
}

export function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue
    if (key === 'OR') { if (!cond.some((w) => matches(row, w))) return false; continue }
    if (key === 'AND') { if (!cond.every((w) => matches(row, w))) return false; continue }
    if (key === 'NOT') { if (matches(row, cond)) return false; continue }
    if (!matchValue(row[key], cond)) return false
  }
  return true
}

function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment
    else row[k] = clone(v)
  }
  row.updatedAt = new Date()
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o))
  return rows.sort((a, b) => {
    for (const [k, dir] of keys) {
      const av = a[k], bv = b[k]
      if (av == null && bv == null) continue
      if (av == null) return -1
      if (bv == null) return 1
      const c = cmp(av, bv)
      if (c !== 0) return dir === 'desc' ? -c : c
    }
    return 0
  })
}

const DEFAULTS = {
  execution: () => ({
    status: 'queued', attempts: 0, lockedAt: null, lockedBy: null, brokerOrderId: null, brokerStatus: null,
    submittedAt: null, submitAttemptedAt: null, lastBrokerSyncAt: null, filledAt: null, filledPrice: null,
    filledQuantity: null, cancelReason: null, cancelRequestedAt: null, cancelRequestedBy: null,
    cancelRequestReason: null, activeIntentKey: null, botId: null, commission: 0, fees: 0, pnl: 0, origin: 'manual'
  }),
  bot: () => ({ enabled: true, deletedAt: null, config: {} }),
  botRule: () => ({ enabled: true, config: {} }),
}

// Single-column @unique constraints from schema.prisma (NULLs never conflict, as in MySQL).
const UNIQUE = {
  execution: ['clientOrderId', 'activeIntentKey', 'brokerOrderId'],
}

function assertUnique(name, all, candidate, self = null) {
  for (const col of UNIQUE[name] ?? []) {
    const v = candidate[col]
    if (v == null) continue
    if (all.some((r) => r !== self && r[col] === v)) {
      const err = new Error(`memoryPrisma: Unique constraint failed on ${name}.${col}`)
      err.code = 'P2002'
      err.meta = { target: [col] }
      throw err
    }
  }
}

function model(store, name) {
  const rows = () => store[name] ?? (store[name] = [])
  return {
    async findUnique({ where }) {
      return clone(rows().find((r) => matches(r, where)) ?? null)
    },
    async findFirst({ where, orderBy } = {}) {
      return clone(sortRows(rows().filter((r) => matches(r, where)), orderBy)[0] ?? null)
    },
    async findMany({ where, orderBy, take } = {}) {
      const out = sortRows(rows().filter((r) => matches(r, where)), orderBy)
      return clone(take ? out.slice(0, take) : out)
    },
    async count({ where } = {}) {
      return rows().filter((r) => matches(r, where)).length
    },
    async create({ data }) {
      const now = new Date()
      const row = { ...(DEFAULTS[name]?.() ?? {}), createdAt: now, updatedAt: now, ...clone(data) }
      if (!row.id) row.id = `${name}_${rows().length + 1}`
      assertUnique(name, rows(), row)
      rows().push(row)
      return clone(row)
    },
    async update({ where, data }) {
      const row = rows().find((r) => matches(r, where))
      if (!row) {
        const err = new Error(`memoryPrisma: ${name} not found`)
        err.code = 'P2025'
        throw err
      }
      const next = structuredClone(row)
      applyData(next, data)
      assertUnique(name, rows(), next, row)
      applyData(row, data)
      return clone(row)
    },
    async updateMany({ where, data }) {
      const hit = rows().filter((r) => matches(r, where))
      for (const row of hit) {
        const next = structuredClone(row)
        applyData(next, data)
        assertUnique(name, rows(), next, row)
      }
      for (const row of hit) applyData(row, data)
      return { count: hit.length }
    },
    async delete({ where }) {
      const i = rows().findIndex((r) => matches(r, where))
      return clone(rows().splice(i, 1)[0])
    },
  }
}

export function createMemoryPrisma() {
  const store = {}
  const client = { _store: store }
  for (const name of ['execution', 'executionAudit', 'bot', 'botRule', 'botEvent', 'user', 'portfolio', 'brokerAccount', 'botTemplate']) {
    client[name] = model(store, name)
  }
  client.$transaction = async (arg) => {
    if (Array.isArray(arg)) {
      const out = []
      for (const p of arg) out.push(await p)
      return out
    }
    const snapshot = structuredClone(store)
    try {
      return await arg(client)
    } catch (err) {
      for (const k of Object.keys(store)) delete store[k]
      Object.assign(store, snapshot)
      throw err
    }
  }
  client.$disconnect = async () => {}
  client.reset = () => { for (const k of Object.keys(store)) delete store[k] }
  return client
}
