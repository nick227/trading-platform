import 'dotenv/config'
import createApp from './loaders/fastify.js'
import registerRoutes from './loaders/routes.js'
import prisma from './loaders/prisma.js'
import { startSchedulers } from './jobs/scheduler.js'

async function start() {
  const app = await createApp()
  
  await registerRoutes(app)
  await startSchedulers()
  
  const signals = ['SIGINT', 'SIGTERM']
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`Received ${signal}, shutting down gracefully`)
      await app.close()
      await prisma.$disconnect()
      process.exit(0)
    })
  })
  
  try {
    const port = process.env.PORT || 3001
    const host = process.env.HOST || '0.0.0.0'
    await app.listen({ port, host })
    console.log(`Server listening on http://${host}:${port}`)
    console.log(`API docs available at http://${host}:${port}/docs`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
