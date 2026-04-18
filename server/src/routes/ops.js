import opsService from '../services/opsService.js'

export default async function opsRoutes(app) {
  app.get('/overview', async (request, reply) => {
    const data = await opsService.getOverview()
    return reply.send({ data })
  })

  app.get('/audits', async (request, reply) => {
    const data = await opsService.getAudits(request.query)
    return reply.send({ data })
  })
}
