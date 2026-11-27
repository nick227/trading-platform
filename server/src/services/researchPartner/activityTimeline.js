import prisma from '../../loaders/prisma.js'
import { ResearchPartnerNotFoundError } from './repository.js'

/**
 * Read-only, bounded projection of persisted events. The feed never performs
 * research, approves strategies, schedules jobs, or places orders.
 */
export function createResearchActivityTimeline({ db = prisma } = {}) {
  return {
    async list(userId, partnerId) {
      const partner = await db.researchPartner.findFirst({
        where: { id: partnerId, userId, status: { not: 'archived' } },
        select: { id: true }
      })
      if (!partner) throw new ResearchPartnerNotFoundError()
      const [sessions, drafts, strategies, backtests, activations] = await Promise.all([
        db.researchSession.findMany({
          where: { partnerId }, orderBy: { createdAt: 'desc' }, take: 40,
          select: { id: true, question: true, status: true, error: true, createdAt: true,
            completedAt: true, parentSessionId: true, report: true }
        }),
        db.researchConversationDraft.findMany({
          where: { partnerId }, orderBy: { updatedAt: 'desc' }, take: 20,
          select: { id: true, status: true, requestText: true, proposal: true,
            createdAt: true, updatedAt: true }
        }),
        db.researchPaperStrategy.findMany({
          where: { partnerId }, orderBy: { createdAt: 'desc' }, take: 30,
          select: { id: true, name: true, status: true, currentVersion: true,
            createdAt: true, updatedAt: true }
        }),
        db.researchPaperBacktest.findMany({
          where: { strategy: { partnerId } }, orderBy: { createdAt: 'desc' }, take: 30,
          select: { id: true, strategyId: true, version: true, startSession: true,
            endSession: true, createdAt: true, result: true }
        }),
        db.researchPaperActivation.findMany({
          where: { strategy: { partnerId } }, take: 30,
          select: { id: true, strategyId: true, version: true, status: true,
            createdAt: true, cycles: { orderBy: { createdAt: 'desc' }, take: 15,
              select: { id: true, session: true, createdAt: true, result: true } } }
        })
      ])
      const items = []
      const add = (kind, id, at, status, title, detail, reference = {}) => {
        if (!at) return
        items.push({ id: kind + ':' + id, kind, at, status, title,
          detail: String(detail || '').slice(0, 400), reference })
      }
      for (const session of sessions) {
        add('research_saved', session.id, session.createdAt, 'recorded',
          session.parentSessionId ? 'Follow-up question saved' : 'Research question saved',
          session.question, { sessionId: session.id })
        if (session.status === 'completed' && session.completedAt) {
          add('research_result', session.id, session.completedAt, 'completed',
            'Investigation completed', session.report?.summary || 'Report available',
            { sessionId: session.id })
        } else if (session.status === 'failed' && session.completedAt) {
          add('research_failure', session.id, session.completedAt, 'failed',
            'Investigation failed', session.error || 'The research run did not complete',
            { sessionId: session.id })
        } else if (session.status === 'running') {
          add('research_pending', session.id, session.createdAt, 'in_progress',
            'Investigation running', 'No completed research report is recorded',
            { sessionId: session.id })
        }
      }
      for (const draft of drafts) {
        const needsClarification = draft.status === 'pending' && draft.proposal?.type === 'clarify'
        add('interpretation', draft.id, draft.updatedAt || draft.createdAt,
          draft.status === 'dismissed' ? 'dismissed' : needsClarification ? 'needs_input'
            : draft.status === 'confirmed' ? 'recorded' : 'pending',
          draft.status === 'confirmed' ? 'Research request confirmed'
            : draft.status === 'dismissed' ? 'Research proposal dismissed'
              : needsClarification ? 'Clarification needed' : 'Research action proposed',
          draft.requestText, { draftId: draft.id })
      }
      for (const strategy of strategies) {
        add('strategy', strategy.id, strategy.createdAt, 'recorded', 'Paper strategy saved',
          strategy.name, { strategyId: strategy.id })
        if (strategy.status === 'approved_paper_definition') {
          add('strategy_approved', strategy.id, strategy.updatedAt, 'approved',
            'Paper strategy definition approved',
            strategy.name + ' · version ' + strategy.currentVersion + ' · execution not authorized',
            { strategyId: strategy.id })
        }
      }
      for (const run of backtests) {
        add('backtest', run.id, run.createdAt, 'completed', 'Historical simulation recorded',
          'Strategy version ' + run.version + ' · ' + run.startSession + ' to ' + run.endSession,
          { strategyId: run.strategyId })
      }
      for (const account of activations) {
        add('paper_activation', account.id, account.createdAt, 'approved',
          'Paper simulation activated', 'Simulation only · strategy version ' + account.version,
          { strategyId: account.strategyId })
        for (const cycle of account.cycles) {
          add('paper_cycle', cycle.id, cycle.createdAt, 'completed',
            'Manual paper session processed', cycle.session + ' · simulated fills: ' +
              (Array.isArray(cycle.result?.filled) ? cycle.result.filled.length : 'unavailable'),
            { strategyId: account.strategyId })
        }
      }
      return items.sort((a, b) => new Date(b.at) - new Date(a.at) ||
        a.id.localeCompare(b.id)).slice(0, 100)
    }
  }
}
