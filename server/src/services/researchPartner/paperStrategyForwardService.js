import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { getExpectedCompletedExchangeSession } from '../../utils/marketCalendar.js'
import { nextStockTraderSession } from '../ai/stockTraderTradingSession.js'
import { newPaperForwardState, stepResearchPaperForward } from './paperStrategyForward.js'
import { ResearchPartnerConflictError, ResearchPartnerNotFoundError } from './repository.js'
import { ResearchPartnerInputError } from './mandate.js'

export function createPaperForwardService({db=prisma,engine=engineClient,now=()=>new Date()}={}) {
  async function owned(userId,partnerId,strategyId) {
    const strategy=await db.researchPaperStrategy.findFirst({
      where:{id:strategyId,partnerId,partner:{userId,status:{not:'archived'}}}
    })
    if(!strategy)throw new ResearchPartnerNotFoundError()
    return strategy
  }
  async function activation(userId,partnerId,strategyId) {
    await owned(userId,partnerId,strategyId)
    const account=await db.researchPaperActivation.findUnique({where:{strategyId}})
    if(!account)throw new ResearchPartnerNotFoundError()
    return account
  }
  return {
    async activate(userId,partnerId,strategyId,{expectedVersion,confirmation}) {
      if(confirmation!=='PAPER_ONLY')throw new ResearchPartnerInputError('Explicit paper simulation confirmation required')
      const strategy=await owned(userId,partnerId,strategyId)
      if(strategy.currentVersion!==expectedVersion||strategy.status!=='approved_paper_definition')
        throw new ResearchPartnerConflictError('Approve the current strategy version before activating paper simulation')
      const revision=await db.researchPaperStrategyVersion.findUnique({
        where:{strategyId_version:{strategyId,version:expectedVersion}}
      })
      if(!revision)throw new ResearchPartnerConflictError('Missing approved definition')
      try {
        return await db.researchPaperActivation.create({
          data:{strategyId,version:expectedVersion,status:'active',revision:0,
            state:newPaperForwardState(),lastSession:null,
            initialSession:getExpectedCompletedExchangeSession(now())}
        })
      }catch(error) {
        if(error.code==='P2002')throw new ResearchPartnerConflictError('Paper simulation already exists')
        throw error
      }
    },
    async get(userId,partnerId,strategyId) {
      const account=await activation(userId,partnerId,strategyId)
      const cycles=await db.researchPaperCycle.findMany({
        where:{activationId:account.id},orderBy:{createdAt:'desc'},take:20
      })
      return {...account,cycles,
        nextSession: account.lastSession ? nextStockTraderSession(account.lastSession) : account.initialSession,
        latestCompletedSession: getExpectedCompletedExchangeSession(now())}
    },
    async setStatus(userId,partnerId,strategyId,status) {
      if(!['active','paused'].includes(status))
        throw new ResearchPartnerInputError('Unknown paper simulation status')
      const account=await activation(userId,partnerId,strategyId)
      const updated=await db.researchPaperActivation.updateMany({
        where:{id:account.id,revision:account.revision,status:account.status},
        data:{status,revision:{increment:1}}
      })
      if(updated.count!==1)throw new ResearchPartnerConflictError('Paper simulation was changed')
      return {status,executionMode:'simulated_only'}
    },
    async cycle(userId,partnerId,strategyId,{asOfSession}) {
      const account=await activation(userId,partnerId,strategyId)
      if(account.status!=='active')throw new ResearchPartnerConflictError('Paper simulation is paused')
      const latest=getExpectedCompletedExchangeSession(now())
      if(!account.lastSession && asOfSession!==account.initialSession)
        throw new ResearchPartnerInputError('Initial paper session must match the activation baseline')
      if(typeof asOfSession!=='string'||asOfSession>latest)
        throw new ResearchPartnerInputError('Only completed market sessions may be simulated')
      const revision=await db.researchPaperStrategyVersion.findUnique({
        where:{strategyId_version:{strategyId,version:account.version}}
      })
      if(!revision)throw new ResearchPartnerConflictError('Pinned strategy version is unavailable')
      const result=await stepResearchPaperForward({
        definition:revision.definition,state:account.state,asOfSession,engine
      })
      return db.$transaction(async tx=>{
        const claim=await tx.researchPaperActivation.updateMany({
          where:{id:account.id,revision:account.revision,status:'active',lastSession:account.lastSession},
          data:{revision:{increment:1},lastSession:asOfSession,state:result.state}
        })
        if(claim.count!==1)throw new ResearchPartnerConflictError('Paper session was already processed')
        const cycle=await tx.researchPaperCycle.create({
          data:{activationId:account.id,session:asOfSession,result:result.event}
        })
        return {cycle,executionMode:'simulated_only',strategyVersion:account.version}
      })
    }
  }
}
