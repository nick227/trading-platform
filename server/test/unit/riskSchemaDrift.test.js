/**
 * Guard against schema drift in the risk engine: every prisma.<model> used under
 * worker/src/risk must exist in schema.prisma. (Queries against a missing 'trade' model
 * silently degraded four risk scores to fallback values and blocked every bot trade.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../../', import.meta.url).pathname
const schema = readFileSync(join(root, 'server/prisma/schema.prisma'), 'utf8')
const models = new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1][0].toLowerCase() + m[1].slice(1)))

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []
  })
}

describe('risk engine schema usage', () => {
  it('only queries models that exist', () => {
    const missing = []
    for (const f of files(join(root, 'worker/src/risk'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bprisma\.([a-zA-Z]\w*)\./g)) {
        if (!models.has(m[1])) missing.push(`${f.replace(root, '')}: prisma.${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('does not select Portfolio fields that do not exist', () => {
    const portfolio = schema.match(/^model Portfolio \{([\s\S]*?)^\}/m)[1]
    for (const f of files(join(root, 'worker/src/risk'))) {
      expect(readFileSync(f, 'utf8').includes('lastQuoteUpdate: true') && !portfolio.includes('lastQuoteUpdate'), f).toBe(false)
    }
  })
})

describe('bot-created executions satisfy the schema', () => {
  it('supply every required Execution column that has no default', () => {
    const body = schema.match(/^model Execution \{([\s\S]*?)^\}/m)[1]
    const required = body.split('\n').map((l) => l.trim()).filter((l) => /^[a-zA-Z]\w*\s+(String|Float|Int|Boolean|DateTime|Decimal|Json)\b(?!\?)/.test(l))
      .filter((l) => !/@default|@updatedAt|@id/.test(l)).map((l) => l.split(/\s+/)[0])
    expect(required).toContain('commission')
    const engine = readFileSync(join(root, 'worker/src/engine/botEngine.js'), 'utf8')
    const create = engine.slice(engine.indexOf('tx.execution.create({'), engine.indexOf('if (research) {', engine.indexOf('tx.execution.create({')))
    const missing = required.filter((f) => !new RegExp(`\\b${f}\\s*[:,]`).test(create))
    expect(missing).toEqual([])
  })
})

