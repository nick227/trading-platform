/**
 * Internal simulator broker adapter — thin compatibility subclass of `InternalSimulatorProvider` (P2).
 * All deterministic simulation logic lives in `server/src/execution/providers/InternalSimulatorProvider.js`.
 */
import prisma from '../db/prisma.js'
import { engineClient } from '../../../server/src/clients/engine.js'
import { currentSimSession, simulationConfig } from '../../../server/src/services/simulationService.js'
import { InternalSimulatorProvider } from '../../../server/src/execution/providers/InternalSimulatorProvider.js'

export class SimulatedBroker extends InternalSimulatorProvider {
  constructor(
    userId,
    {
      config = simulationConfig(),
      prismaClient = prisma,
      sessionClose = (t, s) => engineClient.getSessionClose(t, s),
      now = () => new Date(),
      resolveSession = () => currentSimSession({ config })
    } = {}
  ) {
    if (!config.enabled) throw new Error('simulator is not enabled')
    super(userId, {
      portfolioId: null,
      startingCash: config.startingCash,
      config,
      prismaClient,
      sessionClose,
      now,
      resolveSession
    })
  }
}

const brokers = new Map()

export function getSimulatedBroker(userId, opts) {
  if (!brokers.has(userId)) brokers.set(userId, new SimulatedBroker(userId, opts))
  return brokers.get(userId)
}

export function clearSimulatedBrokers() {
  brokers.clear()
}
