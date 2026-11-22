/**
 * Optional backfill: re-labels historical refusals (status 'cancelled' + cancelReason
 * 'refused:<reason>') as status 'refused' with refusalReason '<reason>'.
 *
 * Not required for correctness — cooldown, back-off and the UI read both shapes.
 * Preserves history: cancelReason is left untouched, nothing is deleted, and each row
 * gets an ExecutionAudit 'reconciled' entry. Reversible with --revert.
 *
 *   node scripts/backfillRefusedStatus.mjs              dry run (default): counts only
 *   node scripts/backfillRefusedStatus.mjs --apply      re-label
 *   node scripts/backfillRefusedStatus.mjs --revert     undo (refused rows that still carry the legacy cancelReason)
 */
import { randomUUID } from 'node:crypto'
import prisma from '../src/loaders/prisma.js'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')
const PREFIX = 'refused:'
const target = (() => { try { const u = new URL(process.env.DATABASE_URL); return `${u.hostname}:${u.port || 3306}${u.pathname}` } catch { return 'unknown' } })()

async function main() {
  console.log(`database: ${target}`)
  const where = revert
    ? { status: 'refused', cancelReason: { startsWith: PREFIX } }
    : { status: 'cancelled', cancelReason: { startsWith: PREFIX } }
  const rows = await prisma.execution.findMany({ where, select: { id: true, userId: true, cancelReason: true } })
  console.log(`${revert ? 'refused rows to revert' : 'legacy refusals to re-label'}: ${rows.length}`)
  if (!apply && !revert) { console.log('dry run — pass --apply to write'); return }

  let changed = 0
  for (const r of rows) {
    const reason = r.cancelReason.slice(PREFIX.length)
    await prisma.$transaction(async (tx) => {
      const res = await tx.execution.updateMany({
        where: { id: r.id, ...where },
        data: revert ? { status: 'cancelled', refusalReason: null } : { status: 'refused', refusalReason: reason }
      })
      if (res.count !== 1) return
      changed++
      await tx.executionAudit.create({
        data: {
          id: `aud_${randomUUID()}`, executionId: r.id, userId: r.userId, eventType: 'reconciled',
          detail: revert ? 'Refusal backfill reverted' : `Re-labelled legacy refusal as status refused (${reason})`,
          metadata: { backfill: 'refused_status', revert, from: revert ? 'refused' : 'cancelled', to: revert ? 'cancelled' : 'refused', reason }
        }
      })
    })
  }
  console.log(`${revert ? 'reverted' : 're-labelled'}: ${changed}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
