import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { runPaperStrategyBacktest } from './paperStrategyBacktest.js'
import { ResearchPartnerNotFoundError, ResearchPartnerConflictError } from './repository.js'
import { ResearchPartnerInputError } from './mandate.js'
import { getExpectedCompletedExchangeSession } from '../../utils/marketCalendar.js'

export function createResearchBacktestService({
  db=prisma,engine=engineClient,now=()=>new Date()
}={}) {
  const owned = async(userId,partnerId,strategyId) => {
    const strategy=await db.researchPaperStrategy.findFirst({
      where:{id:strategyId,partnerId,partner:{userId,status:{not:'archived'}}}
    })
    if(!strategy)throw new ResearchPartnerNotFoundError()
    return strategy
  }
  return {
    async run(userId,partnerId,strategyId,{startSession,endSession,expectedVersion}) {
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
        throw new ResearchPartnerInputError('Expected approved strategy version required')
      const strategy=await owned(userId,partnerId,strategyId)
      if(strategy.currentVersion!==expectedVersion||strategy.status!=='approved_paper_definition')
        throw new ResearchPartnerConflictError('Approve the current strategy definition first')
      if(typeof endSession!=='string'||endSession>getExpectedCompletedExchangeSession(now()))
        throw new ResearchPartnerInputError('Backtest end cannot exceed the latest completed exchange session')
      const revision=await db.researchPaperStrategyVersion.findUnique({
        where:{strategyId_version:{strategyId,version:expectedVersion}}
      })
      if(!revision)throw new ResearchPartnerConflictError('Approved revision is missing')
      const result=await runPaperStrategyBacktest({
        definition:revision.definition,startSession,endSession,engine
      })
      // Historical snapshots remain attached to their immutable strategy revision.
      return db.researchPaperBacktest.create({
        data:{strategyId,version:expectedVersion,startSession,endSession,result}
      })
    },
    async list(userId,partnerId,strategyId){
      await owned(userId,partnerId,strategyId)
      return db.researchPaperBacktest.findMany({
        where:{strategyId},orderBy:{createdAt:'desc'},take:20,
        select:{id:true,version:true,startSession:true,endSession:true,createdAt:true,result:true}
      })
    }
  }
}
