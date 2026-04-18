import createApp from './loaders/fastify.js'
import registerRoutes from './loaders/routes.js'
import prisma from './loaders/prisma.js'

async function start() {
  const app = await createApp()
  
  await registerRoutes(app)
  
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
    await app.listen({ port })
    console.log(`Server listening on http://localhost:${port}`)
    console.log(`API docs available at http://localhost:${port}/docs`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
